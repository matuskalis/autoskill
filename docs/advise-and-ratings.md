# Workflow advice and skill ratings

## Workflow advice

`autoskill advise` reads your own Claude Code files and suggests changes to how you work. It only reads: nothing in `~/.claude` is changed unless you ask Claude to apply a fix. Each check fires only on something measured in your files, and each piece of advice comes from Anthropic's documentation or a published measurement:

| check | fires when | suggests |
|---|---|---|
| max effort | 20% or more of your turns in the last 14 days (and at least 50) ran at `max` | a lower default per model, `max` only where it measurably helps |
| long CLAUDE.md | a CLAUDE.md you work with is over 200 lines | trim to lines that prevent mistakes; move procedures to skills |
| idle skills | a skill in `~/.claude/skills` was not used or edited for 60 days | remove it: every skill's description costs context in each session |

The daily background job recomputes the advice alongside the catalog refresh. At session startup the plugin shows at most one new tip a day, read from that precomputed file, so startup stays at about 0.1 s. Tips are fixed templates with counts and paths, never text from your transcripts. `AUTOSKILL_ADVICE=off` turns them off.

## Skill ratings from the field

When Claude finishes a task in which it loaded a skill autoskill installed, it ends the reply with one line, for example `autoskill: pdf helped (saved-time)`: the skill, a verdict (`helped`, `no-difference`, `hurt`) and a reason code (`followed-steps`, `saved-time`, `irrelevant`, `outdated-or-wrong`, `conflicted`, `too-long`). A Stop hook queues that line on your machine. Nothing leaves it unless you run `autoskill telemetry on`; the first interactive session after install asks once, and no answer means off.

With sharing on, the daily background job checks each rating against the session transcript (the skill must really have been loaded), keeps one per session and skill, and sends the skill id, commit, verdict and reason code with a random install id. No prompt, no code, no free text, no identity. The server stores a salted hash of your IP only for rate limits. Its code is in `server/`.

Every day the crawl publishes distinct-install counts per skill to `field.json`, and `autoskill info` shows them. Ratings are display only: they never change a skill's tier or its ranking, so nobody can vote a skill into your prompts. Headless `claude -p` runs never get the rating line.
