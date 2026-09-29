# When do Agent Skills lift a frontier model? (2026-09-29)

## 1. SkillsBench (arXiv 2602.12670, skillsbench.ai)
- **v1 (13 Feb 2026):** 86 tasks, 11 domains, 7 configs, 7,308 trajectories. Curated skills +16.2pp; domains ranged "+4.5pp Software Engineering to +51.9pp Healthcare"; self-generated skills gave "no average benefit". The survey 2606.11435 repeats these v1 numbers.
- **v4 (14 Jun 2026, current):** 87 tasks, 8 domains (no Healthcare), 18 model-harness configs, 3 trials per cell, temperature 0, 85/87 tasks graded by pytest in a container. Mean 33.9% to 50.5% (+16.6pp). Per domain: Natural Science +28.8, Media +24.1, Cybersecurity +18.9, Industrial +15.7, Finance +14.2, Office +12.6, Software Eng +11.6, Math/OR +9.7. The +51.9pp Healthcare figure is not in v4.
- **Model strength:** not monotonic. Strong models still gain (Claude Code + Opus 4.7 +18.2, Codex + GPT-5.5 +19.7), the weakest gains least (Gemini 3.1 Flash Lite +4.1), and OpenHands + Gemini 3.5 Flash gains only +7.1 from a 41.1% baseline.
- **Self-generated skills (v4):** below the no-skill baseline, −8.1pp (Claude Code + Opus 4.7) to −11.5pp, while curated skills added +18.2 to +24.8pp. Causes: unused packs, displaced solving, wrong content.
- **Size:** compact +19.0 and standard +21.5pp, detailed +14.5, comprehensive +0.7. Skills hurt 13 of 87 tasks, through heavy prescriptive pipelines displacing better defaults.

## 2. Closest analog to your result: SWE-Skills-Bench (arXiv 2603.15401, 16 Mar 2026)
49 public SWE skills, about 565 tasks on pinned repos, execution-based tests, Claude Code + Haiku 4.5. **39 of 49 skills gave zero change; 24 were at 100% with and without.** Mean gain +1.2%, token overhead up to +451%. Winners encode specific formulas or checklists: risk-metrics-calculation +30%, gitlab-ci-patterns +14.3%, tdd-workflow +7.1%. Losers: linkerd-patterns −9.1% (the agent copied outdated API versions), django-patterns −9.1%, springboot-tdd −10%. Single source, Haiku not Opus.

## 3. Other 2026 papers
- **SkillAudit (2606.22613, 21 Jun 2026):** LLM-generated scenarios per skill, paired with and without the skill, one run each, judged by Sonnet 4.6 against checklists. A ceiling effect is stated explicitly: 50.3% of scenarios were already perfect without the skill under Claude Code / Sonnet 4.6 (23.9% under Sonnet 4).
- **SkillsVote (2605.18401, May/Jun 2026):** gains shrink with model strength. Terminal-Bench 2.0: GPT-5.2 +2.6pp vs GPT-5.5 xhigh +0.9pp. SWE-Bench Pro: +2.7 vs +1.2. Predictors of value: environment-specific executable resources (CLIs, MCPs, env vars), clear applicability boundaries, verifiability. Popularity was not a predictor, and unfiltered exposure to the skill library gave net negative deltas.
- **Skill Coverage (2606.20659, Jun/Jul 2026):** runs on SkillsBench exercise only 38.7 to 45.5% of a skill's behavior constraints, so most of what a skill says is never tested by the tasks.
- **Agent Skill Evaluation and Evolution (2606.11435, 9 Jun 2026):** a survey. It notes that binary metrics hide cost and latency, and that no benchmark tracks a skill across revisions. It reports CoEvoSkills finding self-evolved skills beat curated ones (secondary, single source). This is iterative evolution with failure feedback, not one-shot generation, which differs from the SkillsBench condition.

**Your four candidate properties:**
- **Domain checklists and formulas:** supported.
- **Tool procedures and executable resources:** supported (SkillsVote).
- **Formats and conventions:** no clean test found.
- **Proprietary or post-cutoff knowledge:** not tested as a variable anywhere (not found). The nearest evidence is that stale version knowledge hurts.

## 4. Anthropic guidance
- Skill best practices (platform.claude.com, accessed 2026-09-29): "Claude is already very smart. Only add context Claude doesn't already have." Build evals first: run without a skill, record the failures, write minimal instructions for those gaps.
- agentskills.io "Evaluating skill output quality": run each case with and without the skill, and "remove or replace assertions that always pass in both configurations."
- `claude plugin eval` (code.claude.com/docs/en/plugin-evals; Claude Code 2.1.269, Sep 2026):
  - Runs each case 3 times per arm, with a no-plugin baseline and a Δ.
  - Six grader types: regex, tool_used, tool_order, file_exists, llm (2 of 3 judge votes), baseline.
  - Each run starts in an empty workspace. Bash, Write and Edit are removed unless granted.
  - "The most common first finding is a Δ near zero" with the skill not firing.
  - The default judge is a small model that can fail correct answers formatted differently; use `--judge-model sonnet`.

## 5. Implications for the harness
- **Ceiling:** your 0 to +0.03 matches SWE-Skills-Bench and SkillAudit. Build tasks from a no-skill run: keep only items the bare model fails, then check whether the skill fixes them. Drop checks that pass in both arms.
- **Text-only tasks under-measure procedural skills.** Terraform and react-native skills matter at `terraform validate/plan`, lint or a test run. Grant tools, seed a workspace, and grade files and commands with regex, tool_used and file_exists.
- **Trigger check:** confirm the with-arm actually loaded the skill. Otherwise Δ=0 may just mean the skill never fired.
- **Target skill-specific constraints** (Skill Coverage): project conventions, versions, internal names. Generated generic questions test general knowledge.
- **Judge:** use a stronger judge, short rubric targets, and deterministic graders where possible. Self-preference bias when Claude judges Claude is a general finding, not tested in these papers.
- **Runs:** no paper derives the runs needed for a stable delta (not found). SkillsBench and plugin eval use 3, SkillAudit 1. My own estimate: detecting +0.03 over a 0.95 baseline at 80% power needs roughly 800 graded items per arm, so either widen headroom or accept that small deltas are noise.

Sources: arxiv.org/abs/2602.12670 (v1, v4), arxiv.org/abs/2603.15401, arxiv.org/abs/2606.22613, arxiv.org/abs/2605.18401, arxiv.org/abs/2606.20659, arxiv.org/abs/2606.11435, agentskills.io/skill-creation/evaluating-skills, code.claude.com/docs/en/plugin-evals, code.claude.com/docs/en/skills, platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
