import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readRepoFiles } from '../src/tarball.ts';

test('reads wanted files from a codeload-style tarball, long paths included', async () => {
  const root = mkdtempSync(join(tmpdir(), 'autoskill-tar-'));
  const top = join(root, 'acme-skills-abc123');
  const deep = `skills/${'nested-directory-name/'.repeat(6)}deep`;
  mkdirSync(join(top, deep), { recursive: true });
  mkdirSync(join(top, 'skills/pdf'), { recursive: true });
  writeFileSync(join(top, 'skills/pdf/SKILL.md'), '---\nname: pdf\n---\nbody ✓\n');
  writeFileSync(join(top, 'skills/pdf/big.bin'), Buffer.alloc(70_000, 7));
  writeFileSync(join(top, deep, 'SKILL.md'), 'deep one');
  const archive = join(root, 'repo.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', root, 'acme-skills-abc123'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });

  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(readFileSync(archive))) as typeof fetch;
  try {
    const files = await readRepoFiles('acme/skills', 'abc123', (path) => path.endsWith('SKILL.md'));
    assert.deepEqual([...files.keys()].sort(), [`${deep}/SKILL.md`, 'skills/pdf/SKILL.md'].sort());
    assert.equal(files.get('skills/pdf/SKILL.md')?.toString('utf8'), '---\nname: pdf\n---\nbody ✓\n');
    assert.equal(files.get(`${deep}/SKILL.md`)?.toString('utf8'), 'deep one');
  } finally {
    globalThis.fetch = original;
  }
});
