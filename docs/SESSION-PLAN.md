# Session plan, 29 Sep 2026 (two hours, Opus 5.5)

Goal: turn the static quality score into measured evidence, and prove the hook picks the right skill.
Nothing is pushed to GitHub in this session; the user paused publishing.

## Tracks

| track | who | output | files |
|---|---|---|---|
| A. Hook benchmark | implementer subagent, worktree | labelled prompt set (synthetic, no real transcripts) + `scripts/bench-hook.ts` printing precision, recall and fire rate per threshold | `test/data/hook-bench.jsonl`, `scripts/bench-hook.ts` |
| B. Red team the classifier | general-purpose subagent, worktree | adversarial prose-only skills that `classify` labels safe but that make Claude run code or widen permissions, as failing tests | `test/redteam.test.ts` |
| C. Measured uplift | main session | `autoskill eval <id>`: generate cases, run with and without the skill through `claude plugin eval` (or `claude -p` if that does not fit), grade blind, store results in `catalog/measured.json` | `src/eval.ts`, `src/cli.ts` |
| D. Fold results back | main session | thresholds from A, classifier fixes from B, measured scores in search ranking and README | `src/hook.ts`, `src/safety.ts`, `src/search.ts`, `README.md` |

## Order

1. Orientation: `claude plugin eval` format (10 min).
2. A and B start in parallel in worktrees; C in main (40 min).
3. Run C on 6 to 10 safe skills with 3 tasks each; merge A and B (40 min).
4. D, then reviewer pass, verify, commit (20 min).

## Stop conditions

- Evals capped at 10 skills x 3 tasks x 2 arms this session.
- A threshold change ships only if precision on the bench does not drop.
- A classifier change ships only with a test for the case it fixes and no new false positive in the existing safe tests.
- No change to `~/.claude` settings or CLAUDE.md; plugin updates only through `claude plugin update`.
