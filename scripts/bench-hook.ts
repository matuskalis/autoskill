/**
 * Replays synthetic prompts through the hook's `pick` and scores what it suggests.
 *   node scripts/bench-hook.ts          default gates, per-kind breakdown, worst misses
 *   node scripts/bench-hook.ts --grid   one row per MIN_SCORE x MIN_NAME_COVERAGE combination
 *   node scripts/bench-hook.ts --check [--min-f1 0.6]   also exits 1 when the silent fire rate is above 10% or F1 is below the floor
 * Reads the bundled catalog/index.json (not the downloaded copy) and excludes nothing, so runs are reproducible.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SearchIndex } from '../src/catalog.ts';
import { DEFAULT_GATES, type Gates, pick } from '../src/hook.ts';
import { BUNDLED_CATALOG_DIR, PACKAGE_ROOT } from '../src/paths.ts';
import { Index } from '../src/search.ts';
import { installName } from '../src/text.ts';

export interface BenchCase {
  prompt: string;
  expect: string[];
  kind?: string;
}

export interface CaseResult {
  bench: BenchCase;
  suggested: string[];
}

export interface Metrics {
  fireRate: number;
  silentFireRate: number;
  precision: number;
  recall: number;
  f1: number;
  fired: number;
}

export const MAX_SILENT_FIRE_RATE = 0.1;
export const DEFAULT_MIN_F1 = 0.6;
const GRID_MIN_SCORE = [6, 9, 12, 15];
const GRID_MIN_NAME_COVERAGE = [0.5, 0.66, 1];
const BENCH_FILE = join(PACKAGE_ROOT, 'test', 'data', 'hook-bench.jsonl');

function loadCases(path: string): BenchCase[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line, i) => {
      const bench = JSON.parse(line) as BenchCase;
      if (typeof bench.prompt !== 'string' || !Array.isArray(bench.expect)) throw new Error(`${path}:${i + 1}: needs prompt and expect`);
      return bench;
    });
}

export function run(index: SearchIndex, cases: readonly BenchCase[], gates: Partial<Gates>): CaseResult[] {
  return cases.map((bench) => ({ bench, suggested: pick(index, bench.prompt, new Set(), gates).map((hit) => installName(hit.skill)) }));
}

const ratio = (part: number, whole: number) => (whole ? part / whole : 0);

export function score(results: readonly CaseResult[]): Metrics {
  const fired = results.filter((result) => result.suggested.length);
  const topHits = fired.filter((result) => result.bench.expect.includes(result.suggested[0] ?? ''));
  const expected = results.filter((result) => result.bench.expect.length);
  const found = expected.filter((result) => result.suggested.some((name) => result.bench.expect.includes(name)));
  const silent = results.filter((result) => !result.bench.expect.length);
  const precision = ratio(topHits.length, fired.length);
  const recall = ratio(found.length, expected.length);
  return {
    fireRate: ratio(fired.length, results.length),
    silentFireRate: ratio(silent.filter((result) => result.suggested.length).length, silent.length),
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    fired: fired.length,
  };
}

/** Reasons the metrics fail the CI gate; empty when they pass. */
export function checkMetrics(metrics: Metrics, minF1 = DEFAULT_MIN_F1): string[] {
  const failures: string[] = [];
  if (metrics.silentFireRate > MAX_SILENT_FIRE_RATE)
    failures.push(`silent fire rate ${pct(metrics.silentFireRate).trim()} is above ${pct(MAX_SILENT_FIRE_RATE).trim()}`);
  if (metrics.f1 < minF1) failures.push(`F1 ${metrics.f1.toFixed(3)} is below the floor ${minF1}`);
  return failures;
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`.padStart(6);
}

function parseMinF1(argv: readonly string[]): number {
  const at = argv.indexOf('--min-f1');
  if (at === -1) return DEFAULT_MIN_F1;
  const value = Number(argv[at + 1]);
  if (argv[at + 1] === undefined || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('--min-f1 needs a number between 0 and 1');
  return value;
}

function describeTopCandidate(search: Index, bench: BenchCase): string {
  const hits = search.search(bench.prompt, { limit: 10 });
  const top = hits[0];
  if (!top) return 'no ungated candidate';
  const expectedHit = hits.find((hit) => bench.expect.includes(installName(hit.skill)));
  const format = (hit: typeof top) =>
    `${installName(hit.skill)} score=${hit.score.toFixed(1)} matched=${hit.matched.length} nameCov=${hit.nameCoverage.toFixed(2)}`;
  return `top ungated: ${format(top)}${expectedHit && expectedHit !== top ? ` | best expected in top 10: ${format(expectedHit)}` : ''}`;
}

function printDefault(index: SearchIndex, cases: readonly BenchCase[]): Metrics {
  const results = run(index, cases, {});
  const all = score(results);
  console.log(`gates: ${JSON.stringify(DEFAULT_GATES)}`);
  console.log(`prompts: ${results.length}, fired: ${all.fired}`);
  console.log(
    `fire rate ${pct(all.fireRate)}  silent fire rate ${pct(all.silentFireRate)}  precision ${pct(all.precision)}  recall ${pct(all.recall)}  F1 ${all.f1.toFixed(3)}`,
  );
  console.log('\nby kind:');
  for (const kind of [...new Set(cases.map((bench) => bench.kind ?? 'unlabelled'))]) {
    const subset = results.filter((result) => (result.bench.kind ?? 'unlabelled') === kind);
    const metrics = score(subset);
    console.log(
      `  ${kind.padEnd(12)} n=${String(subset.length).padStart(3)}  fire ${pct(metrics.fireRate)}  precision ${pct(metrics.precision)}  recall ${pct(metrics.recall)}`,
    );
  }

  const search = new Index(index.skills, index.postings);
  const falsePositives = results.filter((result) => !result.bench.expect.length && result.suggested.length);
  const wrongFires = results.filter(
    (result) => result.bench.expect.length && result.suggested.length && !result.suggested.some((name) => result.bench.expect.includes(name)),
  );
  const lowRanked = results.filter(
    (result) =>
      result.bench.expect.length &&
      !result.bench.expect.includes(result.suggested[0] ?? '') &&
      result.suggested.some((name) => result.bench.expect.includes(name)),
  );
  const silentMisses = results.filter((result) => result.bench.expect.length && !result.suggested.length);
  console.log(`\ntop-1 wrong, an expected skill ranked lower (${lowRanked.length}):`);
  for (const { bench, suggested } of lowRanked) console.log(`  [${bench.kind}] "${bench.prompt}" -> ${suggested.join(', ')}`);
  console.log(`\nfalse positives on silent prompts (${falsePositives.length}):`);
  for (const { bench, suggested } of falsePositives) console.log(`  "${bench.prompt}" -> ${suggested.join(', ')}`);
  console.log(`\nfired, but nothing expected (${wrongFires.length}):`);
  for (const { bench, suggested } of wrongFires) console.log(`  [${bench.kind}] "${bench.prompt}" -> ${suggested.join(', ')}`);
  console.log(`\nmissed, stayed silent (${silentMisses.length}):`);
  for (const { bench } of silentMisses) console.log(`  [${bench.kind}] "${bench.prompt}"\n      ${describeTopCandidate(search, bench)}`);
  return all;
}

function printGrid(index: SearchIndex, cases: readonly BenchCase[]) {
  console.log('minScore  minNameCov  fire    silentFire  precision  recall  F1');
  for (const minScore of GRID_MIN_SCORE) {
    for (const minNameCoverage of GRID_MIN_NAME_COVERAGE) {
      const metrics = score(run(index, cases, { minScore, minNameCoverage }));
      const isDefault = minScore === DEFAULT_GATES.minScore && minNameCoverage === DEFAULT_GATES.minNameCoverage;
      console.log(
        `${String(minScore).padStart(8)}  ${minNameCoverage.toFixed(2).padStart(10)}  ${pct(metrics.fireRate)}  ${pct(metrics.silentFireRate).padStart(10)}  ${pct(metrics.precision).padStart(9)}  ${pct(metrics.recall)}  ${metrics.f1.toFixed(3)}${isDefault ? '  <- default' : ''}`,
      );
    }
  }
}

function warnUnknownNames(index: SearchIndex, cases: readonly BenchCase[]) {
  const known = new Set(index.skills.map((skill) => installName(skill)));
  const unknown = [...new Set(cases.flatMap((bench) => bench.expect))].filter((name) => !known.has(name));
  if (unknown.length) console.log(`warning: expected names not in the catalog: ${unknown.join(', ')}\n`);
}

function main(argv: readonly string[]) {
  const minF1 = parseMinF1(argv);
  const index = JSON.parse(readFileSync(join(BUNDLED_CATALOG_DIR, 'index.json'), 'utf8')) as SearchIndex;
  const cases = loadCases(BENCH_FILE);
  warnUnknownNames(index, cases);
  if (argv.includes('--grid')) printGrid(index, cases);
  else {
    const metrics = printDefault(index, cases);
    if (!argv.includes('--check')) return;
    const failures = checkMetrics(metrics, minF1);
    if (!failures.length) {
      console.log(`\ncheck passed: silent fire rate <= ${pct(MAX_SILENT_FIRE_RATE).trim()}, F1 >= ${minF1}`);
      return;
    }
    for (const failure of failures) console.error(`\ncheck failed: ${failure}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
