import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeCatalog } from '../src/catalog.ts';
import { skill } from './fixtures.ts';

test('`add` refuses a review-tier skill even with --yes, before any download', () => {
  const home = mkdtempSync(join(tmpdir(), 'autoskill-cli-'));
  const state = join(home, 'state');
  writeCatalog(
    { version: 1, generatedAt: '2999-01-01T00:00:00.000Z', skills: [skill('scripted', 'Runs helper scripts.', { risk: 'review', riskReasons: ['ships 1 non-text file (run.py)'] })] },
    state,
  );
  const run = (args: string[]) =>
    spawnSync(process.execPath, ['src/cli.ts', ...args], {
      encoding: 'utf8',
      // An unroutable proxy: any network attempt would fail loudly instead of installing.
      env: { ...process.env, CLAUDE_CONFIG_DIR: home, AUTOSKILL_HOME: state, HTTPS_PROXY: 'http://127.0.0.1:9', GITHUB_TOKEN: 'x' },
    });
  for (const args of [['add', 'acme/skills:skills/scripted'], ['add', 'acme/skills:skills/scripted', '--yes']]) {
    const result = run(args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stdout, /review-tier/);
    assert.match(result.stdout, /autoskill install acme\/skills:skills\/scripted --yes/);
  }
  assert.equal(existsSync(join(home, 'skills', 'scripted')), false);
});
