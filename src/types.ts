export type Risk = 'safe' | 'review';

export interface SkillFile {
  /** Path relative to the skill directory. */
  path: string;
  size: number;
}

export interface CatalogSkill {
  /** `owner/repo:dir`, stable across crawls. */
  id: string;
  name: string;
  description: string;
  repo: string;
  /** Skill directory inside the repo; empty string for a repo-root skill. */
  dir: string;
  /** Commit the skill is pinned to. */
  sha: string;
  stars: number;
  pushedAt: string;
  license: string | null;
  files: SkillFile[];
  /** sha256 of SKILL.md as fetched. */
  hash: string;
  risk: Risk;
  riskReasons: string[];
  quality: number;
}

export interface Catalog {
  version: 1;
  generatedAt: string;
  skills: CatalogSkill[];
}

export interface Frontmatter {
  fields: Record<string, string>;
  body: string;
  /** A line this parser could not read as `key: value`; the safety check fails closed on it. */
  malformed: boolean;
}
