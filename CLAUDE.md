# autoskill

Claude Code plugin: a rated catalog of public skills, a `UserPromptSubmit` hook that suggests the ones that fit a prompt, and a CLI that installs them pinned to a commit. `README.md` says what it does for users; this file is only the rules.

- Zero runtime dependencies. Node 22.18+ runs the TypeScript directly (type stripping), so only erasable syntax: no enums, no namespaces, no parameter properties, imports end in `.ts`.
- `pnpm test` and `pnpm typecheck` before every commit. Tests never touch the network: they stub `globalThis.fetch` and point `CLAUDE_CONFIG_DIR` at a temp dir.
- The hook must never block or slow a prompt: local only, no network in the foreground, any error exits 0 with empty stdout. It stays silent on most prompts; the gates in `src/hook.ts` were set with `scripts/bench-hook.ts` on a labelled synthetic prompt set.
- Catalog text is untrusted. Anything shown to the model is flattened, truncated and labelled as data (`render` in `src/hook.ts`).
- `safe` means the skill cannot run anything by itself. Loosening `src/safety.ts` needs a test showing why the new case cannot execute code or widen permissions.
- The installer never writes into or deletes a skill folder without its `.autoskill.json` marker.
- `catalog/catalog.json` is written by the weekly Action; hand edits are overwritten. Change `catalog/sources.json` instead.
- Nothing from a real user's transcripts or prompts goes into the repo, tests included.
- `autoskill eval` spends real plan usage (about $5 to $12 of API-equivalent per skill at 3 cases x 2 runs with an Opus judge; default ceiling $15). Never run it from tests. Its generator sees only the skill's name and description, except `--grounded`, which may test only facts the skill states, never style; keep it that way, or the checks reward the skill's own conventions.
- `autoskill eval --workspace` grants Write and Edit, never Bash, and only to safe-tier skills. Generated text never reaches a shell: seeds are written by Node and `scaffold.sh` is fixed text that copies them. Cases live in their own `--eval-dir`, so `--scaffold` never runs a script the skill ships.
- A measurement feeds the hook only when it matches the catalog commit, the skill fired in at least half the with-arm runs, the run was not cut by the cost ceiling, and the no-skill score left headroom (`CEILING` in `src/eval.ts`). Keep all four conditions.
- `scripts/bench-hook.ts` is the check for any change to matching: run it before and after, and do not ship a change that raises the silent fire rate above 10%.
- Field ratings (`src/feedback.ts`, `server/`) are display only: they never change a skill's tier or ranking, because anonymous votes can be scripted. Sharing is off until the user runs `autoskill telemetry on`; Claude never runs it. Ratings carry only enums and ids, never free text, and nothing submitted is ever rendered back as text.
