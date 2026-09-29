# Do popular Claude Code skills help Opus 5.5?

Measured 2026-09-29 with `autoskill eval --headroom --grounded`. 32 skills.

For each skill, 8 hard tasks are generated from its description and the facts it states. Opus 5.5 answers them once with no skill loaded. Only the tasks it mostly fails (score 0.7 or less) are kept, and those are run again, twice with the skill and twice without, all graded by an Opus judge against the task's checks. The delta is the with-skill score minus the no-skill score, from 0 to 1, per task, averaged; the interval is a 95% t-interval over tasks. A skill Claude loaded in fewer than half of its runs is marked "did not load": its delta is noise (one such skill scored +0.08 without ever loading).

| skill | verdict | delta | 95% interval | tasks | loaded |
|---|---|---|---|---|---|
| [obra/superpowers:skills/writing-skills](https://github.com/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/writing-skills) | helps | +0.38 | +0.07 to +0.70 | 3 | 100% |
| [blader/humanizer:](https://github.com/blader/humanizer/tree/225a6f39ac85f76ee48dbad772ea4abe4ed6c9d8/) | helps | +0.13 | +0.00 to +0.25 | 6 | 75% |
| [obra/superpowers:skills/receiving-code-review](https://github.com/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/receiving-code-review) | no clear effect | +0.28 | -0.12 to +0.67 | 4 | 50% |
| [coreyhaines31/marketingskills:skills/copywriting](https://github.com/coreyhaines31/marketingskills/tree/5b2c0007766c6a1cf1d53fd8fc73e979e0821022/skills/copywriting) | no clear effect | +0.17 | -0.14 to +0.48 | 4 | 100% |
| [anthropics/skills:skills/skill-creator](https://github.com/anthropics/skills/tree/8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4/skills/skill-creator) | no clear effect | +0.16 | -0.01 to +0.34 | 4 | 75% |
| [coreyhaines31/marketingskills:skills/ab-testing](https://github.com/coreyhaines31/marketingskills/tree/5b2c0007766c6a1cf1d53fd8fc73e979e0821022/skills/ab-testing) | no clear effect | +0.07 | -0.22 to +0.35 | 3 | 100% |
| [K-Dense-AI/scientific-agent-skills:skills/scientific-writing](https://github.com/K-Dense-AI/scientific-agent-skills/tree/065b734670d7d990627dbc06a05b5a99be33f1f1/skills/scientific-writing) | no clear effect | +0.03 | -0.11 to +0.18 | 3 | 50% |
| [coreyhaines31/marketingskills:skills/ai-seo](https://github.com/coreyhaines31/marketingskills/tree/5b2c0007766c6a1cf1d53fd8fc73e979e0821022/skills/ai-seo) | no clear effect | +0.03 | -0.48 to +0.55 | 3 | 100% |
| [addyosmani/agent-skills:skills/test-driven-development](https://github.com/addyosmani/agent-skills/tree/2686b620fc1fed2e8f60c704839c766b8594c6b6/skills/test-driven-development) | no clear effect | +0.01 | -0.19 to +0.22 | 4 | 75% |
| [JuliusBrussee/caveman:plugins/caveman/skills/caveman](https://github.com/JuliusBrussee/caveman/tree/2fd153c67988e980fb0b2455c90832159a6a5a25/plugins/caveman/skills/caveman) | no clear effect | -0.03 | -0.23 to +0.17 | 4 | 75% |
| [obra/superpowers:skills/writing-plans](https://github.com/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/writing-plans) | no clear effect | -0.04 | -0.59 to +0.51 | 3 | 100% |
| [deanpeters/Product-Manager-Skills:skills/customer-journey-map](https://github.com/deanpeters/Product-Manager-Skills/tree/1b5a524ebb95e9497fa3f25002d8b8ec528d4444/skills/customer-journey-map) | too few cases | +0.10 | -1.17 to +1.37 | 2 | 100% |
| [obra/superpowers:skills/brainstorming](https://github.com/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/brainstorming) | too few cases | -0.10 | -1.37 to +1.17 | 2 | 100% |
| [addyosmani/agent-skills:skills/code-review-and-quality](https://github.com/addyosmani/agent-skills/tree/2686b620fc1fed2e8f60c704839c766b8594c6b6/skills/code-review-and-quality) | did not load | +0.08 | -0.98 to +1.14 | 2 | 25% |
| [multica-ai/andrej-karpathy-skills:skills/karpathy-guidelines](https://github.com/multica-ai/andrej-karpathy-skills/tree/2c606141936f1eeef17fa3043a72095b4765b9c2/skills/karpathy-guidelines) | did not load | +0.07 | -0.01 to +0.15 | 4 | 0% |
| [obra/superpowers:skills/verification-before-completion](https://github.com/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/verification-before-completion) | did not load | +0.07 | -0.09 to +0.24 | 3 | 0% |
| [deanpeters/Product-Manager-Skills:skills/competitive-analysis-process](https://github.com/deanpeters/Product-Manager-Skills/tree/1b5a524ebb95e9497fa3f25002d8b8ec528d4444/skills/competitive-analysis-process) | did not load | 0.00 | -0.13 to +0.13 | 4 | 25% |
| [obra/superpowers:skills/systematic-debugging](https://github.com/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/systematic-debugging) | did not load | 0.00 | -0.26 to +0.26 | 4 | 0% |
| [anthropics/skills:skills/frontend-design](https://github.com/anthropics/skills/tree/8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4/skills/frontend-design) | did not load | -0.07 | -0.24 to +0.09 | 3 | 33% |

## No headroom (13)

Opus 5.5 already scored above 0.7 on at least 7 of the 8 hard tasks without the skill, so there was nothing for the skill to improve.

- [anthropics/skills:skills/doc-coauthoring](https://github.com/anthropics/skills/tree/8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4/skills/doc-coauthoring): no-skill score 0.81
- [anthropics/skills:skills/webapp-testing](https://github.com/anthropics/skills/tree/8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4/skills/webapp-testing): no-skill score 0.81
- [obra/superpowers:skills/requesting-code-review](https://github.com/obra/superpowers/tree/8ca22dba9a94f28898bbce59f2537ff4d87c747d/skills/requesting-code-review): no-skill score 0.81
- [addyosmani/agent-skills:skills/api-and-interface-design](https://github.com/addyosmani/agent-skills/tree/2686b620fc1fed2e8f60c704839c766b8594c6b6/skills/api-and-interface-design): no-skill score 0.83
- [affaan-m/ECC:.agents/skills/mcp-server-patterns](https://github.com/affaan-m/ECC/tree/d3b8a3e908904e242ed2dbe66af62cca71131419/.agents/skills/mcp-server-patterns): no-skill score 0.84
- [coreyhaines31/marketingskills:skills/cro](https://github.com/coreyhaines31/marketingskills/tree/5b2c0007766c6a1cf1d53fd8fc73e979e0821022/skills/cro): no-skill score 0.82
- [wshobson/agents:plugins/backend-development/skills/api-design-principles](https://github.com/wshobson/agents/tree/156b7a5e7a8b93642628a339ee4039c925b34c7f/plugins/backend-development/skills/api-design-principles): no-skill score 0.83
- [anthropics/skills:skills/mcp-builder](https://github.com/anthropics/skills/tree/8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4/skills/mcp-builder): no-skill score 0.92
- [affaan-m/ECC:.kiro/skills/database-migrations](https://github.com/affaan-m/ECC/tree/d3b8a3e908904e242ed2dbe66af62cca71131419/.kiro/skills/database-migrations): no-skill score 0.79
- [affaan-m/ECC:.agents/skills/verification-loop](https://github.com/affaan-m/ECC/tree/d3b8a3e908904e242ed2dbe66af62cca71131419/.agents/skills/verification-loop): no-skill score 0.77
- [wshobson/agents:plugins/blockchain-web3/skills/solidity-security](https://github.com/wshobson/agents/tree/156b7a5e7a8b93642628a339ee4039c925b34c7f/plugins/blockchain-web3/skills/solidity-security): no-skill score 0.81
- [wshobson/agents:plugins/backend-development/skills/microservices-patterns](https://github.com/wshobson/agents/tree/156b7a5e7a8b93642628a339ee4039c925b34c7f/plugins/backend-development/skills/microservices-patterns): no-skill score 0.84
- [anthropics/skills:skills/brand-guidelines](https://github.com/anthropics/skills/tree/8a1541c4a3ffa5a20a5a91de0dcf3f0bab1d1ef4/skills/brand-guidelines): no-skill score 0.83

## Limits

- Tasks are text answers judged by a model, not runs in a real repository. Skills whose value is a procedure with tools (running tests, driving a browser) are under-measured.
- 2 to 8 tasks per skill: small samples, which is why every delta carries its interval. "No clear effect" means the interval spans zero, not that the skill does nothing.
- The judge is Claude grading Claude.
