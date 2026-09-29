import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileBytes } from './github.ts';
import { claudeDir, MARKER, skillsDir } from './paths.ts';
import { classify, isTextFile, redFlags } from './safety.ts';
import { installName, oneLine } from './text.ts';
import type { CatalogSkill, Risk } from './types.ts';

const MAX_FILES = 60;
const MAX_BYTES = 3_000_000;

export interface Marker {
  id: string;
  repo: string;
  dir: string;
  sha: string;
  risk: Risk;
  quality: number;
  installedAt: string;
}

export interface Installed {
  name: string;
  skillMd: string;
  risk: Risk;
  reasons: string[];
  status: 'installed' | 'updated' | 'already-installed';
}

export class ReviewRequired extends Error {
  readonly reasons: string[];
  constructor(id: string, reasons: string[]) {
    const flat = reasons.map((reason) => oneLine(reason, 200));
    super(`${id} needs a human yes before install: ${flat.join('; ')}`);
    this.reasons = flat;
  }
}

export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(path)) return false;
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

export function readMarker(dir: string): Marker | null {
  try {
    return JSON.parse(readFileSync(join(dir, MARKER), 'utf8')) as Marker;
  } catch {
    return null;
  }
}

export function listInstalled(): { name: string; dir: string; marker: Marker }[] {
  const root = skillsDir();
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const dir = join(root, entry.name);
    const marker = readMarker(dir);
    return marker ? [{ name: entry.name, dir, marker }] : [];
  });
}

/** ~/.claude is often a git repo; third-party skills should not land in it. */
function setGitIgnored(name: string, ignored: boolean) {
  if (!existsSync(join(claudeDir(), '.git'))) return;
  const file = join(skillsDir(), '.gitignore');
  const line = `/${name}/`;
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
  const has = lines.includes(line);
  if (ignored && !has) writeFileSync(file, [...lines, line].join('\n') + '\n');
  if (!ignored && has) writeFileSync(file, lines.filter((l) => l !== line).join('\n') + '\n');
}

/** `root` installs somewhere other than ~/.claude/skills, for evals; it skips the gitignore bookkeeping. */
export async function install(skill: CatalogSkill, options: { yes?: boolean; root?: string } = {}): Promise<Installed> {
  const root = options.root ?? skillsDir();
  const name = installName(skill);
  const dest = join(root, name);
  const existing = existsSync(dest) ? readMarker(dest) : null;
  if (existsSync(dest) && !existing) throw new Error(`${dest} exists and was not installed by autoskill; not touching it`);
  if (existing && existing.id !== skill.id) throw new Error(`${name} is already installed from ${existing.id}`);
  if (existing?.sha === skill.sha) {
    return { name, skillMd: join(dest, 'SKILL.md'), risk: existing.risk, reasons: [], status: 'already-installed' };
  }

  if (!/^[\w.-]+\/[\w.-]+$/.test(skill.repo) || !/^[0-9a-f]{40}$/.test(skill.sha)) throw new Error(`${skill.id}: malformed repo or commit in the catalog`);
  if (skill.dir && !isSafeRelativePath(skill.dir)) throw new Error(`${skill.id}: unsafe skill directory`);
  if (skill.files.length > MAX_FILES) throw new Error(`${skill.id} has ${skill.files.length} files, limit ${MAX_FILES}`);
  if (skill.files.reduce((sum, file) => sum + file.size, 0) > MAX_BYTES) throw new Error(`${skill.id} is over ${MAX_BYTES} bytes`);
  const bad = skill.files.find((file) => !isSafeRelativePath(file.path));
  if (bad) throw new Error(`${skill.id} has an unsafe path: ${JSON.stringify(bad.path)}`);
  if (!skill.files.some((file) => file.path === 'SKILL.md')) throw new Error(`${skill.id} has no SKILL.md`);
  // macOS and Windows fold case (and more): two paths that fold together would overwrite each other on disk.
  const folded = skill.files.map((file) => file.path.normalize('NFKC').toLowerCase());
  if (new Set(folded).size !== folded.length) throw new Error(`${skill.id} has paths that collide on a case-insensitive disk`);

  const contents = new Map<string, Uint8Array>();
  for (const file of skill.files) {
    contents.set(file.path, await fileBytes(skill.repo, skill.sha, skill.dir ? `${skill.dir}/${file.path}` : file.path));
  }
  const total = [...contents.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  if (total > MAX_BYTES) throw new Error(`${skill.id} downloaded ${total} bytes, limit ${MAX_BYTES}`);

  const skillMd = contents.get('SKILL.md') ?? new Uint8Array();
  const hash = createHash('sha256').update(skillMd).digest('hex');
  if (hash !== skill.hash) throw new Error(`${skill.id}: SKILL.md does not match the catalog hash`);

  // Classify what was actually downloaded, not what the catalog claims.
  const decoder = new TextDecoder();
  const texts: Record<string, string> = {};
  for (const [path, bytes] of contents) if (path !== 'SKILL.md' && isTextFile(path)) texts[path] = decoder.decode(bytes);
  const classification = classify(decoder.decode(skillMd), skill.files, texts);
  const everything = Object.fromEntries([...contents].map(([path, bytes]) => [path, decoder.decode(bytes)]));
  const flags = redFlags(everything);
  const risk = flags.length ? 'review' : classification.risk;
  const reasons = [...classification.reasons, ...new Set(flags.map((flag) => `red flag: ${flag.rule} (${flag.path}:${flag.line})`))];
  if (risk === 'review' && !options.yes) throw new ReviewRequired(skill.id, reasons);

  mkdirSync(root, { recursive: true });
  const staging = join(root, `.autoskill-staging-${randomUUID()}`);
  try {
    for (const [path, bytes] of contents) {
      const target = join(staging, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: 'wx' });
    }
    // What is on disk is what Claude will read; check it, not the bytes in memory.
    if (createHash('sha256').update(readFileSync(join(staging, 'SKILL.md'))).digest('hex') !== skill.hash) {
      throw new Error(`${skill.id}: SKILL.md on disk does not match the catalog hash`);
    }
    const marker: Marker = { id: skill.id, repo: skill.repo, dir: skill.dir, sha: skill.sha, risk, quality: skill.quality, installedAt: new Date().toISOString() };
    writeFileSync(join(staging, MARKER), JSON.stringify(marker, null, 2) + '\n');
    if (existing) rmSync(dest, { recursive: true, force: true });
    renameSync(staging, dest);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  if (!options.root) setGitIgnored(name, true);
  return { name, skillMd: join(dest, 'SKILL.md'), risk, reasons, status: existing ? 'updated' : 'installed' };
}

export function uninstall(name: string): void {
  const dest = join(skillsDir(), name);
  if (!readMarker(dest)) throw new Error(`${name} was not installed by autoskill; not removing it`);
  rmSync(dest, { recursive: true, force: true });
  setGitIgnored(name, false);
}
