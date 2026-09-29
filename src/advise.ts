import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { listInstalled } from './install.ts';
import { claudeDir, skillsDir, stateDir } from './paths.ts';
import { skillUsage, transcripts } from './usage.ts';

/**
 * Workflow advice from the user's own files. A detector ships only when its
 * trigger is measured from those files and its advice is Anthropic guidance
 * or a measurement. Text is built from counts, paths and fixed templates,
 * never from transcript content, because tool output is untrusted.
 */
export interface Advice {
  id: string;
  title: string;
  evidence: string;
  fix: string;
  source: string;
}

const DAY = 86_400_000;
const WINDOW_DAYS = 14;
const MAX_SHARE = 0.2;
const MIN_MAX_TURNS = 50;
const CLAUDE_MD_LINES = 200;
const UNUSED_DAYS = 60;
const MODEL_ID = /^claude-[a-z0-9-]+$/;

export interface TranscriptStats {
  turns: number;
  effort: Map<string, number>;
  models: Map<string, number>;
  cwds: Set<string>;
}

export async function transcriptStats(sinceDays = WINDOW_DAYS): Promise<TranscriptStats> {
  const since = new Date(Date.now() - sinceDays * DAY).toISOString();
  const stats: TranscriptStats = { turns: 0, effort: new Map(), models: new Map(), cwds: new Set() };
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  for (const file of transcripts(Date.now() - sinceDays * DAY)) {
    const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const text of lines) {
      if (!text.includes('"type":"assistant"')) continue;
      let line: { timestamp?: string; effort?: unknown; cwd?: unknown; message?: { model?: unknown } };
      try {
        line = JSON.parse(text);
      } catch {
        continue;
      }
      if ((line.timestamp ?? '') < since) continue;
      stats.turns += 1;
      if (typeof line.effort === 'string' && /^(low|medium|high|xhigh|max)$/.test(line.effort)) bump(stats.effort, line.effort);
      const model = line.message?.model;
      if (typeof model === 'string' && MODEL_ID.test(model)) bump(stats.models, model);
      if (typeof line.cwd === 'string') stats.cwds.add(line.cwd);
    }
  }
  return stats;
}

export function maxEffort(stats: TranscriptStats): Advice | null {
  const max = stats.effort.get('max') ?? 0;
  const total = [...stats.effort.values()].reduce((sum, n) => sum + n, 0);
  if (max < MIN_MAX_TURNS || max / total < MAX_SHARE) return null;
  return {
    id: 'effort-max',
    title: 'Most of your turns run at max effort',
    evidence: `${max} of ${total} turns (${Math.round((100 * max) / total)}%) in the last ${WINDOW_DAYS} days ran at max.`,
    fix: 'Set a lower default per model under modelSettings (xhigh or high) and switch to max with /effort only for a task where you have seen it help.',
    source: 'Anthropic: reserve xhigh and max for work where you have measured a gain (Opus 5.5 migration guide). Simon Willison: max runs spent 128K tokens thinking and returned nothing, twice.',
  };
}

interface Settings {
  effortLevel?: unknown;
  modelSettings?: Record<string, { effortLevel?: unknown }>;
}

export function missingModelEffort(stats: TranscriptStats, settings: Settings): Advice | null {
  const covered = new Set(Object.keys(settings.modelSettings ?? {}));
  const used = [...stats.models].filter(([model, turns]) => /-5-5$/.test(model) && turns >= 20 && !covered.has(model));
  if (!used.length) return null;
  const [model, turns] = used.sort((a, b) => b[1] - a[1])[0] as [string, number];
  const topLevel = typeof settings.effortLevel === 'string' ? ` Your top-level effortLevel is ${settings.effortLevel}.` : '';
  return {
    id: `effort-unset-${model}`,
    title: `No effort setting for ${model}, which you use`,
    evidence: `${turns} turns ran on ${model} in the last ${WINDOW_DAYS} days, and settings.json has no modelSettings entry for it.${topLevel}`,
    fix: `Check the level a session really runs at with /effort. To pin it, add "${model}": { "effortLevel": "<level>" } under modelSettings in ~/.claude/settings.json.`,
    source: 'Claude Code model config: 5.5 models default to medium; the top-level effortLevel key is reported not to apply to them (anthropics/claude-code#97403, open).',
  };
}

