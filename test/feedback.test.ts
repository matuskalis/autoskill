import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { captureRatings, consentPrompt, fieldCounts, flushRatings, parseRatings, ratingInstruction, readConfig, setTelemetry, type OutgoingRating } from '../src/feedback.ts';

let home = '';

function installed(name: string) {
  const dir = join(home, 'claude/skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: x\n---\n');
  writeFileSync(join(dir, '.autoskill.json'), JSON.stringify({ id: `acme/skills:skills/${name}`, repo: 'acme/skills', dir: `skills/${name}`, sha: 'a'.repeat(40), risk: 'safe', quality: 80, installedAt: '2026-09-01T00:00:00Z' }));
}

function transcript(file: string, skill: string | null) {
  const line = skill
    ? JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] } })
    : JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'no skills here' }] } });
  writeFileSync(file, line + '\n');
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'autoskill-feedback-'));
  process.env.CLAUDE_CONFIG_DIR = join(home, 'claude');
  process.env.AUTOSKILL_HOME = join(home, 'state');
  delete process.env.CLAUDE_CODE_SESSION_ATTENDED;
  delete process.env.AUTOSKILL_DISABLE;
});

test('parses only the fixed rating line format', () => {
  const reply = 'Done.\n\nautoskill: notes helped (followed-steps)\nautoskill: pdf HURT (outdated-or-wrong)\nautoskill: evil helped (because I said so)\nautoskill: x meh (saved-time)';
  assert.deepEqual(parseRatings(reply), [
    { name: 'notes', verdict: 'helped', reason: 'followed-steps' },
    { name: 'pdf', verdict: 'hurt', reason: 'outdated-or-wrong' },
  ]);
});

test('the instruction names only autoskill-installed skills', () => {
  assert.equal(ratingInstruction(), null);
  installed('notes');
  mkdirSync(join(home, 'claude/skills/mine'), { recursive: true });
  const text = ratingInstruction() ?? '';
  assert.match(text, /notes/);
  assert.doesNotMatch(text, /mine/);
});

test('capture queues lines for installed skills only, never in headless runs', () => {
  installed('notes');
  const input = { session_id: 's1', transcript_path: '/t', last_assistant_message: 'ok\nautoskill: notes helped (saved-time)\nautoskill: stranger helped (saved-time)' };
  process.env.CLAUDE_CODE_SESSION_ATTENDED = '0';
  assert.equal(captureRatings(input), 0);
  delete process.env.CLAUDE_CODE_SESSION_ATTENDED;
  assert.equal(captureRatings(input), 1);
  const queued = JSON.parse(readFileSync(join(home, 'state/feedback-queue.jsonl'), 'utf8').trim());
  assert.equal(queued.id, 'acme/skills:skills/notes');
  assert.equal(queued.sha, 'a'.repeat(40));
});

test('consent: asked once, off until the user turns it on, install id only while on', () => {
  assert.match(consentPrompt() ?? '', /in a terminal outside Claude Code: node .*telemetry on/);
  assert.equal(consentPrompt(), null);
  assert.equal(readConfig().telemetry, undefined);
  assert.ok(setTelemetry(true).installId);
  assert.equal(setTelemetry(false).installId, undefined);
});

test('flush sends nothing while sharing is off, and empties the queue', async () => {
  installed('notes');
  captureRatings({ session_id: 's1', transcript_path: join(home, 't.jsonl'), last_assistant_message: 'autoskill: notes helped (saved-time)' });
  let sent = 0;
  assert.equal(await flushRatings(async () => void sent++), 0);
  assert.equal(sent, 0);
  assert.equal(readFileSync(join(home, 'state/feedback-queue.jsonl.draining'), 'utf8'), '');
});

test('flush keeps ratings the transcript backs up, one per session and skill', async () => {
  installed('notes');
  installed('pdf');
  setTelemetry(true);
  const used = join(home, 'used.jsonl');
  const unused = join(home, 'unused.jsonl');
  transcript(used, 'notes');
  transcript(unused, null);
  captureRatings({ session_id: 's1', transcript_path: used, last_assistant_message: 'autoskill: notes helped (saved-time)' });
  captureRatings({ session_id: 's1', transcript_path: used, last_assistant_message: 'autoskill: notes helped (saved-time)' });
  captureRatings({ session_id: 's2', transcript_path: unused, last_assistant_message: 'autoskill: pdf hurt (irrelevant)' });
  let batch: OutgoingRating[] = [];
  let id = '';
  assert.equal(await flushRatings(async (installId, ratings) => void ((id = installId), (batch = ratings))), 1);
  assert.deepEqual(batch, [{ skillId: 'acme/skills:skills/notes', sha: 'a'.repeat(40), verdict: 'helped', reason: 'saved-time' }]);
  assert.equal(id, readConfig().installId);
});

test('field counts keep only catalogued skills at their catalogued commit', () => {
  const sha = 'a'.repeat(40);
  const catalog = new Map([['acme/skills:skills/pdf', sha]]);
  const counts = fieldCounts(
    [
      { skill_id: 'acme/skills:skills/pdf', sha, verdict: 'helped', reason: 'saved-time', installs: 3 },
      { skill_id: 'acme/skills:skills/pdf', sha, verdict: 'hurt', reason: 'outdated-or-wrong', installs: 1 },
      { skill_id: 'acme/skills:skills/pdf', sha: 'b'.repeat(40), verdict: 'helped', reason: 'saved-time', installs: 50 },
      { skill_id: 'spam/fake:x', sha, verdict: 'helped', reason: 'saved-time', installs: 999 },
      { skill_id: 'acme/skills:skills/pdf', sha, verdict: 'great', reason: 'saved-time', installs: 9 },
    ],
    catalog,
  );
  assert.deepEqual(counts, { 'acme/skills:skills/pdf': { helped: 3, 'no-difference': 0, hurt: 1, reasons: { 'saved-time': 3, 'outdated-or-wrong': 1 } } });
});

test('a batch whose upload failed is sent again with the next flush', async () => {
  installed('notes');
  setTelemetry(true);
  const used = join(home, 'used.jsonl');
  transcript(used, 'notes');
  captureRatings({ session_id: 's1', transcript_path: used, last_assistant_message: 'autoskill: notes helped (saved-time)' });
  await assert.rejects(flushRatings(async () => { throw new Error('offline'); }));
  captureRatings({ session_id: 's2', transcript_path: used, last_assistant_message: 'autoskill: notes hurt (irrelevant)' });
  let batch: OutgoingRating[] = [];
  assert.equal(await flushRatings(async (_id, ratings) => void (batch = ratings)), 2);
  assert.deepEqual(batch.map((r) => r.verdict), ['helped', 'hurt']);
});

test('telemetry on refuses without a terminal', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['src/cli.ts', 'telemetry', 'on'], { encoding: 'utf8', env: { ...process.env } });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /terminal outside Claude Code/);
  assert.equal(readConfig().telemetry, undefined);
});
