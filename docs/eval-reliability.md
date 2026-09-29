# Eval reliability (29 Sep 2026)

Data: 31 JSONs in `~/.autoskill/evals/` (93 cases, 366 runs, 512 llm checks, 2016 judge verdicts). Each skill ran 3 cases x 2 runs per arm; dotnet thread-abort ran 1 and is left out of the run-pair stats. No run errors, null scores or skipped graders. Deltas match the real `summarize`.

## 1. Judge votes
2007/2016 verdicts (99.6%) were unanimous and 9 were 2-1 splits. The 3-vote panel adds almost nothing.

## 2. Run-to-run variance
- Two runs of the same arm disagree on 25/992 check verdicts (2.5%).
- That rate is low because of the ceiling. 479/512 checks (93.6%) pass in every run of both arms, and 66/93 cases are perfect everywhere.
- On the checks that are not pinned, the two runs disagree in 25/48 arm pairs (52%), a coin flip.
- A split judge vote goes with a run disagreement 4/9 times, against 21/983 when both verdicts are unanimous. The noise comes from the agent, not the judge.
- Within-arm run SD is 0.047 overall and 0.097 on case-arms with any run below 1.

## 3. Deltas
| | mean | SD | min | median | max | >0 / =0 / <0 |
|---|---|---|---|---|---|---|
| delta | 0.005 | 0.030 | -0.067 | 0 | 0.111 | 7 / 20 / 4 |
| focusedDelta | 0.043 | 0.309 | -0.5 | 0 | 1.0 | 6 / 21 / 4 |

- 28/31 skills trip `CEILING = 0.9`, and the mean without-arm score is 0.961.
- The spread of skill deltas (SD 0.030) is what noise alone predicts (SE about 0.03). About 1.5 of 31 skills should fall outside ±0.059 by chance, and 2 do.
- 13 skills have no discriminating checks, so their focusedDelta of 0 comes from the formula. In 7 other skills the whole value comes from one check flipping once, which moves it by 0.25 to 0.5.

## 4. Sample size
Method: two-sided alpha 0.05 at 80% power, so z = 2.80. Var(delta) = (sC^2 + 2 sW^2 / r) / n, for n cases and r runs per arm. sW^2 = mean((a - b)^2) / 2 over within-arm run pairs. sC (0.023) is the case-delta spread left after removing noise. The normal approximation is rough, since 76/93 case deltas are exactly 0.

| scenario | delta 0.05 | delta 0.10 |
|---|---|---|
| ceiling (sW 0.047), fixed cases | 14 runs/arm | 4 |
| ceiling, sampled cases, 2 runs | 9 cases | 3 |
| headroom (sW 0.097), fixed cases | 60 runs/arm | 15 |
| headroom, sampled cases, 2 runs | 32 cases | 8 |

The 3 x 2 design can detect about 0.085, and only at ceiling, where a delta that large cannot occur. The largest possible delta is 1 - withoutScore. For the 20/31 skills with a baseline of 0.95 or more, 0.10 cannot be detected at any n. The fix is harder cases, not more runs.

## 5. Suspicious
- **Checks that never pass.** These 8 fail in every run of both arms:
  - internal-comms 2/check-1
  - mcp-builder 2/check-2
  - react-native 2/check-5
  - systematic-debugging 3/check-3 and 3/check-5
  - database-migration 3/check-6
  - stripe 2/check-4 and 3/check-2

  Their expected answers are probably wrong.
- **Firing does not track score.** The skill fired in 111/183 with runs. The mean score was 0.965 when it fired and 0.966 when it did not, and r(fired rate, case delta) = -0.06.
- **The noise floor, measured directly.** 6 skills never fired, so their with arm is really a second without arm. senior-prompt-engineer (+0.033) and database-migration (+0.028) are therefore pure noise.
- **Outliers.**
  - Two thirds of supabase-postgres's +0.111 comes from cases where the skill did not fire. Only case 3 (fired, +0.167) looks real.
  - internal-comms case 2 scores 0.6 vs 0.8 in both runs, which is plausibly a real negative.
- **Transcripts.** No identical judged text, within an arm or across arms. The `tracePath` files are gone, so full transcripts were not checked.
