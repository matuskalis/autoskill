# Competitors: skill recommenders, routers and marketplaces

Researched 29 Sep 2026. Web sources only; star counts and catalog sizes move fast.

## Registries and marketplaces

**skills.sh (Vercel Labs).** Directory plus `npx skills find/add` CLI, GitHub-backed, 19 agents. Installs only on explicit command; a `find-skills` skill lets the agent search and suggest. Ranking: leaderboard by anonymous install telemetry (popularity). Safety: audits by Gen Agent Trust Hub, Socket and Snyk on 60k+ skills, flagged ones hidden, risk shown before install since skills@1.4.0; Snyk found 13.4% of 3,984 skills critical (Feb 2026). Free. 90k+ skills tracked. [FAQ](https://www.skills.sh/docs/faq), [Vercel changelog](https://vercel.com/changelog/automated-security-audits-now-available-for-skills-sh)

**SkillsMP.** Index of 3M+ GitHub SKILL.md files, semantic search, public API. No auto-install. Deliberately no popularity ranking, but no quality or effect ranking either. No vetting ("review code before installation"). Free, Ko-fi. [About](https://skillsmp.com/about)

**localskills.sh.** Team/private registry, RBAC, SSO/SCIM. No recommendation or auto-install found. Security scanning listed as "coming soon" on the features page. Pricing page exists, tiers not found. [Features](https://localskills.sh/features)

**ClawHub (OpenClaw).** ~13.7k skills, ranked by downloads. 341 malicious skills (AMOS stealer) found Feb 2026; VirusTotal scan on every publish since 7 Feb 2026, 3-report auto-hide, ranking manipulated to #1 in a Silverfort PoC. Mostly free. OpenClaw only. [Hacker News, Feb 2026](https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html), [VirusTotal, Feb 2026](https://thehackernews.com/2026/02/openclaw-integrates-virustotal-scanning.html), [Silverfort](https://www.silverfort.com/blog/clawhub-vulnerability-enables-attackers-to-manipulate-rankings-to-become-the-number-one-skill/)

**claudemarketplaces.com.** Directory of 2,700+ marketplaces, daily GitHub crawl, stars, votes, editor-reviewed AI summaries. No install. No security scanning found. Free. [About](https://claudemarketplaces.com/about)

**Anthropic official marketplace + Claude Code.** `claude-plugins-official` auto-added, auto-updates; curated at Anthropic's discretion; community marketplace takes submissions with CI screening on each update. Free to install. Web catalog shows install counts and "Anthropic verified". `/plugin` Discover tab is browse/search only; install always needs scope confirmation. Built-in proactive suggestion per prompt: not found. Nearest thing is the official `claude-code-setup` plugin (`claude-automation-recommender`), a read-only codebase scan that suggests 1-2 automations per category, no install, no measurement. `claude plugin eval` (v2.1.269, ~11 Sep 2026) runs with/without and reports delta, but for authors; marketplace does not display eval deltas (not found). [Anthropic marketplaces](https://code.claude.com/docs/en/plugins/anthropic-marketplaces), [install docs](https://code.claude.com/docs/en/discover-plugins), [plugin evals](https://code.claude.com/docs/en/plugin-evals), [MarkTechPost, 11 Sep 2026](https://www.marktechpost.com/2026/09/11/anthropic-adds-plugin-evals-to-claude-code-6-grader-types-a-no-plugin-baseline-and-a-ci-gate-for-skills/), [claude-code-setup](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-code-setup)

## GitHub finders and routers (all free, MIT where stated)

| Project | Mechanism | Auto-install | Ranking | Vetting | Activity |
|---|---|---|---|---|---|
| [skillless](https://github.com/0oooooooo0/skillless) | background discovery, `/discover`, `/plans`; local, then skills.sh, then GitHub | no, explicit confirm | source order + stack detection | none beyond confirm | 38 stars, 6 commits |
| [ckorhonen skill-finder](https://github.com/ckorhonen/claude-skills/blob/main/skills/skill-finder/SKILL.md) | skill, queries claude-plugins.dev API | yes, no confirm on "credible match" | stars >500 or installs >50 | "no obvious security concerns" (LLM judgment) | not found |
| [umputun skill-eval](https://www.claudepluginhub.com/plugins/umputun-skill-eval-plugins-skill-eval) | UserPromptSubmit hook forcing a skill-evaluation step | installed only | none (no delta) | none | 476 stars, updated 8 Sep 2026 |
| [auto-skill-finder](https://github.com/prantikmedhi/auto-skill-finder) | UserPromptSubmit hook, keyword points | installed skills only | keyword score | none | 3 stars |
| [hussi9/skill-router](https://github.com/hussi9/skill-router) | hook, lexical index + LLM tie-break | installed only | lexical; learns from follow/ignore; 99.1% on 109 author-curated prompts | none | 26 stars |

## Research systems

**SkillsVote** (MemTensor, arXiv 2605.18401, May/Jun 2026). Profiles a million-scale corpus for quality and verifiability, recommends via agentic library search, attributes outcomes from trajectories, evolves skills. Hosted API (key, pricing not found) and local mode, Claude Code setup. Measured effect, but at system level (Terminal-Bench 2.0 up to +7.9 pp, SWE-Bench Pro +2.6 pp), not a published per-skill with/without delta. 302 stars, MIT. [arXiv](https://arxiv.org/abs/2605.18401), [repo](https://github.com/MemTensor/skills-vote)

**SkillRet** (arXiv 2605.05726, May 2026). Benchmark only: 17,810 skills; retrieval "far from solved". Measures relevance, not effect. [arXiv](https://arxiv.org/abs/2605.05726)

## Where autoskill stands

- **Differentiated: ranking by measured uplift.** Every live competitor ranks by installs, downloads, stars or lexical relevance. SkillsVote measures outcomes but reports aggregate benchmark gains; `claude plugin eval` delta is used only author-side as a CI gate ([dev.to](https://dev.to/davekurian/claude-code-plugin-eval-gate-skills-on-delta-before-you-merge-5bh6), [aibuilders, 17 Jul 2026](https://www.aibuilders.blog/p/how-to-build-a-claude-plugin-marketplace-evals)); no recommender found uses it as the ranking signal.
- **Differentiated: pinned installer with safe/review tiers.** skill-finder auto-installs on a star threshold and an LLM hunch; skills.sh installs whatever HEAD is ("new installs always fetch the current contents"). Pinning closes the reviewed-then-changed hole; tiers blunt ClawHub-style typosquats and rank gaming.
- **Not differentiated: the UserPromptSubmit hook.** auto-skill-finder, umputun skill-eval (476 stars) and hussi9/skill-router already route per prompt from a hook; skillless and skill-finder already discover and install from registries.
- **Not differentiated: security scanning.** skills.sh (Snyk, Socket, Gen), ClawHub (VirusTotal) and Anthropic's community CI already scan at far larger scale. autoskill should consume those signals, not compete.
- **Risk: Anthropic owns the eval primitive.** `claude plugin eval` is two weeks old; if the official marketplace starts showing deltas next to install counts, the uplift moat narrows to curation, catalog coverage and the prompt-time trigger.

## Gaps

- localskills.sh pricing, claudemarketplaces.com moderation depth, lomeshdutta/skill-router (Jev + skills.sh) details: not found.
- ClawHub counts and SkillsMP 3M figure are single-source (secondary blog / self-reported).
