import { createHash } from 'node:crypto';

/**
 * POST: a batch of anonymous skill ratings from an autoskill client that opted in.
 * GET: distinct-install counts per skill, commit, verdict and reason.
 *
 * Everything from the client is validated against fixed shapes; no free text is
 * stored or returned. The date comes from the server. Raw IPs are never stored:
 * only a hash salted per day, used for rate limits.
 */
const VERDICTS = new Set(['helped', 'no-difference', 'hurt']);
const REASONS = new Set(['followed-steps', 'saved-time', 'irrelevant', 'outdated-or-wrong', 'conflicted', 'too-long']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SKILL_ID = /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}:[^\u0000-\u001f\u007f]{0,150}$/;
const SHA = /^[0-9a-f]{40}$/;
const MAX_BODY_BYTES = 20_000;
const MAX_BATCH = 50;
export const PER_INSTALL_PER_DAY = 100;
export const PER_IP_PER_DAY = 500;

export interface Rating {
  skillId: string;
  sha: string;
  verdict: string;
  reason: string;
}

/** The accepted body, or why it was refused. */
export function validate(body: unknown): { installId: string; ratings: Rating[] } | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'body must be a JSON object' };
  const { installId, ratings } = body as { installId?: unknown; ratings?: unknown };
  if (typeof installId !== 'string' || !UUID.test(installId)) return { error: 'installId must be a v4 UUID' };
  if (!Array.isArray(ratings) || !ratings.length || ratings.length > MAX_BATCH) return { error: `ratings must be 1 to ${MAX_BATCH} items` };
  const clean: Rating[] = [];
  for (const item of ratings as Record<string, unknown>[]) {
    const { skillId, sha, verdict, reason } = item ?? {};
    if (typeof skillId !== 'string' || !SKILL_ID.test(skillId)) return { error: 'bad skillId' };
    if (typeof sha !== 'string' || !SHA.test(sha)) return { error: 'bad sha' };
    if (typeof verdict !== 'string' || !VERDICTS.has(verdict)) return { error: 'bad verdict' };
    if (typeof reason !== 'string' || !REASONS.has(reason)) return { error: 'bad reason' };
    clean.push({ skillId, sha, verdict, reason });
  }
  return { installId, ratings: clean };
}

export function ipHash(ip: string, salt: string, day: string): string {
  return createHash('sha256').update(`${salt}|${day}|${ip}`).digest('hex');
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  // A PostgREST error is a non-2xx response; never treat it as success.
  if (!response.ok) throw new Error(`supabase ${path.split('?')[0]}: HTTP ${response.status}`);
  return response;
}

async function countToday(column: 'install_id' | 'ip_hash', value: string, day: string): Promise<number> {
  const response = await rest(`ratings?${column}=eq.${encodeURIComponent(value)}&created_on=eq.${day}&select=id`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact' },
  });
  return Number(response.headers.get('content-range')?.split('/')[1] ?? '0');
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export async function POST(request: Request): Promise<Response> {
  try {
    if (!request.headers.get('content-type')?.includes('application/json')) return json(415, { error: 'send JSON' });
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) return json(413, { error: 'body too large' });
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return json(400, { error: 'invalid JSON' });
    }
    const valid = validate(body);
    if ('error' in valid) return json(400, { error: valid.error });

    const day = new Date().toISOString().slice(0, 10);
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const hashed = ipHash(ip, env('IP_SALT'), day);
    const [byInstall, byIp] = await Promise.all([countToday('install_id', valid.installId, day), countToday('ip_hash', hashed, day)]);
    if (byInstall + valid.ratings.length > PER_INSTALL_PER_DAY || byIp + valid.ratings.length > PER_IP_PER_DAY) {
      return json(429, { error: 'daily limit reached' });
    }

    const rows = valid.ratings.map((r) => ({ install_id: valid.installId, ip_hash: hashed, skill_id: r.skillId, sha: r.sha, verdict: r.verdict, reason: r.reason }));
    await rest('ratings?on_conflict=install_id,skill_id,sha,created_on', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    return json(202, { accepted: rows.length });
  } catch {
    return json(500, { error: 'server error' });
  }
}

export async function GET(): Promise<Response> {
  try {
    const response = await rest('rating_counts?select=skill_id,sha,verdict,reason,installs&limit=100000');
    return json(200, await response.json(), { 'cache-control': 'public, s-maxage=3600, stale-while-revalidate=600' });
  } catch {
    return json(500, { error: 'server error' });
  }
}
