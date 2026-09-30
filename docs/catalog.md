# The catalog

The catalog is rebuilt every day by a GitHub Action (`.github/workflows/crawl.yml`) and published to the `catalog` branch, which clients download from: `catalog.json`, plus `index.json`, a slim prebuilt search index the hook loads. The branch holds one force-pushed commit, so daily updates never bloat the history; the copy on `main` that ships inside the plugin is refreshed on Mondays. A crawl that finds under 85% of the last published skill count is refused rather than published. The crawl collects repos under the topics in `catalog/sources.json` plus a list of known repos, finds every `SKILL.md` in the git tree, reads the skill's text files from one tarball per repo, and drops:

- archived repos,
- skills with no description,
- repos untouched for two years with fewer than 50 stars,
- skills scoring under 25,
- byte-identical copies (the most-starred copy is kept).

A skill that disappears upstream disappears from the catalog on the next crawl. Your local copy refreshes itself in the background once a day (about 10 MB gzipped: 6.0 MB for the catalog, 4.1 MB for the search index, measured 30 Sep 2026), or right away with `autoskill update`.

## Quality score (0 to 100)

| signal | points |
|---|---|
| stars | up to 30, 7.5 per decade (10, 100, 1k, 10k) |
| last push | 20 within 90 days, 12 within a year, 5 within two |
| description | 15 for 40 to 1536 characters, +10 if it says when to use it |
| body | 10 for 300 characters to 60 kB, 3 otherwise |
| license | 5 |
| Anthropic's own repos | 10 |

It is a static score, computed without running the skill. The measured results below are the other half.
