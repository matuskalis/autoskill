import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadCatalog, loadIndex, loadMeasured, type MeasuredDelta } from './catalog.ts';
import { MIN_FIRED_RATE, runHook } from './hook.ts';
import { listInstalled, readMarker } from './install.ts';
import { BUNDLED_CATALOG_DIR, claudeDir, MARKER, skillsDir, stateDir } from './paths.ts';

export type Status = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

const MIN_NODE = [22, 18] as const;
const STALE_CATALOG_DAYS = 3;
const SLOW_HOOK_SECONDS = 0.3;
const LATENCY_PROMPT = 'set up a postgres database migration and write integration tests for the api endpoints';
const DAY_MS = 86_400_000;

export function checkNode(version = process.versions.node): CheckResult {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  const supported = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
  return supported
    ? { name: 'node', status: 'ok', detail: `v${version}` }
    : { name: 'node', status: 'fail', detail: `v${version}, needs ${MIN_NODE.join('.')}+ to run TypeScript directly`, fix: 'install Node 22.18 or newer' };
}

export function checkCatalog(now = Date.now()): CheckResult[] {
  const catalog = loadCatalog();
  const index = loadIndex();
  const ageDays = Math.floor((now - Date.parse(catalog.generatedAt)) / DAY_MS);
  const results: CheckResult[] = [];
  if (!catalog.skills.length || !index.skills.length) {
    results.push({ name: 'catalog', status: 'fail', detail: `catalog ${catalog.skills.length} skills, index ${index.skills.length}`, fix: 'run `autoskill update`' });
  } else {
    const stale = ageDays > STALE_CATALOG_DAYS;
    results.push({
      name: 'catalog',
      status: stale ? 'warn' : 'ok',
      detail: `${catalog.skills.length} skills, generated ${catalog.generatedAt.slice(0, 10)} (${ageDays} days old)`,
      fix: stale ? 'run `autoskill update`' : undefined,
    });
  }
  const indexAgeDays = Math.floor((now - Date.parse(index.generatedAt)) / DAY_MS);
  const indexDetail = `${index.skills.length} skills, generated ${index.generatedAt.slice(0, 10)} (${indexAgeDays} days old)`;
  const missingSha = index.skills.filter((skill) => !skill.sha).length;
  if (index.generatedAt !== catalog.generatedAt) {
    results.push({ name: 'index', status: 'warn', detail: `${indexDetail}, catalog is ${catalog.generatedAt.slice(0, 10)}`, fix: 'run `autoskill update` to fetch a matching pair' });
  } else if (missingSha) {
    results.push({ name: 'index', status: 'warn', detail: `${indexDetail}, ${missingSha} entries have no sha so measured results are ignored for them`, fix: 'the index was built before it carried sha; rebuild index.json from catalog.json (writeCatalog)' });
  } else {
    results.push({ name: 'index', status: 'ok', detail: `${indexDetail}, every entry has a sha` });
  }
  return results;
}

export interface MeasuredBreakdown {
  usable: number;
  ignored: Record<string, number>;
}

function ignoredReason(key: string, entry: Partial<MeasuredDelta> | null, catalogShas: ReadonlyMap<string, string | undefined>): string | null {
  // `#hard`, `#grounded` and `#workspace` results sit beside the text result; the hook reads only the plain id.
  if (key.includes('#')) return 'variant';
  if (typeof entry?.delta !== 'number' || typeof entry.sha !== 'string') return 'malformed';
  if (!catalogShas.has(key)) return 'not in catalog';
  if (!catalogShas.get(key)) return 'index entry has no sha';
  if (catalogShas.get(key) !== entry.sha) return 'stale sha';
  if (entry.partial) return 'partial';
  if (!((entry.firedRate ?? 0) >= MIN_FIRED_RATE)) return `fired < ${MIN_FIRED_RATE * 100}%`;
  if (entry.ceiling) return 'ceiling';
  return null;
}

/** Mirrors `usable` in src/hook.ts, and says why each entry it would drop is dropped. */
export function measuredBreakdown(entries: Readonly<Record<string, unknown>>, catalogShas: ReadonlyMap<string, string | undefined>): MeasuredBreakdown {
  const ignored: Record<string, number> = {};
  let usable = 0;
  for (const [key, entry] of Object.entries(entries)) {
    const reason = ignoredReason(key, entry as Partial<MeasuredDelta> | null, catalogShas);
    if (reason === null) usable++;
    else ignored[reason] = (ignored[reason] ?? 0) + 1;
  }
  return { usable, ignored };
}

/** Every entry the hook might read, newest per key, before any filtering. */
function rawMeasured(): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const path of [join(BUNDLED_CATALOG_DIR, 'measured.json'), join(stateDir(), 'measured.json')]) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const [key, entry] of Object.entries(data)) {
      const at = (entry as Partial<MeasuredDelta> | null)?.measuredAt ?? '';
      const previous = (merged[key] as Partial<MeasuredDelta> | undefined)?.measuredAt ?? '';
      if (!(key in merged) || at > previous) merged[key] = entry;
    }
  }
  return merged;
}

function measuredFix(ignored: Record<string, number>): string {
  const [top] = Object.entries(ignored).sort((a, b) => b[1] - a[1]);
  if (top?.[0] === 'index entry has no sha') return 'rebuild index.json so its entries carry sha';
  if (top?.[0] === 'stale sha') return 'the measurements predate the current catalog commits; re-run `autoskill eval` on them';
  return 'run `autoskill update`';
}

