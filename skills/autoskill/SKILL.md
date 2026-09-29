---
name: autoskill
description: Find, install and clean up Claude Code skills from the autoskill catalog of rated public skills. Use when the user asks for a skill for some task, types /autoskill, asks which skills they use, or when a task needs specialised know-how that no installed skill covers.
argument-hint: "[task to find a skill for]"
---

The `autoskill` command is on PATH while this plugin is enabled.

## Find and install

1. Run `autoskill search "<the task in a few English keywords>"`. The catalog is English, so translate the task first.
2. Pick the hit that fits the task best. Prefer a higher quality score and `safe` over `review` when two fit equally.
3. Install it.
   - `safe` (the skill only adds instructions): run `autoskill add <id>`.
   - `review` (scripts, extra permissions, code blocks or shell commands): `autoskill add` refuses it and lists why. Show the user those reasons and the source link, and ask. Run `autoskill install <id> --yes` only after they agree.
4. Read the SKILL.md path the command prints and follow it for the current task.

If nothing fits, say so; do not install a skill that only half fits.

## Keep the set clean

- `autoskill list`: skills autoskill installed, with how often each was used.
- `autoskill stats`: use counts for every skill, read from local transcripts.
- `autoskill prune`: dry run of what has gone unused for 30 days; `--apply` removes it. Only skills autoskill installed are ever removed.
- `autoskill update`: fetch the newest catalog now instead of waiting for the daily refresh.
