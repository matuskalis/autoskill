import { execFileSync } from 'node:child_process';

let cachedToken: string | null | undefined;

/** GITHUB_TOKEN or GH_TOKEN, else the gh CLI's token, else none (60 requests an hour). */
export function githubToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
  if (!cachedToken) {
    try {
      cachedToken = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
    } catch {
      cachedToken = null;
    }
  }
  return cachedToken ?? null;
}

export async function api<T>(path: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (response.ok) return (await response.json()) as T;
    // A 403 is a rate limit only when GitHub says so; otherwise it is a permission error and retrying wastes minutes.
    const limited = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
    if (limited && attempt < 3) {
      const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
      const retryAfter = Number(response.headers.get('retry-after')) * 1000;
      const wait = retryAfter || (reset ? Math.min(Math.max(reset - Date.now(), 1000), 65_000) : 10_000);
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }
    throw new Error(`GitHub ${path}: HTTP ${response.status}`);
  }
}

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/**
 * A file at a pinned commit, through the contents API (5000 an hour with a
 * token). raw.githubusercontent.com is the fallback: it throttles a whole IP
 * once it has served a few thousand files.
 */
export async function fileBytes(repo: string, sha: string, path: string): Promise<Uint8Array> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github.raw', 'X-GitHub-Api-Version': '2022-11-28' };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${encodePath(path)}?ref=${sha}`, { headers, signal: AbortSignal.timeout(30_000) });
  if (response.ok) return new Uint8Array(await response.arrayBuffer());
  if (response.status === 404) throw new Error(`${repo}@${sha.slice(0, 7)}/${path}: HTTP 404`);
  return rawBytes(repo, sha, path);
}

async function rawBytes(repo: string, sha: string, path: string): Promise<Uint8Array> {
  const url = `https://raw.githubusercontent.com/${repo}/${sha}/${encodePath(path)}`;
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (response.ok) return new Uint8Array(await response.arrayBuffer());
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      const retryAfter = Number(response.headers.get('retry-after')) * 1000;
      await new Promise((resolve) => setTimeout(resolve, retryAfter || 2000 * 2 ** attempt));
      continue;
    }
    throw new Error(`${repo}@${sha.slice(0, 7)}/${path}: HTTP ${response.status}`);
  }
}
