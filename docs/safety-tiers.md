# Safety tiers

Every skill in the catalog is sorted into one of two tiers by `classify` in `src/safety.ts`. The check runs twice: in the crawl, on the text of each repository, and again on your machine, on the files that were actually downloaded, before anything is written.

| tier | means | install |
|---|---|---|
| `safe` | prose only: text files, descriptive frontmatter, no code blocks, no commands | `autoskill add`, automatic |
| `review` | ships code, sets `allowed-tools`, `hooks`, `shell`, `model` or any other behaviour key, uses YAML the checker cannot read, runs `` !`cmd` `` on load, contains a code block, names shell or network commands, talks about Claude Code settings or permissions, MCP tools, git hooks, CLAUDE.md or startup paths, points at remote instructions, carries an encoded blob, or tells Claude to run something | Claude asks you, then `autoskill install --yes` |

The check fails closed, so most skills land in `review`: 8.2% of the 24,305 skills in the catalog on 30 Sep 2026 are `safe`. "Safe" means the skill cannot make Claude run anything by itself. It does not mean every instruction in it is good advice.

## What puts a skill in review

The rules are regular expressions over text, so a reader can argue with each one. One reason is enough, and every reason found is recorded (that is what `autoskill add` prints when it refuses).

- **Frontmatter.** Only `name`, `description`, `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`, `user-invocable`, `metadata`, `license`, `compatibility`, `paths` and `version` only describe or route a skill. Any other key (`allowed-tools`, `hooks`, `shell`, `model`, `agent`, `context`, `background`, anything unknown) changes what runs or with which permissions. YAML this parser cannot read, and a `---` inside a frontmatter line (Claude Code would end the frontmatter there), also go to review.
- **Files.** Any file that is not markdown or text, and any text file that carries frontmatter of its own. A license at the skill root is an ordinary text file.
- **Code and commands.** Shell on load (`` !`cmd` ``), any fenced or indented code block, names of shell or network tools (`curl`, `pip`, `docker`, `osascript`, and so on), prose that tells the model to run or execute something.
- **Reach beyond the conversation.** Claude Code settings, permissions and the `.claude` directory; MCP tools; git hooks; CLAUDE.md, AGENTS.md or memory files; startup and system locations; instructions to fetch a remote URL; URLs built from data; encoded blobs.
- **Evasion.** Text is normalised before matching, so fullwidth letters and zero-width characters do not hide a command, and line-wrapped base64 is joined before the blob check.

`test/safety.test.ts` covers these rules and the wording that must stay safe (ordinary prose, a plain citation link, license paragraphs).

## Red flags

Separate from tiers, a scan looks for patterns that are warning signs rather than capabilities: piping a download from an untrusted host (a raw IP, plain http, a paste site, a tunnel, a link shortener) into a shell, decoding a blob and running it, instructions to override or hide instructions from the user, sending the environment or credential files to a URL, reading private keys, and fetching remote instructions and following them.

In the crawl, a skill with a red flag is published only as "held for manual review"; the evidence stays private until a person has read it, and a reviewed finding stays cleared only while the flagged lines are unchanged. On install, a downloaded file with a red flag makes the skill review tier even when the catalog said safe. [The audit](audit-2026-09.md) describes what a hand review of 461 flags found.

## What a human yes means

`autoskill add` refuses review tier whatever the flags. `autoskill install <id> --yes` installs it, and in Claude Code that command goes through the permission prompt, which is the yes. Do not allow `Bash(autoskill install:*)`: `autoskill doctor` fails when a rule would let it through.
