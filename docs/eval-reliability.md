# Eval reliability (29 Sep 2026)

Data: 31 raw `claude plugin eval` JSONs in `~/.autoskill/evals/`. That is 93 cases, 366 runs, 512 llm checks and 2016 judge verdicts. 30 skills ran 3 cases x 2 runs per arm. dotnet thread-abort ran 1 run per arm, so it is left out of the run-pair stats. There were no run errors, no null scores and no skipped paid graders. Deltas were recomputed with the real `summarize` (via `node --experimental-strip-types`) and match. The script is in `/private/tmp/claude-501/eval-reliability/`.

## 1. Judge votes
2007 of 2016 verdicts (99.6%) were unanimous. 9 were 2-1 splits. The majority always equalled `passed`. The 3-vote panel adds almost nothing, and the judge is not where the noise comes from.

## 2. Run-to-run variance
- Two runs of the same arm disagree on 25/992 check verdicts (2.5%): 2.8% in the with arm, 2.2% without.
- That low rate is a ceiling artifact. 479/512 checks (93.6%) pass in every run of both arms, and 66/93 cases are perfect everywhere.
- On the checks that are neither always-pass nor never-pass, the two runs disagree in 25/48 arm pairs (52%). A check that is not pinned behaves like a coin flip.
- A split judge vote goes with a run disagreement 4/9 times, against 21/983 when both verdicts were unanimous. The variance is in the agent's output.
- Within-arm run SD: 0.047 over all case-arms, and 0.097 over case-arms with any run below 1.

## 3. Deltas
| | mean | SD | min | median | max | >0 / =0 / <0 |
|---|---|---|---|---|---|---|
| delta | 0.005 | 0.030 | -0.067 | 0 | 0.111 | 7 / 20 / 4 |
| focusedDelta | 0.043 | 0.309 | -0.5 | 0 | 1.0 | 6 / 21 / 4 |

76 of the 93 per-case deltas are exactly 0. 28/31 skills trip `CEILING = 0.9`, and the mean without-arm score is 0.961.

The SD of per-skill deltas (0.030) is about what noise alone predicts (SE 0.027 to 0.030). At plus or minus 1.96 SE, about 1.5 of 31 skills should look significant by chance. Two do: supabase-postgres at +0.111 and internal-comms at -0.067.

focusedDelta is fragile:
- 13 skills have zero discriminating checks, so their 0 comes from the formula, not from evidence.
- With 2 runs, one check flipping once moves focusedDelta by 0.5. That flip is the whole value for 7 skills.

## 4. Sample size
Method: two-sided alpha 0.05 and 80% power, so z = 2.80. The variance is Var(delta) = (sC^2 + 2 sW^2 / r) / n, for n cases and r runs per arm. sW^2 = mean((a - b)^2) / 2 over within-arm run pairs. sC^2 is the case-delta variance left after the noise part is removed (sC = 0.023). The normal approximation is rough here, because the data is mostly zeros.

| scenario | delta 0.05 | delta 0.10 |
|---|---|---|
| at ceiling (sW 0.047), fixed cases | 14 runs per arm | 4 |
| at ceiling, cases sampled, 2 runs | 9 cases | 3 |
| with headroom (sW 0.097), fixed cases | 60 runs per arm | 15 |
| with headroom, cases sampled, 2 runs | 32 cases | 8 |

The current 3 x 2 design detects about 0.085 at best, and only at ceiling, where no such delta can exist. The largest possible delta is 1 - withoutScore. For the 20/31 skills with a baseline of 0.95 or more, that is 0.05 or less, so a delta of 0.10 cannot be detected at any n. The fix is harder cases, not more runs.

## 5. Suspicious
- **Never pass.** 8 checks fail in every run of both arms: internal-comms 2/check-1, mcp-builder 2/check-2, react-native 2/check-5, systematic-debugging 3/check-3 and check-5, database-migration 3/check-6, stripe 2/check-4 and 3/check-2. These are probably wrong or unreachable expected answers. They drag scores down without discriminating.
- **Fired vs score.** The skill fired in 111/183 with runs (61%). Mean score was 0.965 when it fired and 0.966 when it did not. The correlation between fired rate and case delta is r = -0.06.
- **Skill never fired.** 6 skills fired 0% of the time, so their with arm is a second without arm. Two of them still show deltas, senior-prompt-engineer at +0.033 and database-migration at +0.028. That is the noise floor seen directly.
- **Outliers.**
  - Of supabase-postgres's +0.111, two thirds comes from cases where the skill never fired. Only case 3 (fired both runs, +0.167) looks real.
  - internal-comms case 2 is consistently 0.6 vs 0.8, which is a plausible real negative.
- **Identical transcripts.** Judged texts never match across two runs, and never across arms once all graders' evidence is compared. The `tracePath` files are gone, so full transcripts could not be checked.
