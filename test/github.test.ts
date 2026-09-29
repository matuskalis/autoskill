import assert from 'node:assert/strict';
import { test } from 'node:test';
import { api, fileBytes } from '../src/github.ts';

process.env.GITHUB_TOKEN = 'test-token';

type Reply = { status: number; body?: string; headers?: Record<string, string> };

function stubFetch(replies: Reply[]): { urls: string[]; headers: Headers[] } {
  const seen = { urls: [] as string[], headers: [] as Headers[] };
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    seen.urls.push(String(url));
    seen.headers.push(new Headers(init?.headers));
    const reply = replies.shift() ?? { status: 599 };
    return new Response(reply.body ?? null, { status: reply.status, headers: reply.headers });
  }) as typeof fetch;
  return seen;
}

const TINY_WAIT = { 'retry-after': '0.001' };

test('api sends the token and returns parsed JSON', async () => {
  const seen = stubFetch([{ status: 200, body: '{"ok":true}' }]);
  assert.deepEqual(await api('/repos/acme/skills'), { ok: true });
  assert.equal(seen.urls[0], 'https://api.github.com/repos/acme/skills');
  assert.equal(seen.headers[0]?.get('authorization'), 'Bearer test-token');
});

test('api retries a 429 after retry-after and then succeeds', async () => {
  const seen = stubFetch([
    { status: 429, headers: TINY_WAIT },
    { status: 429, headers: TINY_WAIT },
    { status: 200, body: '{"n":1}' },
  ]);
  assert.deepEqual(await api('/x'), { n: 1 });
  assert.equal(seen.urls.length, 3);
});

test('api gives up on a 429 that never clears, after three retries', async () => {
  const seen = stubFetch(Array.from({ length: 6 }, () => ({ status: 429, headers: TINY_WAIT })));
  await assert.rejects(api('/x'), /GitHub \/x: HTTP 429/);
  // One first try plus three retries.
  assert.equal(seen.urls.length, 4);
});

test('api does not retry a 404', async () => {
  const seen = stubFetch([{ status: 404 }, { status: 200, body: '{}' }]);
  await assert.rejects(api('/missing'), /HTTP 404/);
  assert.equal(seen.urls.length, 1);
});

test('fileBytes reads through the contents API with an encoded path', async () => {
  const seen = stubFetch([{ status: 200, body: 'hello' }]);
  const bytes = await fileBytes('acme/skills', 'a'.repeat(40), 'skills/my skill/SKILL.md');
  assert.equal(Buffer.from(bytes).toString('utf8'), 'hello');
  assert.equal(seen.urls[0], `https://api.github.com/repos/acme/skills/contents/skills/my%20skill/SKILL.md?ref=${'a'.repeat(40)}`);
  assert.equal(seen.headers[0]?.get('accept'), 'application/vnd.github.raw');
});

test('fileBytes falls back to raw.githubusercontent.com on a 403', async () => {
  const seen = stubFetch([{ status: 403 }, { status: 200, body: 'raw body' }]);
  const bytes = await fileBytes('acme/skills', 'b'.repeat(40), 'skills/pdf/SKILL.md');
  assert.equal(Buffer.from(bytes).toString('utf8'), 'raw body');
  assert.equal(seen.urls.length, 2);
  assert.equal(seen.urls[1], `https://raw.githubusercontent.com/acme/skills/${'b'.repeat(40)}/skills/pdf/SKILL.md`);
  assert.equal(seen.headers[1]?.get('authorization'), null);
});

test('fileBytes throws on a 404 without trying raw', async () => {
  const seen = stubFetch([{ status: 404 }, { status: 200, body: 'raw' }]);
  await assert.rejects(fileBytes('acme/skills', 'c'.repeat(40), 'SKILL.md'), /acme\/skills@ccccccc\/SKILL\.md: HTTP 404/);
  assert.equal(seen.urls.length, 1);
});

test('the raw fallback retries a 5xx and gives up on a plain error', async () => {
  const seen = stubFetch([{ status: 403 }, { status: 503, headers: TINY_WAIT }, { status: 200, body: 'ok' }]);
  assert.equal(Buffer.from(await fileBytes('acme/skills', 'd'.repeat(40), 'a.md')).toString('utf8'), 'ok');
  assert.equal(seen.urls.length, 3);

  const again = stubFetch([{ status: 403 }, { status: 410 }]);
  await assert.rejects(fileBytes('acme/skills', 'd'.repeat(40), 'a.md'), /HTTP 410/);
  assert.equal(again.urls.length, 2);
});

test('api: a permission 403 is not retried', async () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls++;
    return new Response('forbidden', { status: 403, headers: { 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60) } });
  }) as typeof fetch;
  try {
    await assert.rejects(api('/repos/a/b'), /HTTP 403/);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls, 1);
});
