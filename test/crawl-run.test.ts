import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { crawl } from '../src/crawl.ts';

process.env.GITHUB_TOKEN = 'test-token';

const root = mkdtempSync(join(tmpdir(), 'autoskill-crawl-'));
const SHA = 'e'.repeat(40);
const LS_REMOTE_SHA = 'f'.repeat(40);
const SYMLINK = Symbol('symlink');

// A fake `git` first on PATH: headSha shells out to `git ls-remote`, which must never reach github.com.
// FAKE_GIT_SHA set: answers like ls-remote; unset: fails, so crawl takes the REST /branches fallback.
const bin = join(root, 'bin');
mkdirSync(bin);
writeFileSync(join(bin, 'git'), '#!/bin/sh\n[ -n "$FAKE_GIT_SHA" ] || exit 1\nprintf "%s\\t%s\\n" "$FAKE_GIT_SHA" "$3"\n');
chmodSync(join(bin, 'git'), 0o755);
process.env.PATH = `${bin}:${process.env.PATH}`;

interface FakeRepo {
  info: { full_name: string; stargazers_count: number; archived: boolean; fork: boolean; pushed_at: string; default_branch: string; license: { spdx_id: string | null } | null };
  files: Record<string, string | typeof SYMLINK>;
  /** Paths listed in the tree but left out of the tarball. */
  missing?: string[];
  archive?: Buffer;
}

let repos: Record<string, FakeRepo> = {};
let requests: string[] = [];

function repo(fullName: string, files: FakeRepo['files'], extra: Partial<FakeRepo['info']> = {}, missing: string[] = []): FakeRepo {
  return {
    info: { full_name: fullName, stargazers_count: 1000, archived: false, fork: false, pushed_at: new Date().toISOString(), default_branch: 'main', license: { spdx_id: 'MIT' }, ...extra },
    files,
    missing,
  };
}

