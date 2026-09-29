/**
 * Builds docs/leaderboard.md from headroom measurements.
 *
 *   node scripts/leaderboard.ts [--raw ~/.autoskill/evals] [--out docs/leaderboard.md]
 *
 * Pools every headroom run of a skill at the same commit, case by case: the
 * case delta is the mean with-skill score minus the mean no-skill score. The
 * interval is a 95% t-interval over cases. A skill that loaded in fewer than
 * half of its with-skill runs is reported as not loaded: its delta is noise.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface Run {
  score?: number;
  graders?: { withOnly?: boolean; passed?: boolean }[];
}
interface RawResult {
  cases: { arms: { with?: Run[]; without?: Run[] } }[];
}
interface Measured {
  id: string;
  sha: string;
  cases: number;
  withoutScore: number;
  headroom?: { candidates: number; kept: number; pilotScores: number[] };
}

export interface Row {
  id: string;
  cases: number;
  delta: number;
  low: number;
  high: number;
  fired: number;
  verdict: 'helps' | 'hurts' | 'no clear effect' | 'too few cases' | 'did not load';
}

const T95 = [0, 12.71, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086];
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const scores = (runs: Run[] | undefined) => (runs ?? []).flatMap((r) => (typeof r.score === 'number' ? [r.score] : []));

/** Per-case deltas and load rate for one skill, pooled across runs. */
export function summarize(id: string, results: readonly RawResult[]): Row {
  const deltas: number[] = [];
  let withRuns = 0;
  let loaded = 0;
  for (const result of results) {
    for (const item of result.cases) {
      const withScores = scores(item.arms.with);
      const withoutScores = scores(item.arms.without);
      if (!withScores.length || !withoutScores.length) continue;
      deltas.push(mean(withScores) - mean(withoutScores));
      for (const run of item.arms.with ?? []) {
        withRuns += 1;
        if (run.graders?.some((g) => g.withOnly && g.passed)) loaded += 1;
      }
    }
  }
  const n = deltas.length;
  const delta = mean(deltas);
  const sd = n > 1 ? Math.sqrt(deltas.reduce((sum, d) => sum + (d - delta) ** 2, 0) / (n - 1)) : 0;
  const half = n > 1 ? (T95[Math.min(n - 1, T95.length - 1)] ?? 1.96) * (sd / Math.sqrt(n)) : Infinity;
  const fired = withRuns ? loaded / withRuns : 0;
  const verdict: Row['verdict'] =
    fired < 0.5 ? 'did not load' : n < 3 ? 'too few cases' : delta - half > 0 ? 'helps' : delta + half < 0 ? 'hurts' : 'no clear effect';
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return { id, cases: n, delta: round(delta), low: round(delta - half), high: round(delta + half), fired: round(fired), verdict };
}

const sanitize = (id: string) => id.replace(/[^\w.-]+/g, '_');

function main(argv: readonly string[]) {
  const at = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const rawDir = at('--raw') ?? join(homedir(), '.autoskill', 'evals');
  const out = at('--out') ?? 'docs/leaderboard.md';
  const measured = Object.entries(JSON.parse(readFileSync('catalog/measured.json', 'utf8')) as Record<string, Measured>)
    .filter(([key]) => key.endsWith('#headroom'))
    .map(([, value]) => value);

  const byPrefix = new Map(measured.map((m) => [`${sanitize(m.id)}-${m.sha.slice(0, 7)}-headroom-`, m]));
  const pooled = new Map<string, RawResult[]>();
  for (const file of existsSync(rawDir) ? readdirSync(rawDir) : []) {
    const match = [...byPrefix.entries()].find(([prefix]) => file.startsWith(prefix));
    if (!match) continue;
    pooled.set(match[1].id, [...(pooled.get(match[1].id) ?? []), JSON.parse(readFileSync(join(rawDir, file), 'utf8')) as RawResult]);
  }

  const rows = [...pooled].map(([id, results]) => summarize(id, results));
  const order = ['helps', 'no clear effect', 'hurts', 'too few cases', 'did not load'];
  rows.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || b.delta - a.delta);
  const noHeadroom = measured.filter((m) => m.cases === 0 && !pooled.has(m.id));
  const shas = new Map(measured.map((m) => [m.id, m.sha]));
  const link = (id: string) => {
    const [repo, dir] = id.split(':');
    return `[${id}](https://github.com/${repo}/tree/${shas.get(id) ?? 'HEAD'}/${dir ?? ''})`;
  };
  const sign = (x: number) => (x > 0 ? `+${x.toFixed(2)}` : x.toFixed(2));

  const lines = [
    '# Do popular Claude Code skills help Opus 5.5?',
    '',
    `Measured ${new Date().toISOString().slice(0, 10)} with \`autoskill eval --headroom --grounded\`. ${rows.length + noHeadroom.length} skills.`,
    '',
    'For each skill, 8 hard tasks are generated from its description and the facts it states. Opus 5.5 answers them once with no skill loaded. Only the tasks it mostly fails (score 0.7 or less) are kept, and those are run again, twice with the skill and twice without, all graded by an Opus judge against the task\'s checks. The delta is the with-skill score minus the no-skill score, from 0 to 1, per task, averaged; the interval is a 95% t-interval over tasks. A skill Claude loaded in fewer than half of its runs is marked "did not load": its delta is noise (one such skill scored +0.08 without ever loading).',
    '',
    '| skill | verdict | delta | 95% interval | tasks | loaded |',
    '|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${link(r.id)} | ${r.verdict} | ${sign(r.delta)} | ${Number.isFinite(r.low) ? `${sign(r.low)} to ${sign(r.high)}` : 'n/a'} | ${r.cases} | ${Math.round(r.fired * 100)}% |`),
    '',
    `## No headroom (${noHeadroom.length})`,
    '',
    'Opus 5.5 already scored above 0.7 on at least 7 of the 8 hard tasks without the skill, so there was nothing for the skill to improve.',
    '',
    ...noHeadroom.map((m) => `- ${link(m.id)}: no-skill score ${m.withoutScore.toFixed(2)}`),
    '',
    '## Limits',
    '',
    '- Tasks are text answers judged by a model, not runs in a real repository. Skills whose value is a procedure with tools (running tests, driving a browser) are under-measured.',
    '- 2 to 8 tasks per skill: small samples, which is why every delta carries its interval. "No clear effect" means the interval spans zero, not that the skill does nothing.',
    '- The judge is Claude grading Claude.',
    '',
  ];
  writeFileSync(out, lines.join('\n'));
  console.log(`wrote ${out}: ${rows.length} measured, ${noHeadroom.length} without headroom`);
}

if (process.argv[1]?.endsWith('leaderboard.ts')) main(process.argv.slice(2));
