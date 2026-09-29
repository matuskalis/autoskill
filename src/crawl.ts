import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter.ts';
import { api } from './github.ts';
import { PACKAGE_ROOT } from './paths.ts';
import { classify, isTextFile, redFlags } from './safety.ts';
import { quality } from './score.ts';
import { readRepoFiles } from './tarball.ts';
import type { Catalog, CatalogSkill, SkillFile } from './types.ts';

interface Sources {
  topics: string[];
  /** Free-text repository searches: the most-starred skill repos often carry no topic at all. */
  queries?: string[];
  /**
   * Each repo costs about one REST call, and the Actions GITHUB_TOKEN allows 1000 an hour.
   * Seeds and topics come first; query results fill up to this many.
   */
  maxRepos?: number;
  minStars: number;
  reposPerTopic: number;
  repos: string[];
  exclude: string[];
  /** Skill ids dropped after a red flag was confirmed by hand. */
  excludeSkills?: string[];
  /** Skill id to the fingerprint of flags a person reviewed and found benign; a changed finding is held again. */
  clearedFlags?: Record<string, string>;
}

interface RepoInfo {
  full_name: string;
  stargazers_count: number;
  archived: boolean;
  fork: boolean;
  pushed_at: string;
  default_branch: string;
  license: { spdx_id: string | null } | null;
}

interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  mode: string;
  size?: number;
}

const MAX_SKILLS_PER_REPO = 400;
const MAX_FILES = 60;
const MAX_SCANNED_TEXTS = 12;
export const HELD_REASON = 'held for manual review';
/** Scripts are read only for the red-flag scan; their tier is already review. */
const MAX_SCANNED_SCRIPT_BYTES = 200_000;
const SCRIPT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|ps1|php|json|ya?ml|toml)$/i;
const MIN_QUALITY = 25;
const STALE_DAYS = 730;
const STALE_MIN_STARS = 50;
const SKIP_PATH = /(^|\/)(node_modules|vendor|dist|build|\.git)\//;
/** A SKILL.md under a test or fixture directory is test data, often a deliberately malicious sample, never an installable skill. */
const TEST_DIR = /(^|\/)(tests?|__tests__|fixtures?|__fixtures__|test[_-]skills|testdata)(\/|$)/i;

async function pool<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index] as T);
      }
    }),
  );
  return results;
}

/**
 * Repos to crawl, with the metadata the search already returned. The Actions
 * GITHUB_TOKEN allows 1000 REST calls an hour, so nothing is fetched twice:
 * only seed repos the search did not return need a /repos call later.
 */
async function discover(sources: Sources, log: (line: string) => void): Promise<Map<string, RepoInfo | null>> {
  const repos = new Map<string, RepoInfo | null>(sources.repos.map((repo) => [repo, null]));
  const searches = [...sources.topics.map((topic) => ({ search: `topic:${topic}`, capped: false })), ...(sources.queries ?? []).map((search) => ({ search, capped: true }))];
  const cap = sources.maxRepos ?? Infinity;
  for (const { search, capped } of searches) {
    for (let page = 1; page <= Math.ceil(sources.reposPerTopic / 100); page++) {
      if (capped && repos.size >= cap) break;
      const query = encodeURIComponent(`${search} stars:>=${sources.minStars} archived:false fork:false`);
      const result = await api<{ items: RepoInfo[] }>(`/search/repositories?q=${query}&sort=stars&per_page=100&page=${page}`);
      for (const item of result.items) if (!capped || repos.has(item.full_name) || repos.size < cap) repos.set(item.full_name, item);
      if (result.items.length < 100) break;
    }
  }
  for (const repo of sources.exclude) repos.delete(repo);
  log(`discovered ${repos.size} repos`);
  return repos;
}

/** ls-remote matches refs by their tail, so `a/refs/heads/main` also answers for `main`: take the exact ref. */
export function parseLsRemote(stdout: string, branch: string): string | null {
  const line = stdout.split('\n').find((row) => row.split('\t')[1] === `refs/heads/${branch}`);
  const sha = line?.split('\t')[0] ?? '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** The branch head through git, which does not count against the REST limit. */
async function headSha(repo: string, branch: string): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)('git', ['ls-remote', `https://github.com/${repo}.git`, `refs/heads/${branch}`], {
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const sha = parseLsRemote(stdout, branch);
    if (sha) return sha;
  } catch {}
  return (await api<{ commit: { sha: string } }>(`/repos/${repo}/branches/${encodeURIComponent(branch)}`)).commit.sha;
}

