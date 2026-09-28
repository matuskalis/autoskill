const DAY = 86_400_000;
const OFFICIAL_OWNERS = new Set(['anthropics']);

export interface QualityInput {
  repo: string;
  stars: number;
  pushedAt: string;
  license: string | null;
  description: string;
  bodyLength: number;
}

/**
 * A static 0-100 score from what the catalog can see without running the
 * skill. Weights, so a reader can argue with them:
 *   stars      up to 30, 7.5 per decade (10, 100, 1k, 10k stars)
 *   freshness  20 if pushed in 90 days, 12 in a year, 5 in two
 *   description 15 for 40 to 1536 chars, +10 if it says when to use it
 *   body       10 for 300 chars to 60 kB, 3 otherwise
 *   license    5
 *   official   10 for Anthropic's own repos
 */
export function quality(input: QualityInput, now = Date.now()): number {
  let score = Math.min(30, 7.5 * Math.log10(input.stars + 1));

  const age = (now - Date.parse(input.pushedAt)) / DAY;
  if (age <= 90) score += 20;
  else if (age <= 365) score += 12;
  else if (age <= 730) score += 5;

  const description = input.description.trim();
  if (description.length >= 40 && description.length <= 1536) score += 15;
  if (/\b(use (this )?(when|for|whenever)|triggers? (on|when)|when (the )?user)\b/i.test(description)) score += 10;

  score += input.bodyLength >= 300 && input.bodyLength <= 60_000 ? 10 : 3;
  if (input.license) score += 5;
  if (OFFICIAL_OWNERS.has(input.repo.split('/')[0] ?? '')) score += 10;

  return Math.round(Math.min(100, score));
}
