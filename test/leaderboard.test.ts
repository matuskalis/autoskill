import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize } from '../scripts/leaderboard.ts';

const run = (score: number, loaded = true) => ({ score, graders: [{ withOnly: true, passed: loaded }] });
const kase = (withScores: number[], withoutScores: number[], loaded = true) => ({
  arms: { with: withScores.map((s) => run(s, loaded)), without: withoutScores.map((s) => ({ score: s })) },
});

test('pools cases across runs and calls a clear lift "helps"', () => {
  const a = { cases: [kase([0.9, 0.9], [0.5, 0.5]), kase([1, 0.8], [0.6, 0.4])] };
  const b = { cases: [kase([0.8, 0.9], [0.4, 0.5]), kase([0.95, 0.85], [0.5, 0.45])] };
  const row = summarize('acme/s:skills/x', [a, b]);
  assert.equal(row.cases, 4);
  assert.equal(row.verdict, 'helps');
  assert.ok(row.low > 0);
});

test('an interval spanning zero is "no clear effect", fewer than 3 cases "too few"', () => {
  const mixed = { cases: [kase([0.9, 0.9], [0.5, 0.5]), kase([0.4, 0.4], [0.8, 0.8]), kase([0.6, 0.6], [0.6, 0.6])] };
  assert.equal(summarize('x', [mixed]).verdict, 'no clear effect');
  assert.equal(summarize('x', [{ cases: [kase([1, 1], [0.5, 0.5]), kase([1, 1], [0.5, 0.5])] }]).verdict, 'too few cases');
});

test('a skill that loaded in under half its runs is "did not load" whatever its delta', () => {
  const row = summarize('x', [{ cases: [0, 1, 2, 3].map(() => kase([1, 1], [0.2, 0.2], false)) }]);
  assert.equal(row.verdict, 'did not load');
  assert.equal(row.fired, 0);
});
