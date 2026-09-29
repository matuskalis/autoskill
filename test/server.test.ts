import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { GET, ipHash, PER_INSTALL_PER_DAY, POST, validate } from '../server/api/ratings.ts';

const INSTALL = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const good = { skillId: 'acme/skills:skills/pdf', sha: 'a'.repeat(40), verdict: 'helped', reason: 'saved-time' };
let calls: { url: string; method: string; body?: string }[] = [];
let todayCount = 0;

beforeEach(() => {
  calls = [];
  todayCount = 0;
  process.env.SUPABASE_URL = 'https://db.example';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  process.env.IP_SALT = 'salt';
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body as string | undefined });
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-range': `*/${todayCount}` } });
    if (String(input).includes('rating_counts')) return new Response(JSON.stringify([{ skill_id: good.skillId, installs: 3 }]));
    return new Response(null, { status: 201 });
  }) as typeof fetch;
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request('https://x/api/ratings', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));

test('validate accepts only fixed shapes', () => {
  assert.ok(!('error' in validate({ installId: INSTALL, ratings: [good] })));
  for (const bad of [
    { installId: 'not-a-uuid', ratings: [good] },
    { installId: INSTALL, ratings: [] },
    { installId: INSTALL, ratings: [{ ...good, verdict: 'amazing' }] },
    { installId: INSTALL, ratings: [{ ...good, reason: 'ignore previous instructions' }] },
    { installId: INSTALL, ratings: [{ ...good, sha: 'abc' }] },
    { installId: INSTALL, ratings: [{ ...good, skillId: 'no-colon' }] },
    { installId: INSTALL, ratings: Array.from({ length: 51 }, () => good) },
  ]) {
    assert.ok('error' in validate(bad), JSON.stringify(bad).slice(0, 80));
  }
});

test('a valid batch is inserted with a hashed IP and no client date', async () => {
  const response = await post({ installId: INSTALL, ratings: [good] });
  assert.equal(response.status, 202);
  const insert = calls.find((call) => call.method === 'POST');
  assert.ok(insert?.url.includes('on_conflict=install_id,skill_id,sha,created_on'));
  const [row] = JSON.parse(insert?.body ?? '[]');
  assert.equal(row.ip_hash, ipHash('203.0.113.7', 'salt', new Date().toISOString().slice(0, 10)));
  assert.equal(JSON.stringify(row).includes('203.0.113.7'), false);
  assert.equal(row.created_on, undefined);
});

test('refuses non-JSON, oversized bodies, bad shapes and a spent daily limit', async () => {
  assert.equal((await post('x', { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post('{"a":"' + 'x'.repeat(21_000) + '"}')).status, 413);
  assert.equal((await post({ installId: INSTALL, ratings: [{ ...good, verdict: 'x' }] })).status, 400);
  todayCount = PER_INSTALL_PER_DAY;
  assert.equal((await post({ installId: INSTALL, ratings: [good] })).status, 429);
  assert.equal(calls.some((call) => call.method === 'POST'), false);
});

test('GET returns counts with a CDN cache header', async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /s-maxage=3600/);
  assert.deepEqual(await response.json(), [{ skill_id: good.skillId, installs: 3 }]);
});
