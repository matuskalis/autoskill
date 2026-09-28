import type { CatalogSkill } from '../src/types.ts';

export function skill(name: string, description: string, extra: Partial<CatalogSkill> = {}): CatalogSkill {
  return {
    id: `acme/skills:skills/${name}`,
    name,
    description,
    repo: 'acme/skills',
    dir: `skills/${name}`,
    sha: 'a'.repeat(40),
    stars: 100,
    pushedAt: new Date().toISOString(),
    license: 'MIT',
    files: [{ path: 'SKILL.md', size: 100 }],
    hash: 'h',
    risk: 'safe',
    riskReasons: [],
    quality: 80,
    ...extra,
  };
}
