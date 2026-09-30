import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadIndex, loadMeasured, updateCatalog } from '../src/catalog.ts';

const entry = (delta: number, measuredAt: string, extra = {}) => ({ delta, firedRate: 1, measuredAt, sha: 'a'.repeat(40), ...extra });

test('loadMeasured: newest measurement wins, malformed and partial entries are dropped', () => {
  const state = mkdtempSync(join(tmpdir(), 'autoskill-state-'));
  process.env.AUTOSKILL_HOME = state;
  writeFileSync(
    join(state, 'measured.json'),
    JSON.stringify({
      'x/y:new': entry(0.2, '2999-01-01T00:00:00Z'),
      'x/y:bad': { delta: 'lots', measuredAt: '2999-01-01T00:00:00Z', sha: 'a' },
      'x/y:cut': entry(0.4, '2999-01-01T00:00:00Z', { partial: true }),
    }),
  );
  const measured = loadMeasured();
  assert.equal(measured['x/y:new']?.delta, 0.2);
  assert.equal(measured['x/y:bad'], undefined);
  assert.equal(measured['x/y:cut'], undefined);
});

test('updateCatalog: a missing or non-JSON measured.json does not fail the update', async () => {
  const state = mkdtempSync(join(tmpdir(), 'autoskill-state-'));
  process.env.AUTOSKILL_HOME = state;
  const catalog = '{"version":1,"generatedAt":"2999-01-01T00:00:00Z","skills":[]}';
  for (const measured of [new Response('missing', { status: 404 }), new Response('<html>oops</html>')]) {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) =>
      String(url).endsWith('measured.json') ? measured.clone() : new Response(catalog)) as typeof fetch;
    try {
      await updateCatalog('https://example.test/catalog');
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(existsSync(join(state, 'measured.json')), false);
    assert.equal(readFileSync(join(state, 'index.json'), 'utf8'), catalog);
  }
  mkdirSync(state, { recursive: true });
});

const indexFile = (generatedAt: string, names: string[]) => JSON.stringify({ version: 1, generatedAt, skills: names.map((name) => ({ id: `a/b:${name}`, name, description: name, risk: 'safe', quality: 50 })) });
const withDownloaded = (text: string | null) => {
  const state = mkdtempSync(join(tmpdir(), 'autoskill-state-'));
  process.env.AUTOSKILL_HOME = state;
  if (text !== null) writeFileSync(join(state, 'index.json'), text);
  return loadIndex();
};

test('loadIndex: the newer of the downloaded and the bundled copy wins, a broken download is ignored', () => {
  const bundled = withDownloaded(null);
  assert.ok(bundled.skills.length > 1000, 'the bundled catalog ships with the package');

  const newer = withDownloaded(indexFile('2999-01-01T00:00:00.000Z', ['from-download']));
  assert.deepEqual(newer.skills.map((skill) => skill.name), ['from-download']);

  const older = withDownloaded(indexFile('2000-01-01T00:00:00.000Z', ['from-download']));
  assert.equal(older.generatedAt, bundled.generatedAt);
  assert.equal(older.skills.length, bundled.skills.length);

  for (const broken of ['not json', '{"version":2,"generatedAt":"2999-01-01T00:00:00.000Z","skills":[]}', '{"version":1,"generatedAt":"2999-01-01T00:00:00.000Z"']) {
    assert.equal(withDownloaded(broken).generatedAt, bundled.generatedAt, broken);
  }
});

test('loadIndex: a downloaded copy with the same timestamp as the bundled one is preferred, whatever the key order', () => {
  const bundled = withDownloaded(null);
  const reordered = JSON.stringify({ skills: [{ id: 'a/b:c', name: 'c', description: 'c', risk: 'safe', quality: 1 }], version: 1, generatedAt: bundled.generatedAt });
  assert.deepEqual(withDownloaded(reordered).skills.map((skill) => skill.name), ['c']);
});