function tarball(fake: FakeRepo): Buffer {
  const dir = mkdtempSync(join(root, 'repo-'));
  const top = `${fake.info.full_name.replace('/', '-')}-${SHA.slice(0, 7)}`;
  for (const [path, content] of Object.entries(fake.files)) {
    if (content === SYMLINK || fake.missing?.includes(path)) continue;
    mkdirSync(dirname(join(dir, top, path)), { recursive: true });
    writeFileSync(join(dir, top, path), content);
  }
  mkdirSync(join(dir, top), { recursive: true });
  execFileSync('tar', ['-czf', join(dir, 'a.tar.gz'), '-C', dir, top], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  return readFileSync(join(dir, 'a.tar.gz'));
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

globalThis.fetch = (async (input: string | URL) => {
  const url = new URL(String(input));
  requests.push(`${url.host}${url.pathname}`);
  const codeload = url.pathname.match(/^\/([^/]+\/[^/]+)\/tar\.gz\/([0-9a-f]{40})$/);
  if (url.host === 'codeload.github.com' && codeload) {
    const fake = repos[codeload[1] as string];
    if (!fake) return new Response('missing', { status: 404 });
    fake.archive ??= tarball(fake);
    return new Response(new Uint8Array(fake.archive));
  }
  const match = url.pathname.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
  const fake = match ? repos[match[1] as string] : undefined;
  if (url.host !== 'api.github.com' || !match || !fake) return new Response('missing', { status: 404 });
  const rest = match[2] ?? '';
  if (rest === '') return json(fake.info);
  if (rest === `/branches/${fake.info.default_branch}`) return json({ commit: { sha: SHA } });
  if (rest === `/git/trees/${SHA}` && url.searchParams.get('recursive') === '1') {
    const tree = Object.entries(fake.files).map(([path, content]) => ({
      path,
      type: 'blob',
      mode: content === SYMLINK ? '120000' : '100644',
      size: content === SYMLINK ? 10 : Buffer.byteLength(content),
    }));
    return json({ tree });
  }
  return new Response('missing', { status: 404 });
}) as typeof fetch;

const body = 'Format the query, align the keywords, and keep one clause per line. '.repeat(6);
const skillMd = (name: string, description = `Formats ${name} SQL queries neatly. Use when the user pastes SQL that needs cleaning up.`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`;

beforeEach(() => {
  repos = {};
  requests = [];
  delete process.env.FAKE_GIT_SHA;
});

test('crawls a repo end to end through REST, the /branches fallback and the tarball', async () => {
  repos['acme/skills'] = repo('acme/skills', { 'README.md': '# readme', 'skills/sql/SKILL.md': skillMd('sql'), 'skills/sql/ref/tips.md': 'Short bullets.' });
  const catalog = await crawl({ repos: ['acme/skills'] });

  assert.equal(catalog.version, 1);
  assert.equal(catalog.skills.length, 1);
  const [sql] = catalog.skills;
  assert.equal(sql?.id, 'acme/skills:skills/sql');
  assert.equal(sql?.name, 'sql');
  assert.equal(sql?.sha, SHA);
  assert.equal(sql?.stars, 1000);
  assert.equal(sql?.license, 'MIT');
  assert.equal(sql?.risk, 'safe');
  assert.deepEqual(sql?.riskReasons, []);
  assert.deepEqual(sql?.files.map((f) => f.path), ['SKILL.md', 'ref/tips.md']);
  assert.ok((sql?.quality ?? 0) >= 25);
  assert.ok(requests.includes('api.github.com/repos/acme/skills/branches/main'), 'fell back to /branches when git failed');
  assert.ok(requests.includes(`codeload.github.com/acme/skills/tar.gz/${SHA}`));
});

test('uses the ls-remote sha and skips /branches when git answers', async () => {
  process.env.FAKE_GIT_SHA = LS_REMOTE_SHA;
  repos['acme/skills'] = repo('acme/skills', { 'SKILL.md': skillMd('root') });
  await crawl({ repos: ['acme/skills'] });
  assert.ok(requests.includes(`api.github.com/repos/acme/skills/git/trees/${LS_REMOTE_SHA}`));
  assert.ok(!requests.some((r) => r.includes('/branches/')));
});

test('archived and forked repos are skipped before any tree or tarball request', async () => {
  repos['acme/old'] = repo('acme/old', { 'SKILL.md': skillMd('old') }, { archived: true });
  repos['acme/copy'] = repo('acme/copy', { 'SKILL.md': skillMd('copy') }, { fork: true });
  const catalog = await crawl({ repos: ['acme/old', 'acme/copy'] });
  assert.deepEqual(catalog.skills, []);
  assert.deepEqual(requests.sort(), ['api.github.com/repos/acme/copy', 'api.github.com/repos/acme/old']);
});

test('a skill with a symlink or more than 60 files is dropped, its neighbour kept', async () => {
  const many: Record<string, string> = { 'big/SKILL.md': skillMd('big') };
  for (let i = 0; i < 60; i++) many[`big/ref/${i}.md`] = `note ${i}`;
  repos['acme/skills'] = repo('acme/skills', {
    ...many,
    'linked/SKILL.md': skillMd('linked'),
    'linked/ref.md': SYMLINK,
    'good/SKILL.md': skillMd('good'),
  });
  const catalog = await crawl({ repos: ['acme/skills'] });
  assert.deepEqual(catalog.skills.map((s) => s.dir), ['good']);
});

test('a skill that ships a script is labelled review with the reason', async () => {
  repos['acme/skills'] = repo('acme/skills', { 'tool/SKILL.md': skillMd('tool'), 'tool/scripts/run.py': 'print("hi")\n' });
  const [tool] = (await crawl({ repos: ['acme/skills'] })).skills;
  assert.equal(tool?.risk, 'review');
  assert.deepEqual(tool?.riskReasons, ['ships 1 non-text file (scripts/run.py)']);
});

test('a text file missing from the tarball marks the skill for review', async () => {
  repos['acme/skills'] = repo('acme/skills', { 'doc/SKILL.md': skillMd('doc'), 'doc/ref.md': 'unseen' }, {}, ['doc/ref.md']);
  const [doc] = (await crawl({ repos: ['acme/skills'] })).skills;
  assert.equal(doc?.risk, 'review');
  assert.deepEqual(doc?.riskReasons, ['1 text files not scanned']);
});

test('a SKILL.md missing from the tarball is logged as a failure', async () => {
  repos['acme/skills'] = repo('acme/skills', { 'gone/SKILL.md': skillMd('gone') }, {}, ['gone/SKILL.md']);
  const lines: string[] = [];
  const catalog = await crawl({ repos: ['acme/skills'], log: (line) => lines.push(line) });
  assert.deepEqual(catalog.skills, []);
  assert.ok(lines.includes('  failed: acme/skills:gone/SKILL.md missing from tarball'));
});

test('identical SKILL.md across repos keeps only the most-starred copy', async () => {
  const same = skillMd('dup');
  repos['small/one'] = repo('small/one', { 'dup/SKILL.md': same }, { stargazers_count: 20 });
  repos['big/one'] = repo('big/one', { 'dup/SKILL.md': same }, { stargazers_count: 5000 });
  repos['mid/one'] = repo('mid/one', { 'dup/SKILL.md': same }, { stargazers_count: 300 });
  const catalog = await crawl({ repos: ['small/one', 'big/one', 'mid/one'] });
  assert.deepEqual(catalog.skills.map((s) => s.repo), ['big/one']);
});

test('a repo that fails is logged and skipped without sinking the crawl', async () => {
  repos['acme/skills'] = repo('acme/skills', { 'SKILL.md': skillMd('root') });
  const lines: string[] = [];
  const catalog = await crawl({ repos: ['nobody/here', 'acme/skills'], log: (line) => lines.push(line) });
  assert.deepEqual(catalog.skills.map((s) => s.repo), ['acme/skills']);
  assert.ok(lines.includes('skip nobody/here: GitHub /repos/nobody/here: HTTP 404'));
});