export function checkMeasured(): CheckResult {
  // The hook's merge skips partial entries, so an older finished run can outrank a newer partial one.
  const entries = { ...rawMeasured(), ...loadMeasured() };
  const total = Object.keys(entries).length;
  if (!total) return { name: 'measured', status: 'warn', detail: 'no measured.json entries; suggestions rank on text match alone', fix: 'run `autoskill update`' };
  const shas = new Map(loadIndex().skills.map((skill) => [skill.id, skill.sha]));
  const { usable, ignored } = measuredBreakdown(entries, shas);
  const why = Object.entries(ignored)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} ${reason}`)
    .join(', ');
  return {
    name: 'measured',
    status: usable ? 'ok' : 'warn',
    detail: `${usable} of ${total} usable by the hook${why ? `; ignored: ${why}` : ''}`,
    fix: usable ? undefined : measuredFix(ignored),
  };
}

export function checkInstalled(): CheckResult[] {
  const root = skillsDir();
  const unreadable = existsSync(root)
    ? readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, MARKER)) && !readMarker(join(root, entry.name)))
    : [];
  const installed = listInstalled();
  if (!installed.length && !unreadable.length) return [{ name: 'installed', status: 'ok', detail: 'no autoskill skills installed' }];
  const shas = new Map(loadCatalog().skills.map((skill) => [skill.id, skill.sha]));
  const results: CheckResult[] = unreadable.map((entry) => ({
    name: `installed ${entry.name}`,
    status: 'fail' as const,
    detail: `${MARKER} is unreadable, so autoskill will not update or remove it`,
    fix: `inspect ${join(root, entry.name)} and delete it by hand if unwanted`,
  }));
  for (const { name, dir, marker } of installed) {
    const label = `installed ${name}`;
    if (!existsSync(join(dir, 'SKILL.md'))) {
      results.push({ name: label, status: 'fail', detail: 'marker present, SKILL.md missing', fix: `autoskill uninstall ${name} && autoskill add ${marker.id}` });
    } else if (!shas.has(marker.id)) {
      results.push({ name: label, status: 'warn', detail: `${marker.id} is no longer in the catalog`, fix: `keep it, or autoskill uninstall ${name}` });
    } else if (shas.get(marker.id) !== marker.sha) {
      results.push({ name: label, status: 'warn', detail: `stale: installed @${marker.sha.slice(0, 7)}, catalog @${shas.get(marker.id)?.slice(0, 7)}`, fix: `autoskill install ${marker.id}` });
    } else {
      results.push({ name: label, status: 'ok', detail: `@${marker.sha.slice(0, 7)} matches the catalog, SKILL.md present` });
    }
  }
  return results;
}

/** The command prefix a `Bash(...)` rule allows, or null for a rule about another tool. */
function bashPrefix(rule: string): string | null {
  const match = /^Bash\((.*)\)$/.exec(rule.trim());
  if (!match) return null;
  return (match[1] ?? '').replace(/(:\*| \*|\*)$/, '').trim();
}

/** `add` never installs review-tier; any rule that also allows `install` skips the human yes. */
export function checkAllowRules(settings: unknown): CheckResult {
  const allow = (settings as { permissions?: { allow?: unknown } } | null)?.permissions?.allow;
  const rules = Array.isArray(allow) ? allow.filter((rule): rule is string => typeof rule === 'string') : [];
  const prefixes = rules.map((rule) => [rule, bashPrefix(rule)] as const);
  const bypass = prefixes.filter(([, prefix]) => prefix === 'autoskill' || prefix === 'autoskill install');
  if (bypass.length) {
    return {
      name: 'permissions',
      status: 'fail',
      detail: `${bypass.map(([rule]) => rule).join(', ')} lets Claude install review-tier skills without asking you`,
      fix: 'replace it with Bash(autoskill add:*) in settings.json permissions.allow',
    };
  }
  if (prefixes.some(([, prefix]) => prefix === 'autoskill add')) return { name: 'permissions', status: 'ok', detail: 'Bash(autoskill add:*) is allowed' };
  return { name: 'permissions', status: 'warn', detail: 'no Bash(autoskill add:*) allow rule; Claude asks before every safe-tier install', fix: 'add "Bash(autoskill add:*)" to permissions.allow in settings.json' };
}

export function checkSettings(): CheckResult {
  const path = join(claudeDir(), 'settings.json');
  if (!existsSync(path)) return checkAllowRules(null);
  try {
    return checkAllowRules(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return { name: 'permissions', status: 'fail', detail: `${path} is not valid JSON`, fix: 'fix the JSON syntax' };
  }
}

export function checkHookLatency(): CheckResult {
  if (process.env.AUTOSKILL_DISABLE) return { name: 'hook latency', status: 'warn', detail: 'AUTOSKILL_DISABLE is set, the hook does nothing', fix: 'unset AUTOSKILL_DISABLE' };
  const start = performance.now();
  runHook({ prompt: LATENCY_PROMPT });
  const seconds = (performance.now() - start) / 1000;
  const detail = `${seconds.toFixed(3)} s on a fixed prompt`;
  return seconds > SLOW_HOOK_SECONDS
    ? { name: 'hook latency', status: 'warn', detail: `${detail}, over ${SLOW_HOOK_SECONDS} s`, fix: 'fewer plugin or skill folders to scan, or a faster disk' }
    : { name: 'hook latency', status: 'ok', detail };
}

export function runChecks(): CheckResult[] {
  return [checkNode(), ...checkCatalog(), checkMeasured(), ...checkInstalled(), checkSettings(), checkHookLatency()];
}

export function formatResult({ status, name, detail, fix }: CheckResult): string {
  return `${status.padEnd(4)}  ${name}: ${detail}${fix ? `; fix: ${fix}` : ''}`;
}