export function longClaudeMd(files: readonly string[]): Advice | null {
  const long = files
    .filter((file) => existsSync(file))
    .map((file) => ({ file, lines: readFileSync(file, 'utf8').split('\n').length }))
    .filter(({ lines }) => lines > CLAUDE_MD_LINES)
    .sort((a, b) => b.lines - a.lines);
  if (!long.length) return null;
  return {
    id: `claude-md-${long.map(({ file }) => file).join('|')}`,
    title: `${long.length} CLAUDE.md file${long.length === 1 ? ' is' : 's are'} over ${CLAUDE_MD_LINES} lines`,
    evidence: long.map(({ file, lines }) => `${file}: ${lines} lines`).join('; '),
    fix: 'Keep only lines whose removal would cause a mistake; move procedures to skills and file-specific rules to .claude/rules with paths:.',
    source: 'Claude Code memory docs: keep each CLAUDE.md under 200 lines.',
  };
}

export function unusedSkills(usage: Map<string, { last: string }>, now = Date.now()): Advice | null {
  const root = skillsDir();
  if (!existsSync(root)) return null;
  const cutoff = new Date(now - UNUSED_DAYS * DAY).toISOString();
  const idle = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(root, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .filter((name) => (usage.get(name)?.last ?? '') < cutoff && statSync(join(root, name, 'SKILL.md')).mtimeMs < now - UNUSED_DAYS * DAY);
  if (!idle.length) return null;
  const managed = new Set(listInstalled().map(({ name }) => name));
  return {
    id: `unused-${idle.sort().join(',')}`,
    title: `${idle.length} skill${idle.length === 1 ? '' : 's'} unused for ${UNUSED_DAYS} days`,
    evidence: idle.map((name) => (managed.has(name) ? `${name} (autoskill)` : name)).join(', '),
    fix: `Every skill's description is loaded into each session. Remove what you no longer use: autoskill prune --days ${UNUSED_DAYS} --apply for autoskill's own; move the others out of ~/.claude/skills.`,
    source: 'Claude Code skills docs: skill descriptions count toward context in every session.',
  };
}

function readSettings(): Settings {
  try {
    return JSON.parse(readFileSync(join(claudeDir(), 'settings.json'), 'utf8')) as Settings;
  } catch {
    return {};
  }
}

export async function computeAdvice(): Promise<Advice[]> {
  const stats = await transcriptStats();
  const claudeMds = [join(claudeDir(), 'CLAUDE.md'), ...[...stats.cwds].flatMap((cwd) => [join(cwd, 'CLAUDE.md'), join(cwd, '.claude', 'CLAUDE.md')])];
  return [
    maxEffort(stats),
    missingModelEffort(stats, readSettings()),
    longClaudeMd([...new Set(claudeMds)]),
    unusedSkills(await skillUsage(UNUSED_DAYS + 1)),
  ].filter((advice): advice is Advice => advice !== null);
}

const adviceFile = () => join(stateDir(), 'advice.json');
const shownFile = () => join(stateDir(), 'advice-shown.json');

export async function refreshAdvice(): Promise<Advice[]> {
  const advice = await computeAdvice();
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(adviceFile(), JSON.stringify({ at: new Date().toISOString(), advice }, null, 1));
  return advice;
}

/**
 * At most one new tip a day, at session startup only, from the file the
 * background job wrote: this runs on every session start and reads nothing
 * else. AUTOSKILL_ADVICE=off turns it off.
 */
export function startupTip(source: string | undefined, now = Date.now()): string | null {
  if (source !== 'startup' || process.env.AUTOSKILL_ADVICE === 'off') return null;
  let advice: Advice[];
  let shown: Record<string, string> = {};
  try {
    advice = (JSON.parse(readFileSync(adviceFile(), 'utf8')) as { advice: Advice[] }).advice;
  } catch {
    return null;
  }
  try {
    shown = JSON.parse(readFileSync(shownFile(), 'utf8')) as Record<string, string>;
  } catch {}
  if (Object.values(shown).some((at) => now - Date.parse(at) < DAY)) return null;
  const next = advice.find((item) => !shown[item.id] || now - Date.parse(shown[item.id] ?? '') > WINDOW_DAYS * DAY);
  if (!next) return null;
  shown[next.id] = new Date(now).toISOString();
  writeFileSync(shownFile(), JSON.stringify(shown));
  const message = `autoskill tip: ${next.title}. ${next.evidence} Run \`autoskill advise\` for the fix, or ask Claude to apply it. (AUTOSKILL_ADVICE=off hides these tips.)`;
  const context = `autoskill found this about the user's own Claude Code setup: ${next.title}. ${next.evidence} Suggested fix: ${next.fix} Basis: ${next.source} Apply it only if the user asks; never edit ~/.claude on your own.`;
  return JSON.stringify({ systemMessage: message, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
}

export function formatAdvice(advice: readonly Advice[]): string {
  if (!advice.length) return 'no suggestions: nothing in your setup crossed a threshold';
  return advice.map((item, i) => `${i + 1}. ${item.title}\n   ${item.evidence}\n   fix: ${item.fix}\n   why: ${item.source}`).join('\n\n');
}

