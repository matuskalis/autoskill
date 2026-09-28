# autoskill

Claude Code plugin: a rated catalog of public skills, a `UserPromptSubmit` hook that suggests the ones that fit a prompt, and a CLI that installs them pinned to a commit. `README.md` says what it does for users; this file is only the rules.

- Zero runtime dependencies. Node 22.18+ runs the TypeScript directly (type stripping), so only erasable syntax: no enums, no namespaces, no parameter properties, imports end in `.ts`.
- `pnpm test` and `pnpm typecheck` before every commit. Tests never touch the network: they stub `globalThis.fetch` and point `CLAUDE_CONFIG_DIR` at a temp dir.
- The hook must never block or slow a prompt: local only, no network in the foreground, any error exits 0 with empty stdout. It stays silent on most prompts; `MIN_MATCHED_TERMS` and `MIN_SCORE` in `src/hook.ts` were set by replaying real prompts. Re-check the trigger rate (target under about a fifth of prompts) before lowering them.
- Catalog text is untrusted. Anything shown to the model is flattened, truncated and labelled as data (`render` in `src/hook.ts`).
- `safe` means the skill cannot run anything by itself. Loosening `src/safety.ts` needs a test showing why the new case cannot execute code or widen permissions.
- The installer never writes into or deletes a skill folder without its `.autoskill.json` marker.
- `catalog/catalog.json` is written by the weekly Action; hand edits are overwritten. Change `catalog/sources.json` instead.
- Nothing from a real user's transcripts or prompts goes into the repo, tests included.
