# Commands

```
autoskill search <words> [--limit N]  rank catalog skills for a task (local, no network)
autoskill info <id|name>          everything the catalog knows about one skill
autoskill add <id>                install a safe-tier skill pinned to a commit
autoskill install <id> [--yes]    same; --yes for a review-tier skill after you agreed
autoskill uninstall <name>        remove a skill autoskill installed
autoskill list                    installed skills and how often you used them
autoskill advise [--json]         suggestions for your setup, from your own files
autoskill stats [--days N]        use counts for every skill, from your local transcripts
autoskill prune [--days N] [--apply]
                                  remove installed skills unused for N days (default 30);
                                  a dry run until --apply
autoskill eval <id...>            measure a skill: generated tasks with and without it, judged per check
                                  [--runs 2] [--max-cost 15] [--hard | --grounded | --workspace]
autoskill telemetry [on|off]      share anonymous skill ratings; off unless you turn it on in a terminal
autoskill update                  download the latest catalog
autoskill doctor                  check node, catalog, measurements, installed skills, permissions and hook speed
autoskill crawl [--repos a/b,c/d] rebuild the catalog from GitHub
autoskill field                   field ratings from the central server, for the crawl
autoskill hook                    the UserPromptSubmit hook: reads JSON on stdin, prints a note or nothing
```

`add` refuses a review-tier skill whatever the flags. `install --yes` is the only way in, and Claude Code's permission prompt for that command is the human yes. `autoskill doctor` fails if a permission rule would let `install` through without asking.

`crawl`, `field` and `eval` are for maintainers. `eval` runs `claude plugin eval` and spends real plan usage: about $5 to $12 of API-equivalent per skill at 3 tasks x 2 runs with an Opus judge, with a default ceiling of $15. Tests never run it.

## What it reads and writes

| where | what |
|---|---|
| `~/.claude/skills/<name>/` | installed skills, each with a `.autoskill.json` marker (id, repo, directory, commit, tier, quality, time). autoskill only ever changes folders that carry this marker. |
| `~/.autoskill/` | the downloaded catalog and index, `measured.json`, `field.json`, the advice and tip state, which skills were suggested in which session, the telemetry choice and the rating queue. |
| `~/.claude/projects/**/*.jsonl` | read only, on your machine: usage counts for `list`, `stats`, `prune` and `advise`, and the check that a skill was really loaded before a rating is sent. |
| `~/.claude/settings.json` | read only, by `doctor`, to check permission rules. |

`CLAUDE_CONFIG_DIR` moves the paths under `~/.claude`, `AUTOSKILL_HOME` moves `~/.autoskill`. Point both at a temporary directory and nothing on your real setup is touched; that is how the README capture and the tests run.

## Network

| command | request |
|---|---|
| `add`, `install` | the skill's files at the pinned commit from `api.github.com` (contents API), falling back to `raw.githubusercontent.com`. A token from `GITHUB_TOKEN`, `GH_TOKEN` or `gh auth token` raises the rate limit; none is needed. |
| `update` (on demand) and the background job (at most once a day) | `catalog.json`, `index.json`, `measured.json` and `field.json` from the `catalog` branch on `raw.githubusercontent.com`. |
| the background job, only with `telemetry on` | one POST of verified ratings. |
| `crawl` | the GitHub API and one tarball per repository. |

`search`, `info`, `list`, `stats`, `advise`, `prune`, `uninstall`, `doctor` and the hook itself make no request. The hook's only network effect is starting the background job.

## Environment

| variable | effect |
|---|---|
| `CLAUDE_CONFIG_DIR` | where Claude Code's config lives; default `~/.claude` |
| `AUTOSKILL_HOME` | where autoskill keeps its own state; default `~/.autoskill` |
| `AUTOSKILL_DISABLE` | set: the hook, the rating capture and the startup tip do nothing (autoskill's own headless eval runs set it) |
| `AUTOSKILL_ADVICE=off` | hides the once-a-day startup tip |
| `AUTOSKILL_FEEDBACK_URL` | the ratings endpoint, for a self-hosted server (`server/`) |
| `GITHUB_TOKEN`, `GH_TOKEN` | used for GitHub requests when set |

Usage is read from Claude Code's transcripts, on your machine only. A skill counts as used when Claude calls it, you type its `/command`, or Claude reads its SKILL.md.
