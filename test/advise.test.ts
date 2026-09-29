import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { longClaudeMd, maxEffort, refreshAdvice, startupTip, transcriptStats, unusedSkills, type TranscriptStats } from '../src/advise.ts';

let home = '';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'autoskill-advise-'));
  process.env.CLAUDE_CONFIG_DIR = join(home, 'claude');
  process.env.AUTOSKILL_HOME = join(home, 'state');
  delete process.env.AUTOSKILL_ADVICE;
});

const stats = (effort: Record<string, number>, models: Record<string, number> = {}): TranscriptStats => ({
  turns: 0,
  effort: new Map(Object.entries(effort)),
  models: new Map(Object.entries(models)),
  cwds: new Set(),
});

test('reads effort, model and cwd from assistant lines only, inside the window', async () => {
  mkdirSync(join(home, 'claude/projects/p'), { recursive: true });
  const now = new Date().toISOString();
  const line = (extra: object) => JSON.stringify({ type: 'assistant', timestamp: now, cwd: '/work/app', message: { model: 'claude-opus-5-5' }, ...extra });
  writeFileSync(
    join(home, 'claude/projects/p/s.jsonl'),
    [
      line({ effort: 'max' }),
      line({ effort: 'high' }),
      line({ effort: 'max', timestamp: '2020-01-01T00:00:00Z' }),
      JSON.stringify({ type: 'user', effort: 'max', message: { content: 'ignore me' } }),
      line({ effort: 'bogus', message: { model: 'not a model; rm -rf' } }),
    ].join('\n'),
  );
  const result = await transcriptStats();
  assert.equal(result.turns, 3);
  assert.deepEqual([...result.effort], [['max', 1], ['high', 1]]);
  assert.deepEqual([...result.models], [['claude-opus-5-5', 2]]);
  assert.deepEqual([...result.cwds], ['/work/app']);
});

test('max effort: advises only past both the share and the count', () => {
  assert.equal(maxEffort(stats({ max: 49, high: 1 })), null);
  assert.equal(maxEffort(stats({ max: 60, high: 400 })), null);
  assert.match(maxEffort(stats({ max: 300, high: 700 }))?.evidence ?? '', /300 of 1000 turns \(30%\)/);
});

test('CLAUDE.md over 200 lines, longest first', () => {
  const short = join(home, 'a.md');
  const long = join(home, 'b.md');
  writeFileSync(short, 'x\n'.repeat(50));
  writeFileSync(long, 'x\n'.repeat(260));
  assert.match(longClaudeMd([short, long, join(home, 'missing.md')])?.evidence ?? '', /b\.md: 261 lines/);
  assert.equal(longClaudeMd([short]), null);
});

test('skills idle for 60 days, recently edited or used ones spared', () => {
  const root = join(home, 'claude/skills');
  const old = (Date.now() - 90 * 86_400_000) / 1000;
  for (const name of ['idle', 'used', 'fresh']) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, 'SKILL.md'), '---\nname: x\n---\n');
    if (name !== 'fresh') utimesSync(join(root, name, 'SKILL.md'), old, old);
  }
  const usage = new Map([['used', { last: new Date().toISOString() }]]);
  assert.equal(unusedSkills(usage)?.evidence, 'idle');
});

test('startup tip: startup only, one a day, off switch, fixed templates', async () => {
  mkdirSync(join(home, 'claude'), { recursive: true });
  writeFileSync(join(home, 'claude/settings.json'), JSON.stringify({ modelSettings: {} }));
  mkdirSync(join(home, 'claude/projects/p'), { recursive: true });
  const now = new Date().toISOString();
  const turns = Array.from({ length: 60 }, () =>
    JSON.stringify({ type: 'assistant', timestamp: now, effort: 'max', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'SECRET TRANSCRIPT TEXT' }] } }),
  );
  writeFileSync(join(home, 'claude/projects/p/s.jsonl'), turns.join('\n'));
  await refreshAdvice();

  assert.equal(startupTip('resume'), null);
  const tip = startupTip('startup');
  assert.ok(tip);
  assert.match(JSON.parse(tip).systemMessage, /Most of your turns run at max effort/);
  assert.equal(tip.includes('SECRET TRANSCRIPT TEXT'), false);
  assert.equal(startupTip('startup'), null, 'a second tip the same day');
  assert.equal(startupTip('startup', Date.now() + 2 * 86_400_000), null, 'the same tip again within two weeks');

  process.env.AUTOSKILL_ADVICE = 'off';
  assert.equal(startupTip('startup', Date.now() + 30 * 86_400_000), null);
});
