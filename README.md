# autoskill

Claude Code gets better with the right skill, and there are tens of thousands of them on GitHub. Nobody installs the right one at the right moment. autoskill does it for you: on every prompt it looks through a rated catalog of public skills, and when one clearly fits the task, Claude installs it (pinned to a commit) and uses it straight away. Skills you stop using get pruned.

```
you:     fill in this PDF form and merge it with the cover letter
hook:    anthropics/skills:skills/pdf (pdf, review, quality 90/100): Extract text and tables from PDF files, fill forms, merge…
claude:  asks you first, since this one ships Python scripts; then autoskill install anthropics/skills:skills/pdf --yes
```

## Install

```
/plugin marketplace add matuskalis/autoskill
/plugin install autoskill@autoskill
```

Needs Node 22.18 or newer (TypeScript runs natively, no build step, no runtime dependencies). Optional: `gh` logged in, or `GITHUB_TOKEN`, for higher GitHub rate limits during installs.

The plugin adds a `UserPromptSubmit` hook, the `/autoskill` skill and the `autoskill` command. If you want Claude to install safe skills without a permission prompt, allow `add` in `~/.claude/settings.json`:

```json
{ "permissions": { "allow": ["Bash(autoskill add:*)"] } }
```

`add` only ever installs safe-tier skills. Never allow `autoskill install`: a review-tier skill goes through `install --yes`, and Claude Code's permission prompt for it is your yes.

## How it decides

1. **The hook runs locally on every prompt**, with no network access and no model call, in about 0.15 s. It scores the prompt against the catalog with BM25 over each skill's name and description, weighted by the skill's quality score. Most prompts produce nothing: replaying 120 real prompts, it spoke on 5% of them. On a labelled set of 156 synthetic prompts (`scripts/bench-hook.ts`) it fires on 8% of prompts that should stay silent, with 68% top-1 precision and 66% recall. It suggests at most three skills, only when at least two informative words match, most of the skill's own name is in the prompt, and the score clears a threshold. Copies of the same skill collapse into one, and the original wins over a fork. It never suggests a skill you already have, and never the same skill twice in one session.
2. **Claude makes the call.** It gets the candidates as context, marked as untrusted third-party text, and installs one only if it clearly fits and no installed skill covers the task: a safe one with `autoskill add`, a review one only after asking you.
3. **Install is pinned and checked.** Files come from the exact commit in the catalog. The SKILL.md hash must match, and the downloaded files are classified again before anything is written. A folder autoskill did not create is never touched. If `~/.claude` is a git repo, installed skills are added to `skills/.gitignore`.
4. **Claude reads the new SKILL.md and follows it** for the current task. Claude Code also picks up the new skill for the rest of the session.

## Safety tiers

| tier | means | install |
|---|---|---|
| `safe` | prose only: text files, descriptive frontmatter, no code blocks, no commands | `autoskill add`, automatic |
| `review` | ships code, sets `allowed-tools`, `hooks`, `shell`, `model` or any other behaviour key, uses YAML the checker cannot read, runs `` !`cmd` `` on load, contains a code block, or names shell and network commands | Claude asks you, then `autoskill install --yes` |

The check fails closed, so most skills land in `review`: about one skill in ten is `safe`. "Safe" means the skill cannot make Claude run anything by itself. It does not mean every instruction in it is good advice.

## The catalog

`catalog/catalog.json` is rebuilt every Monday by a GitHub Action (`.github/workflows/crawl.yml`), along with `catalog/index.json`, a slim prebuilt search index the hook loads. The crawl collects repos under the topics in `catalog/sources.json` plus a list of known repos, finds every `SKILL.md` in the git tree, reads the skill's text files from one tarball per repo, and drops:

- archived repos,
- skills with no description,
- repos untouched for two years with fewer than 50 stars,
- skills scoring under 25,
- byte-identical copies (the most-starred copy is kept).

A skill that disappears upstream disappears from the catalog on the next crawl. Your local copy refreshes itself in the background when it is older than a week, or right away with `autoskill update`.

### Quality score (0 to 100)

| signal | points |
|---|---|
| stars | up to 30, 7.5 per decade (10, 100, 1k, 10k) |
| last push | 20 within 90 days, 12 within a year, 5 within two |
| description | 15 for 40 to 1536 characters, +10 if it says when to use it |
| body | 10 for 300 characters to 60 kB |
| license | 5 |
| Anthropic's own repos | 10 |

It is a static score, computed without running the skill. The measured results below are the other half.

## Measured uplift

`autoskill eval <id>` checks whether a skill actually makes Claude better:

1. A model writes three realistic tasks from the skill's **name and description only**, never its body, each with three to six pass/fail checks an expert would apply. Checks written from the body would reward the skill's own conventions.
2. `claude plugin eval` runs every task twice with the skill loaded and twice without, on Opus 5.5, with read-only tools. `--workspace` seeds files and grants Write and Edit (never Bash) for safe-tier skills; `--hard` asks for tasks near the edge of the model's ability.
3. An Opus judge votes on each check. The result records both arms, the delta, the delta over only the checks that separated the arms, and how often the skill actually loaded.

The hook uses a measurement only when it is for the exact commit in the catalog, the skill loaded in at least half the runs, the run was not cut short by the cost ceiling, and the model scored under 0.9 without the skill. A skill measured as harmful (delta ≤ -0.05) is never suggested. Skills whose frontmatter pre-approves tools, registers hooks or runs shell on load are never evaluated, because loading them would act on the machine running the eval.

**First results (29 Sep 2026, 22 popular skills, Opus 5.5):** on almost every skill the model already scored 0.9 or more without it, so there was nothing left to gain. The largest raw gain was +0.11 (a Postgres skill that loaded in only a third of runs); several skills made answers slightly worse, the clearest being a Core Web Vitals skill at -0.11. This matches the literature collected in `docs/research-skill-uplift.md`: on frontier models most public skills add nothing on questions a model can answer from general knowledge, and the gains that remain come from specific procedures, checklists and tool workflows.

MEASURED_TABLE

## Commands

```
autoskill search <words>          rank catalog skills for a task
autoskill info <id|name>          everything the catalog knows about one skill
autoskill add <id>                install a safe-tier skill pinned to a commit
autoskill install <id> [--yes]    same; --yes for a review-tier skill after you agreed
autoskill uninstall <name>        remove a skill autoskill installed
autoskill list                    installed skills and how often you used them
autoskill stats [--days N]        use counts for every skill, from your local transcripts
autoskill prune [--days N] [--apply]
                                  remove installed skills unused for N days (default 30)
autoskill eval <id...>            measure a skill: generated tasks with and without it, judged per check
autoskill update                  download the latest catalog
autoskill crawl [--repos a/b,c/d] rebuild the catalog from GitHub
```

Usage is read from Claude Code's transcripts in `~/.claude/projects`, on your machine only. A skill counts as used when Claude calls it, you type its `/command`, or Claude reads its SKILL.md.

## Limits

- Matching is lexical. The catalog is in English, so a prompt in another language rarely triggers a suggestion. `/autoskill` translates the task before searching.
- The quality score rates popularity and upkeep, not whether a skill actually makes Claude better.
- A repo with a `SKILL.md` at its root and more than 60 files is skipped.

## Development

```
pnpm install
pnpm test
pnpm typecheck
node src/cli.ts crawl --repos anthropics/skills --out /tmp/catalog
```

MIT licensed.
