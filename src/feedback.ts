import { randomUUID } from 'node:crypto';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { listInstalled } from './install.ts';
import { stateDir } from './paths.ts';

/**
 * Skill ratings: Claude ends a reply that used an autoskill-installed skill
 * with one fixed-format line, a Stop hook queues it locally, and the daily
 * background job verifies it against the transcript and, only when the user
 * said yes, sends it. A rating is a skill id, commit, verdict and reason code:
 * no prompt, no code, no free text, no identity beyond a random install id.
 */
export const VERDICTS = ['helped', 'no-difference', 'hurt'] as const;
export const REASONS = ['followed-steps', 'saved-time', 'irrelevant', 'outdated-or-wrong', 'conflicted', 'too-long'] as const;
export type Verdict = (typeof VERDICTS)[number];
export type Reason = (typeof REASONS)[number];

export const FEEDBACK_URL = process.env.AUTOSKILL_FEEDBACK_URL || 'https://autoskill-feedback.vercel.app/api/ratings';
const LINE = new RegExp(`^autoskill:\\s+([a-z0-9._-]{1,64})\\s+(${VERDICTS.join('|')})\\s+\\((${REASONS.join('|')})\\)\\s*$`, 'i');

export interface QueuedRating {
  sessionId: string;
  transcriptPath: string;
  name: string;
  id: string;
  sha: string;
  verdict: Verdict;
  reason: Reason;
  at: string;
}

interface Config {
  telemetry?: 'on' | 'off';
  installId?: string;
  askedAt?: string;
}

const configFile = () => join(stateDir(), 'config.json');
const queueFile = () => join(stateDir(), 'feedback-queue.jsonl');

export function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(configFile(), 'utf8')) as Config;
  } catch {
    return {};
  }
}

function writeConfig(config: Config) {
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(config, null, 1));
}

/** Only the user turns this on; the install id is created at that moment and removed when it is turned off. */
export function setTelemetry(on: boolean): Config {
  const config = readConfig();
  const next: Config = on
    ? { ...config, telemetry: 'on', installId: config.installId ?? randomUUID() }
    : { telemetry: 'off', ...(config.askedAt ? { askedAt: config.askedAt } : {}) };
  writeConfig(next);
  return next;
}

/** The one-time question at the first interactive startup; no answer means off. */
export function consentPrompt(): string | null {
  const config = readConfig();
  if (config.telemetry || config.askedAt) return null;
  writeConfig({ ...config, askedAt: new Date().toISOString() });
  return 'autoskill: share anonymous skill ratings to improve the catalog for everyone? A rating is the skill, a verdict and a reason code; never your prompts, code or identity. Run `autoskill telemetry on` to share, or ignore this to keep it off.';
}

/** Parses the rating lines from the end of a reply; anything off-format is ignored. */
export function parseRatings(message: string): { name: string; verdict: Verdict; reason: Reason }[] {
  return message
    .split('\n')
    .slice(-12)
    .flatMap((line) => {
      const match = LINE.exec(line.trim());
      return match ? [{ name: (match[1] ?? '').toLowerCase(), verdict: (match[2] ?? '').toLowerCase() as Verdict, reason: (match[3] ?? '').toLowerCase() as Reason }] : [];
    });
}

/** The instruction Claude gets at session start, naming only skills autoskill installed. */
export function ratingInstruction(): string | null {
  const names = listInstalled().map(({ name }) => name);
  if (!names.length) return null;
  return [
    `autoskill installed these skills: ${names.join(', ')}.`,
    'When you finish a task in which you actually loaded one of them, end your final reply with one line per such skill, exactly in this form:',
    `autoskill: <skill-name> <${VERDICTS.join('|')}> (<${REASONS.join('|')}>)`,
    'Pick the verdict and reason honestly; write nothing else on that line. Skip it for skills you did not load, and for any other skills.',
  ].join(' ');
}

/** Stop hook: queue well-formed lines for skills autoskill installed. Local only; any error is silent. */
export function captureRatings(input: { session_id?: string; transcript_path?: string; last_assistant_message?: string }): number {
  if (process.env.AUTOSKILL_DISABLE || process.env.CLAUDE_CODE_SESSION_ATTENDED === '0') return 0;
  const ratings = parseRatings(input.last_assistant_message ?? '');
  if (!ratings.length || !input.session_id || !input.transcript_path) return 0;
  const installed = new Map(listInstalled().map(({ name, marker }) => [name, marker]));
  const lines = ratings.flatMap(({ name, verdict, reason }) => {
    const marker = installed.get(name);
    if (!marker) return [];
    const queued: QueuedRating = { sessionId: input.session_id ?? '', transcriptPath: input.transcript_path ?? '', name, id: marker.id, sha: marker.sha, verdict, reason, at: new Date().toISOString() };
    return [JSON.stringify(queued)];
  });
  if (!lines.length) return 0;
  mkdirSync(stateDir(), { recursive: true });
  appendFileSync(queueFile(), lines.join('\n') + '\n');
  return lines.length;
}

