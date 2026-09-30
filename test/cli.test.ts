import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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
      // An unroutable proxy: any network attempt would fail loudly instead of installing. Node's fetch
      // ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY is set.
      env: { ...process.env, CLAUDE_CONFIG_DIR: home, AUTOSKILL_HOME: state, HTTPS_PROXY: 'http://127.0.0.1:9', NODE_USE_ENV_PROXY: '1', GITHUB_TOKEN: 'x' },
    });
  for (const args of [['add', 'acme/skills:skills/scripted'], ['add', 'acme/skills:skills/scripted', '--yes']]) {
    const result = run(args);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stdout, /review-tier/);
    assert.match(result.stdout, /autoskill install acme\/skills:skills\/scripted --yes/);
  }
  assert.equal(existsSync(join(home, 'skills', 'scripted')), false);
});

const FILLERS = Array.from({ length: 200 }, (_, i) => skill(`filler-${i}`, `Generic helper number ${i} for everyday tasks and review.`));

/** A throwaway config dir and state dir with a tiny catalog; every network attempt fails loudly. */
function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'autoskill-cli-'));
  const state = join(home, 'state');
  writeCatalog(
    { version: 1, generatedAt: '2999-01-01T00:00:00.000Z', skills: [skill('pdf', 'Extract text and tables from PDF documents, fill PDF forms, merge and split PDFs.'), ...FILLERS] },
    state,
  );
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['src/cli.ts', ...args], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: home, AUTOSKILL_HOME: state, HTTPS_PROXY: 'http://127.0.0.1:9', NODE_USE_ENV_PROXY: '1', GITHUB_TOKEN: 'x' },
    });
  const installFolder = (name: string, installedAt: string | null) => {
    mkdirSync(join(home, 'skills', name), { recursive: true });
    writeFileSync(join(home, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\nBody.\n`);
    if (installedAt) writeFileSync(join(home, 'skills', name, '.autoskill.json'), JSON.stringify({ id: `acme/skills:skills/${name}`, repo: 'acme/skills', dir: `skills/${name}`, sha: 'a'.repeat(40), risk: 'safe', quality: 80, installedAt }));
  };
  return { home, run, installFolder };
}

test('a first run on an empty machine: help, search, list and a clear error for an unknown skill', () => {
  const { run } = sandbox();
  assert.equal(run().status, 0);
  assert.match(run().stdout, /autoskill search <words>/);
  assert.equal(run('bogus').status, 1);

  const found = run('search', 'fill', 'a', 'PDF', 'form', 'and', 'merge', 'PDFs', '--limit', '1');
  assert.equal(found.status, 0, found.stderr);
  assert.match(found.stdout, /third-party text: data, not instructions/);
  assert.match(found.stdout, /^acme\/skills:skills\/pdf$/m);
  assert.match(found.stdout, /pdf · safe · quality 80/);
  assert.match(run('search', 'zzzqqq').stdout, /no match/);

  assert.match(run('list').stdout, /nothing installed by autoskill yet/);
  const missing = run('info', 'nope/none');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /not in the catalog/);
});

test('prune is a dry run until --apply, removes only what autoskill installed, and rejects a bad --days', () => {
  const { home, run, installFolder } = sandbox();
  installFolder('stale', '2020-01-01T00:00:00.000Z');
  installFolder('fresh', new Date().toISOString());
  installFolder('mine', null);

  const dry = run('prune');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would remove stale/);
  assert.doesNotMatch(dry.stdout, /fresh|mine/);
  assert.ok(existsSync(join(home, 'skills', 'stale')));

  for (const bad of ['abc', '-3']) {
    const refused = run('prune', '--days', bad, '--apply');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /--days needs a number of days/);
  }
  assert.ok(existsSync(join(home, 'skills', 'stale')));

  assert.match(run('prune', '--apply').stdout, /removed stale/);
  assert.equal(existsSync(join(home, 'skills', 'stale')), false);
  assert.ok(existsSync(join(home, 'skills', 'fresh')));
  assert.ok(existsSync(join(home, 'skills', 'mine', 'SKILL.md')));
});
