import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkAllowRules, checkNode, checkSettings, measuredBreakdown } from '../src/doctor.ts';

const SHA = 'a'.repeat(40);
const settings = (...allow: string[]) => ({ permissions: { allow } });

test('checkAllowRules: add is ok, missing warns, install or a bare autoskill prefix fails', () => {
  assert.equal(checkAllowRules(settings('Bash(autoskill add:*)')).status, 'ok');
  assert.equal(checkAllowRules(settings('Bash(autoskill add *)')).status, 'ok');
  assert.equal(checkAllowRules(settings('Bash(git status:*)')).status, 'warn');
  assert.equal(checkAllowRules({}).status, 'warn');
  assert.equal(checkAllowRules(null).status, 'warn');
  assert.equal(checkAllowRules({ permissions: { allow: 'Bash(autoskill:*)' } }).status, 'warn');
  for (const rule of ['Bash(autoskill install:*)', 'Bash(autoskill:*)', 'Bash(autoskill *)', 'Bash(autoskill install *)']) {
    const result = checkAllowRules(settings('Bash(autoskill add:*)', rule));
    assert.equal(result.status, 'fail', rule);
    assert.match(result.detail, /review-tier/);
  }
});

test('checkAllowRules: rules for other tools or longer commands do not count', () => {
  assert.equal(checkAllowRules(settings('Read(autoskill:*)')).status, 'warn');
  assert.equal(checkAllowRules(settings('Bash(autoskill search:*)')).status, 'warn');
  assert.equal(checkAllowRules(settings('Bash(autoskill-other:*)')).status, 'warn');
});

test('checkSettings reads settings.json under CLAUDE_CONFIG_DIR and fails on broken JSON', () => {
  const home = mkdtempSync(join(tmpdir(), 'autoskill-doctor-'));
  process.env.CLAUDE_CONFIG_DIR = home;
  assert.equal(checkSettings().status, 'warn');
  writeFileSync(join(home, 'settings.json'), JSON.stringify(settings('Bash(autoskill install:*)')));
  assert.equal(checkSettings().status, 'fail');
  writeFileSync(join(home, 'settings.json'), '{ not json');
  assert.equal(checkSettings().status, 'fail');
});

test('measuredBreakdown: counts usable entries and says why the rest are ignored', () => {
  const good = { delta: 0.1, firedRate: 1, measuredAt: '2026-09-01T00:00:00Z', sha: SHA };
  const shas = new Map<string, string | undefined>([
    ['x/y:good', SHA],
    ['x/y:old', SHA],
    ['x/y:quiet', SHA],
    ['x/y:cut', SHA],
    ['x/y:easy', SHA],
    ['x/y:bad', SHA],
    ['x/y:unpinned', undefined],
  ]);
  const breakdown = measuredBreakdown(
    {
      'x/y:good': good,
      'x/y:good#hard': good,
      'x/y:old': { ...good, sha: 'b'.repeat(40) },
      'x/y:quiet': { ...good, firedRate: 0.4 },
      'x/y:cut': { ...good, partial: true },
      'x/y:easy': { ...good, ceiling: true },
      'x/y:bad': { delta: 'lots', sha: SHA },
      'x/y:gone': good,
      'x/y:unpinned': good,
    },
    shas,
  );
  assert.deepEqual(breakdown, {
    usable: 1,
    ignored: {
      variant: 1,
      'stale sha': 1,
      'fired < 50%': 1,
      partial: 1,
      ceiling: 1,
      malformed: 1,
      'not in catalog': 1,
      'index entry has no sha': 1,
    },
  });
});

test('measuredBreakdown: firedRate exactly at the threshold is usable', () => {
  const entry = { delta: 0.1, firedRate: 0.5, measuredAt: '2026-09-01T00:00:00Z', sha: SHA };
  assert.equal(measuredBreakdown({ 'x/y:z': entry }, new Map([['x/y:z', SHA]])).usable, 1);
});

test('checkNode: 22.18 is the floor', () => {
  assert.equal(checkNode('22.18.0').status, 'ok');
  assert.equal(checkNode('24.0.1').status, 'ok');
  assert.equal(checkNode('22.17.9').status, 'fail');
  assert.equal(checkNode('20.19.0').status, 'fail');
});