/** Each file belongs to the deepest skill directory that contains it. */
export function groupFiles(tree: readonly TreeEntry[]): Map<string, SkillFile[]> {
  const blobs = tree.filter((entry) => entry.type === 'blob' && !SKIP_PATH.test(`${entry.path}/`));
  const dirs = blobs
    .filter((entry) => entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md'))
    .map((entry) => (entry.path === 'SKILL.md' ? '' : entry.path.slice(0, -'/SKILL.md'.length)))
    .filter((dir) => !TEST_DIR.test(dir))
    .sort((a, b) => b.length - a.length);
  const groups = new Map<string, SkillFile[]>(dirs.map((dir) => [dir, []]));
  for (const blob of blobs) {
    const owner = dirs.find((dir) => dir === '' || blob.path.startsWith(`${dir}/`));
    if (owner === undefined) continue;
    // A symlink would install as a plain file holding its target path; mark it so the skill is dropped.
    const path = owner ? blob.path.slice(owner.length + 1) : blob.path;
    groups.get(owner)?.push({ path: blob.mode === '120000' ? `\0symlink:${path}` : path, size: blob.size ?? 0 });
  }
  return groups;
}

/** Stable over crawls while the flagged lines stay the same; any new or edited finding changes it. */
export function flagFingerprint(flags: readonly { rule: string; path: string; snippet: string }[]): string {
  const lines = flags.map((flag) => `${flag.rule}|${flag.path}|${flag.snippet}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

async function crawlRepo(
  fullName: string,
  known: RepoInfo | null,
  now: number,
  failures: string[],
  cleared: Readonly<Record<string, string>> = {},
): Promise<CatalogSkill[]> {
  const repo = known ?? (await api<RepoInfo>(`/repos/${fullName}`));
  if (repo.archived || repo.fork) return [];
  const sha = await headSha(repo.full_name, repo.default_branch);
  const tree = await api<{ tree: TreeEntry[] }>(`/repos/${repo.full_name}/git/trees/${sha}?recursive=1`);
  const groups = [...groupFiles(tree.tree)].slice(0, MAX_SKILLS_PER_REPO);
  if (!groups.length) return [];

  // Every text file a kept skill needs, fetched in one tarball instead of one request each.
  const wanted = new Set<string>();
  for (const [dir, files] of groups) {
    if (files.length > MAX_FILES || files.some((file) => file.path.startsWith('\0'))) continue;
    const texts = files.filter((file) => file.path !== 'SKILL.md' && isTextFile(file.path)).slice(0, MAX_SCANNED_TEXTS);
    const scripts = files.filter((file) => SCRIPT.test(file.path) && file.size <= MAX_SCANNED_SCRIPT_BYTES);
    for (const path of ['SKILL.md', ...texts.map((file) => file.path), ...scripts.map((file) => file.path)]) {
      wanted.add(dir ? `${dir}/${path}` : path);
    }
  }
  const contents = await readRepoFiles(repo.full_name, sha, (path) => wanted.has(path));

  const skills = groups.map(([dir, files]): CatalogSkill | null => {
    if (files.length > MAX_FILES || files.some((file) => file.path.startsWith('\0'))) return null;
    const at = (path: string) => (dir ? `${dir}/${path}` : path);
    const skillBytes = contents.get(at('SKILL.md'));
    if (!skillBytes) {
      failures.push(`${repo.full_name}:${at('SKILL.md')} missing from tarball`);
      return null;
    }
    const skillMd = skillBytes.toString('utf8');
    const { fields, body } = parseFrontmatter(skillMd);
    const firstLine = body.split('\n').find((line) => line.trim() && !line.startsWith('#'))?.trim() ?? '';
    const description = [fields.description || firstLine, fields.when_to_use].filter(Boolean).join(' ');
    if (!description) return null;

    const textFiles = files.filter((file) => file.path !== 'SKILL.md' && isTextFile(file.path));
    const texts: Record<string, string> = {};
    for (const file of textFiles.slice(0, MAX_SCANNED_TEXTS)) {
      const bytes = contents.get(at(file.path));
      if (bytes) texts[file.path] = bytes.toString('utf8');
    }
    const classification = classify(skillMd, files, texts);
    if (textFiles.length > Object.keys(texts).length) {
      classification.risk = 'review';
      const missing = textFiles.length - Object.keys(texts).length;
      classification.reasons.push(`${missing} text file${missing === 1 ? '' : 's'} not scanned`);
    }

    const scanned: Record<string, string> = { 'SKILL.md': skillMd, ...texts };
    for (const file of files) {
      const bytes = SCRIPT.test(file.path) ? contents.get(at(file.path)) : undefined;
      if (bytes) scanned[file.path] = bytes.toString('utf8');
    }
    const flags = redFlags(scanned);
    // The evidence stays private until a person has checked it: the public catalog only says the skill is held.
    if (flags.length && cleared[`${repo.full_name}:${dir}`] !== flagFingerprint(flags)) {
      classification.risk = 'review';
      classification.reasons.push(HELD_REASON);
    }

    const license = fields.license || repo.license?.spdx_id || null;
    const entry: CatalogSkill = {
      id: `${repo.full_name}:${dir}`,
      name: fields.name || dir.split('/').pop() || repo.full_name.split('/')[1] || 'skill',
      description,
      repo: repo.full_name,
      dir,
      sha,
      stars: repo.stargazers_count,
      pushedAt: repo.pushed_at,
      license: license === 'NOASSERTION' ? null : license,
      files,
      hash: createHash('sha256').update(skillBytes).digest('hex'),
      risk: classification.risk,
      riskReasons: classification.reasons,
      ...(flags.length ? { flags } : {}),
      quality: 0,
    };
    entry.quality = quality({ ...entry, bodyLength: body.length }, now);
    return entry;
  });
  return skills.filter((skill): skill is CatalogSkill => skill !== null);
}

/** Keeps what is worth suggesting: described, not stale, above the quality floor, one copy per SKILL.md. */
export function prune(skills: readonly CatalogSkill[], now = Date.now()): CatalogSkill[] {
  const byHash = new Map<string, CatalogSkill>();
  for (const skill of skills) {
    const stale = (now - Date.parse(skill.pushedAt)) / 86_400_000 > STALE_DAYS && skill.stars < STALE_MIN_STARS;
    if (stale || skill.quality < MIN_QUALITY) continue;
    const kept = byHash.get(skill.hash);
    if (!kept || skill.stars > kept.stars) byHash.set(skill.hash, skill);
  }
  return [...byHash.values()].sort((a, b) => b.quality - a.quality || a.id.localeCompare(b.id));
}

export interface CrawlResult {
  catalog: Catalog;
  /** Red-flag evidence by skill id. Never published: it names repos before anyone has verified a finding. */
  flags: Record<string, NonNullable<CatalogSkill['flags']>>;
}

export async function crawl(options: { repos?: string[]; log?: (line: string) => void } = {}): Promise<CrawlResult> {
  const log = options.log ?? (() => {});
  const sources = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'catalog', 'sources.json'), 'utf8')) as Sources;
  const discovered = options.repos ? new Map(options.repos.map((repo) => [repo, null])) : await discover(sources, log);
  const repos = [...discovered.keys()];
  const now = Date.now();
  const failures: string[] = [];
  let done = 0;
  const found = await pool(repos, 8, async (repo) => {
    try {
      return await crawlRepo(repo, discovered.get(repo) ?? null, now, failures, sources.clearedFlags ?? {});
    } catch (error) {
      log(`skip ${repo}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    } finally {
      if (++done % 50 === 0) log(`${done}/${repos.length} repos`);
    }
  });
  const excluded = new Set(sources.excludeSkills ?? []);
  const kept = prune(found.flat().filter((skill) => !excluded.has(skill.id)), now);
  const flags: CrawlResult['flags'] = {};
  const skills = kept.map(({ flags: evidence, ...skill }) => {
    if (evidence?.length) flags[skill.id] = evidence;
    return skill;
  });
  log(`${found.flat().length} skills found, ${skills.length} kept, ${Object.keys(flags).length} held for review, ${failures.length} SKILL.md reads failed`);
  for (const failure of failures.slice(0, 10)) log(`  failed: ${failure}`);
  return { catalog: { version: 1, generatedAt: new Date(now).toISOString(), skills }, flags };
}
