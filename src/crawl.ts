import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './frontmatter.ts';
import { api } from './github.ts';
import { PACKAGE_ROOT } from './paths.ts';
import { classify } from './safety.ts';
import { quality } from './score.ts';
import { readRepoFiles } from './tarball.ts';
import type { Catalog, CatalogSkill, SkillFile } from './types.ts';

interface Sources {
  topics: string[];
  minStars: number;
  reposPerTopic: number;
  repos: string[];
  exclude: string[];
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
const MIN_QUALITY = 25;
const STALE_DAYS = 730;
const STALE_MIN_STARS = 50;
const SKIP_PATH = /(^|\/)(node_modules|vendor|dist|build|\.git)\//;

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

async function discover(sources: Sources, log: (line: string) => void): Promise<string[]> {
  const repos = new Set(sources.repos);
  for (const topic of sources.topics) {
    for (let page = 1; page <= Math.ceil(sources.reposPerTopic / 100); page++) {
      const query = encodeURIComponent(`topic:${topic} stars:>=${sources.minStars} archived:false fork:false`);
      const result = await api<{ items: { full_name: string }[] }>(`/search/repositories?q=${query}&sort=stars&per_page=100&page=${page}`);
      for (const item of result.items) repos.add(item.full_name);
      if (result.items.length < 100) break;
    }
  }
  for (const repo of sources.exclude) repos.delete(repo);
  log(`discovered ${repos.size} repos`);
  return [...repos];
}

/** Each file belongs to the deepest skill directory that contains it. */
export function groupFiles(tree: readonly TreeEntry[]): Map<string, SkillFile[]> {
  const blobs = tree.filter((entry) => entry.type === 'blob' && !SKIP_PATH.test(`${entry.path}/`));
  const dirs = blobs
    .filter((entry) => entry.path === 'SKILL.md' || entry.path.endsWith('/SKILL.md'))
    .map((entry) => (entry.path === 'SKILL.md' ? '' : entry.path.slice(0, -'/SKILL.md'.length)))
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

async function crawlRepo(fullName: string, now: number, failures: string[]): Promise<CatalogSkill[]> {
  const repo = await api<RepoInfo>(`/repos/${fullName}`);
  if (repo.archived) return [];
  const branch = await api<{ commit: { sha: string } }>(`/repos/${repo.full_name}/branches/${encodeURIComponent(repo.default_branch)}`);
  const sha = branch.commit.sha;
  const tree = await api<{ tree: TreeEntry[] }>(`/repos/${repo.full_name}/git/trees/${sha}?recursive=1`);
  const groups = [...groupFiles(tree.tree)].slice(0, MAX_SKILLS_PER_REPO);
  if (!groups.length) return [];

  // Every text file a kept skill needs, fetched in one tarball instead of one request each.
  const wanted = new Set<string>();
  for (const [dir, files] of groups) {
    if (files.length > MAX_FILES || files.some((file) => file.path.startsWith('\0'))) continue;
    const texts = files.filter((file) => file.path === 'SKILL.md' || /\.(md|markdown|txt)$/i.test(file.path)).slice(0, MAX_SCANNED_TEXTS + 1);
    for (const file of texts) wanted.add(dir ? `${dir}/${file.path}` : file.path);
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

    const textFiles = files.filter((file) => file.path !== 'SKILL.md' && /\.(md|markdown|txt)$/i.test(file.path));
    const texts: Record<string, string> = {};
    for (const file of textFiles.slice(0, MAX_SCANNED_TEXTS)) {
      const bytes = contents.get(at(file.path));
      if (bytes) texts[file.path] = bytes.toString('utf8');
    }
    const classification = classify(skillMd, files, texts);
    if (textFiles.length > Object.keys(texts).length) {
      classification.risk = 'review';
      classification.reasons.push(`${textFiles.length - Object.keys(texts).length} text files not scanned`);
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

export async function crawl(options: { repos?: string[]; log?: (line: string) => void } = {}): Promise<Catalog> {
  const log = options.log ?? (() => {});
  const sources = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'catalog', 'sources.json'), 'utf8')) as Sources;
  const repos = options.repos ?? (await discover(sources, log));
  const now = Date.now();
  const failures: string[] = [];
  let done = 0;
  const found = await pool(repos, 8, async (repo) => {
    try {
      return await crawlRepo(repo, now, failures);
    } catch (error) {
      log(`skip ${repo}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    } finally {
      if (++done % 50 === 0) log(`${done}/${repos.length} repos`);
    }
  });
  const skills = prune(found.flat(), now);
  log(`${found.flat().length} skills found, ${skills.length} kept, ${failures.length} SKILL.md reads failed`);
  for (const failure of failures.slice(0, 10)) log(`  failed: ${failure}`);
  return { version: 1, generatedAt: new Date(now).toISOString(), skills };
}
