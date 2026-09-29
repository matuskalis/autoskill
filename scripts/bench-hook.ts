/**
 * Replays synthetic prompts through the hook's `pick` and scores what it suggests.
 *   node scripts/bench-hook.ts          default gates, per-kind breakdown, worst misses
 *   node scripts/bench-hook.ts --grid   one row per MIN_SCORE x MIN_NAME_COVERAGE combination
 * Reads the bundled catalog/index.json (not the downloaded copy) and excludes nothing, so runs are reproducible.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SearchIndex } from '../src/catalog.ts';
import { DEFAULT_GATES, type Gates, pick } from '../src/hook.ts';
import { BUNDLED_CATALOG_DIR, PACKAGE_ROOT } from '../src/paths.ts';
import { Index } from '../src/search.ts';
import { installName } from '../src/text.ts';

interface BenchCase {
  prompt: string;
  expect: string[];
  kind?: string;
}

interface CaseResult {
  bench: BenchCase;
  suggested: string[];
}

interface Metrics {
  fireRate: number;
  silentFireRate: number;
  precision: number;
  recall: number;
  f1: number;
  fired: number;
}

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

function run(index: SearchIndex, cases: readonly BenchCase[], gates: Partial<Gates>): CaseResult[] {
  return cases.map((bench) => ({ bench, suggested: pick(index, bench.prompt, new Set(), gates).map((hit) => installName(hit.skill)) }));
}

const ratio = (part: number, whole: number) => (whole ? part / whole : 0);

function score(results: readonly CaseResult[]): Metrics {
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

const pct = (value: number) => `${(value * 100).toFixed(1)}%`.padStart(6);

function describeTopCandidate(search: Index, bench: BenchCase): string {
  const hits = search.search(bench.prompt, { limit: 10 });
  const top = hits[0];
  if (!top) return 'no ungated candidate';
  const expectedHit = hits.find((hit) => bench.expect.includes(installName(hit.skill)));
  const format = (hit: typeof top) =>
    `${installName(hit.skill)} score=${hit.score.toFixed(1)} matched=${hit.matched.length} nameCov=${hit.nameCoverage.toFixed(2)}`;
  return `top ungated: ${format(top)}${expectedHit && expectedHit !== top ? ` | best expected in top 10: ${format(expectedHit)}` : ''}`;
}

function printDefault(index: SearchIndex, cases: readonly BenchCase[]) {
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

const index = JSON.parse(readFileSync(join(BUNDLED_CATALOG_DIR, 'index.json'), 'utf8')) as SearchIndex;
const cases = loadCases(BENCH_FILE);
warnUnknownNames(index, cases);
if (process.argv.includes('--grid')) printGrid(index, cases);
else printDefault(index, cases);