/** Whether the transcript shows the skill was really loaded: a Skill call, or its SKILL.md read with Read or cat. */
export async function skillWasUsed(transcriptPath: string, name: string): Promise<boolean> {
  if (!existsSync(transcriptPath)) return false;
  const skillMd = new RegExp(`/skills/${name.replace(/[.]/g, '\\.')}/SKILL\\.md\\b`);
  const lines = createInterface({ input: createReadStream(transcriptPath, 'utf8'), crlfDelay: Infinity });
  for await (const text of lines) {
    if (!text.includes(name)) continue;
    try {
      const content = (JSON.parse(text) as { message?: { content?: unknown } }).message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as { type?: string; name?: string; input?: Record<string, unknown> }[]) {
        if (block.type !== 'tool_use') continue;
        if (block.name === 'Skill' && typeof block.input?.skill === 'string' && block.input.skill.split(':').pop() === name) return true;
        if ((block.name === 'Read' || block.name === 'Bash') && skillMd.test(String(block.input?.file_path ?? block.input?.command ?? ''))) return true;
      }
    } catch {}
  }
  return false;
}

export interface OutgoingRating {
  skillId: string;
  sha: string;
  verdict: Verdict;
  reason: Reason;
}

/**
 * Drains the queue: keeps ratings the transcript backs up, one per session and
 * skill, and sends them only when telemetry is on. The queue is emptied either
 * way, so nothing accumulates while sharing is off.
 */
export async function flushRatings(send: (installId: string, ratings: OutgoingRating[]) => Promise<void> = postRatings): Promise<number> {
  const file = queueFile();
  if (!existsSync(file)) return 0;
  const draining = `${file}.draining`;
  renameSync(file, draining);
  const queued = readFileSync(draining, 'utf8')
    .split('\n')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as QueuedRating];
      } catch {
        return [];
      }
    });
  const config = readConfig();
  const seen = new Set<string>();
  const verified: OutgoingRating[] = [];
  if (config.telemetry === 'on' && config.installId) {
    for (const item of queued) {
      const key = `${item.sessionId}|${item.id}`;
      if (seen.has(key) || !VERDICTS.includes(item.verdict) || !REASONS.includes(item.reason)) continue;
      seen.add(key);
      if (await skillWasUsed(item.transcriptPath, item.name)) verified.push({ skillId: item.id, sha: item.sha, verdict: item.verdict, reason: item.reason });
    }
    if (verified.length) await send(config.installId, verified);
  }
  writeFileSync(draining, '');
  return verified.length;
}

async function postRatings(installId: string, ratings: OutgoingRating[]): Promise<void> {
  const response = await fetch(FEEDBACK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ installId, ratings }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`feedback upload failed: HTTP ${response.status}`);
}

export type FieldCounts = Record<string, { helped: number; 'no-difference': number; hurt: number; reasons: Partial<Record<Reason, number>> }>;

/**
 * Field ratings for the catalog: distinct-install counts, kept only for skills
 * and commits the catalog lists, so a made-up id never shows anywhere. Counts
 * are for display; they never change a skill's tier or ranking.
 */
export function fieldCounts(rows: readonly { skill_id?: unknown; sha?: unknown; verdict?: unknown; reason?: unknown; installs?: unknown }[], catalog: ReadonlyMap<string, string>): FieldCounts {
  const out: FieldCounts = {};
  for (const row of rows) {
    const { skill_id: id, sha, verdict, reason, installs } = row;
    if (typeof id !== 'string' || catalog.get(id) !== sha || typeof installs !== 'number' || installs < 1) continue;
    if (!VERDICTS.includes(verdict as Verdict) || !REASONS.includes(reason as Reason)) continue;
    const entry = (out[id] ??= { helped: 0, 'no-difference': 0, hurt: 0, reasons: {} });
    entry[verdict as Verdict] += installs;
    entry.reasons[reason as Reason] = (entry.reasons[reason as Reason] ?? 0) + installs;
  }
  return out;
}
