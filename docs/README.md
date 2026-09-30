# Documentation

Start with the [README](../README.md). This folder holds the reference and the evidence behind it.

## Reference

- [commands.md](commands.md): every command, what autoskill reads and writes, when it uses the network, environment variables.
- [safety-tiers.md](safety-tiers.md): how a skill is classified, what puts it in review, red flags, what the human yes is.
- [catalog.md](catalog.md): how the catalog is crawled and published, what is dropped, the quality score.
- [advise-and-ratings.md](advise-and-ratings.md): `autoskill advise`, and the opt-in skill ratings.
- [measured-uplift.md](measured-uplift.md): how `autoskill eval` measures a skill and the first round of results.

## Evidence

- [audit-2026-09.md](audit-2026-09.md): what 22,746 public skills can do, and what a hand review of the red flags found (29 Sep 2026).
- [leaderboard.md](leaderboard.md): 32 popular skills measured on Opus 5.5, with 95% intervals.
- [eval-reliability.md](eval-reliability.md): how noisy those measurements are: judge agreement, run-to-run variance, sample sizes.
- [research-skill-uplift.md](research-skill-uplift.md): what the published benchmarks say about when skills help a model.
- [research-competitors.md](research-competitors.md): other skill registries, recommenders and routers.
- [demo/](demo/): the README capture and the hook note, written by `scripts/demo.ts`.

## Session logs

[SESSION-2026-09-29.md](SESSION-2026-09-29.md) and [SESSION-PLAN.md](SESSION-PLAN.md) are dated working notes from a two-hour session on 29 Sep 2026 and are not maintained. Two of the items listed as not done there have been done since: the crawl now runs daily in GitHub Actions, and the work is pushed.
