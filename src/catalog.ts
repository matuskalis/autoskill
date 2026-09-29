import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUNDLED_CATALOG_DIR, CATALOG_BASE_URL, stateDir } from './paths.ts';
import { buildPostings, type Postings, type Searchable } from './search.ts';
import type { Catalog } from './types.ts';

/** The slim file the hook reads on every prompt: enough to rank and describe a skill. */
export interface SearchIndex {
  version: 1;
  generatedAt: string;
  skills: Searchable[];
  postings?: Postings;
}

type Versioned = { version: 1; generatedAt: string; skills: unknown[] };
const FILES = ['catalog.json', 'index.json'] as const;
type CatalogFile = (typeof FILES)[number];
const INDEX_DESCRIPTION_CHARS = 300;

function read<T extends Versioned>(path: string): T | null {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as T;
    return data.version === 1 && Array.isArray(data.skills) ? data : null;
  } catch {
    return null;
  }
}

/** The newer of the downloaded copy and the one shipped with the package. */
function load<T extends Versioned>(file: CatalogFile): T {
  const cached = read<T>(join(stateDir(), file));
  const bundled = read<T>(join(BUNDLED_CATALOG_DIR, file));
  if (cached && (!bundled || cached.generatedAt >= bundled.generatedAt)) return cached;
  return bundled ?? cached ?? ({ version: 1, generatedAt: '1970-01-01T00:00:00.000Z', skills: [] } as unknown as T);
}

export const loadCatalog = () => load<Catalog>('catalog.json');

/** What the hook needs from `autoskill eval` results: the measured uplift per skill id. */
export interface MeasuredDelta {
  delta: number;
  firedRate: number;
  measuredAt: string;
  /** The commit that was measured; a measurement says nothing about a later commit. */
  sha: string;
  partial?: boolean;
  ceiling?: boolean;
}

/** Measured results, shipped and downloaded; for one skill the more recent measurement wins. */
export function loadMeasured(): Record<string, MeasuredDelta> {
  const merged: Record<string, MeasuredDelta> = {};
  for (const path of [join(BUNDLED_CATALOG_DIR, 'measured.json'), join(stateDir(), 'measured.json')]) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, MeasuredDelta>;
      for (const [id, entry] of Object.entries(data)) {
        if (typeof entry?.delta !== 'number' || typeof entry.sha !== 'string' || entry.partial) continue;
        if (!merged[id] || entry.measuredAt > merged[id].measuredAt) merged[id] = entry;
      }
    } catch {}
  }
  return merged;
}
export const loadIndex = () => load<SearchIndex>('index.json');

export function buildIndex(catalog: Catalog): SearchIndex {
  const skills = catalog.skills.map(({ id, name, description, risk, quality, sha }) => ({
    id,
    sha,
    name,
    description: description.slice(0, INDEX_DESCRIPTION_CHARS),
    risk,
    quality,
  }));
  return { version: 1, generatedAt: catalog.generatedAt, skills, postings: buildPostings(catalog.skills) };
}

/** One skill per line, so a crawl commits a small diff instead of a new 20 MB blob. */
export function serialize(data: Versioned & { postings?: Postings }): string {
  const lines = data.skills.map((skill) => JSON.stringify(skill));
  const postings = data.postings ? `,\n"postings":${JSON.stringify(data.postings)}` : '';
  return `{"version":1,"generatedAt":${JSON.stringify(data.generatedAt)},"skills":[\n${lines.join(',\n')}\n]${postings}}\n`;
}

function writeAtomic(path: string, text: string) {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

export function writeCatalog(catalog: Catalog, dir: string) {
  mkdirSync(dir, { recursive: true });
  writeAtomic(join(dir, 'catalog.json'), serialize(catalog));
  writeAtomic(join(dir, 'index.json'), serialize(buildIndex(catalog)));
}

export function catalogAgeDays(now = Date.now()): number {
  const path = join(stateDir(), 'index.json');
  if (!existsSync(path)) return Infinity;
  return (now - statSync(path).mtimeMs) / 86_400_000;
}

export async function updateCatalog(baseUrl = CATALOG_BASE_URL): Promise<Catalog> {
  const texts: string[] = [];
  for (const file of FILES) {
    const response = await fetch(`${baseUrl}/${file}`, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${file} download failed: HTTP ${response.status}`);
    texts.push(await response.text());
  }
  const [catalog, index] = texts.map((text) => JSON.parse(text) as Versioned);
  if (catalog?.version !== 1 || index?.version !== 1 || !Array.isArray(catalog.skills) || !Array.isArray(index.skills)) {
    throw new Error('download is not a v1 catalog');
  }
  mkdirSync(stateDir(), { recursive: true });
  FILES.forEach((file, i) => writeAtomic(join(stateDir(), file), texts[i] ?? ''));
  // Measurements and field ratings are optional: a missing file is not a failed update.
  for (const file of ['measured.json', 'field.json']) {
    const response = await fetch(`${baseUrl}/${file}`, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (!response?.ok) continue;
    const text = await response.text();
    if (text.trim().startsWith('{')) writeAtomic(join(stateDir(), file), text);
  }
  return catalog as Catalog;
}

export function findSkill(catalog: Catalog, idOrName: string) {
  return catalog.skills.find((skill) => skill.id === idOrName) ?? catalog.skills.find((skill) => skill.name === idOrName);
}

/** Field ratings by skill id from the last update: display only, never ranking. */
export function loadField(): Record<string, { helped: number; 'no-difference': number; hurt: number }> {
  try {
    return (JSON.parse(readFileSync(join(stateDir(), 'field.json'), 'utf8')) as { skills?: Record<string, { helped: number; 'no-difference': number; hurt: number }> }).skills ?? {};
  } catch {
    return {};
  }
}
