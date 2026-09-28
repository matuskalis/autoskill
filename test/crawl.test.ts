import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupFiles, prune } from '../src/crawl.ts';
import { quality } from '../src/score.ts';
import { skill } from './fixtures.ts';

const blob = (path: string, mode = '100644') => ({ path, type: 'blob' as const, mode, size: 1 });

test('files go to the deepest skill that contains them', () => {
  const groups = groupFiles([
    blob('skills/a/SKILL.md'),
    blob('skills/a/scripts/run.py'),
    blob('skills/a/nested/SKILL.md'),
    blob('skills/a/nested/ref.md'),
    blob('README.md'),
    blob('node_modules/x/SKILL.md'),
  ]);
  assert.deepEqual([...groups.keys()].sort(), ['skills/a', 'skills/a/nested']);
  assert.deepEqual(groups.get('skills/a')?.map((f) => f.path), ['SKILL.md', 'scripts/run.py']);
  assert.deepEqual(groups.get('skills/a/nested')?.map((f) => f.path), ['SKILL.md', 'ref.md']);
});

test('symlinks are marked so the skill is dropped', () => {
  const groups = groupFiles([blob('s/SKILL.md'), blob('s/link.md', '120000')]);
  assert.ok(groups.get('s')?.some((f) => f.path.startsWith('\0')));
});

test('prune drops stale, low-quality and duplicate skills', () => {
  const old = '2020-01-01T00:00:00Z';
  const kept = prune([
    skill('a', 'x', { hash: 'same', stars: 10 }),
    skill('b', 'x', { hash: 'same', stars: 500, id: 'big/repo:b' }),
    skill('c', 'x', { hash: 'c', pushedAt: old, stars: 3 }),
    skill('d', 'x', { hash: 'd', quality: 10 }),
    skill('e', 'x', { hash: 'e', pushedAt: old, stars: 5000 }),
  ]);
  assert.deepEqual(kept.map((s) => s.name).sort(), ['b', 'e']);
});

test('quality rewards a described, fresh, licensed, starred skill', () => {
  const now = Date.parse('2026-09-28T00:00:00Z');
  const base = { repo: 'x/y', stars: 1000, pushedAt: '2026-09-01T00:00:00Z', license: 'MIT', bodyLength: 2000 };
  const good = quality({ ...base, description: 'Formats SQL queries. Use when the user pastes SQL that needs cleaning up.' }, now);
  const bare = quality({ ...base, stars: 0, license: null, pushedAt: '2023-01-01T00:00:00Z', description: 'sql', bodyLength: 50 }, now);
  assert.equal(good, 83);
  assert.equal(bare, 3);
});
