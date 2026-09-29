import { installName } from './text.ts';
import type { Risk } from './types.ts';

/** What search needs from a skill. `terms` is precomputed by `indexTerms` in the slim index. */
export interface Searchable {
  id: string;
  name: string;
  description: string;
  risk: Risk;
  quality: number;
  sha?: string;
  terms?: string;
}

const STOPWORDS = new Set(
  `a an the and or but if then else of to in on at by for with from into onto about as is are was were be been being
  it its this that these those there here i me my we our you your he she they them their what which who whom how why when where
  do does did doing done can could should would will shall may might must not no yes so too very just also only really
  please want need like make get got let lets use using used help some any all each every more most other such than
  up down out over under again further once one two new now way thing things something anything stuff ok okay hey hi thanks
  skill skills claude code task work working file files
  good great nice perfect cool awesome wow love pretty super look looks see show find check tell give know think say said mean
  big small next step ready take have has had already until reach put keep going go sure right able same level quality less
  first last lot much many well better best bad try bit kind sort maybe actually basically still even though tho gonna wanna
  today tomorrow yesterday time day week there their thats dont cant wont im youre whats`.split(/\s+/),
);

const NAME_WEIGHT = 3;
const K1 = 1.2;
const B = 0.75;
/** A term found in more than ~20% of skills says little about fit. */
const MIN_IDF = 1.5;
/**
 * A one-word name this common (review, design, test, api: in ~3% of skills) is a topic, not a task,
 * so it ranks below specific names. A word in a handful of skills is never generic, however small the catalog.
 */
const GENERIC_NAME_IDF = 3.5;
const GENERIC_NAME_MIN_DF = 20;
const GENERIC_NAME_FACTOR = 0.7;

export function stem(word: string): string {
  if (word.length >= 7 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length >= 6 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length >= 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map(stem);
}

/** `name terms|description terms`, space separated. */
export function indexTerms(skill: Pick<Searchable, 'name' | 'description'>): string {
  return `${[...new Set(tokenize(skill.name.replace(/[-_]/g, ' ')))].join(' ')}|${tokenize(skill.description).join(' ')}`;
}

/**
 * An inverted index: term to flat [doc, tf, doc, tf, ...] pairs, plus each
 * doc's weighted length. Prebuilt by the crawl so the hook does not tokenize
 * 20k descriptions on every prompt.
 */
export interface Postings {
  terms: Record<string, number[]>;
  lengths: number[];
}

export function buildPostings(skills: readonly Searchable[]): Postings {
  // No prototype: a term like `constructor` must not find Object.prototype.constructor.
  const terms = Object.create(null) as Record<string, number[]>;
  const lengths = skills.map((skill, doc) => {
    const counts = new Map<string, number>();
    const [name = '', description = ''] = (skill.terms ?? indexTerms(skill)).split('|');
    for (const term of name.split(' ')) if (term) counts.set(term, (counts.get(term) ?? 0) + NAME_WEIGHT);
    for (const term of description.split(' ')) if (term) counts.set(term, (counts.get(term) ?? 0) + 1);
    let length = 0;
    for (const [term, tf] of counts) {
      (terms[term] ??= []).push(doc, tf);
      length += tf;
    }
    return length;
  });
  return { terms, lengths };
}

export interface Hit<T extends Searchable = Searchable> {
  skill: T;
  score: number;
  /** Distinct informative query terms the skill matched. */
  matched: string[];
  /** Share of the skill name's informative terms found in the query. */
  nameCoverage: number;
}

/** Near the best score of its name, quality decides: the original beats a fork with a terser description. */
const COPY_SCORE_SHARE = 0.6;
/** A name published by many repos is the canonical one for its task; each e-fold of repos adds 20%. */
const COPY_BONUS = 0.2;

/**
 * Forks and mirrors publish the same skill under many paths. Show each name
 * once, ranked by the best match among its copies, represented by the copy
 * with the highest quality that still matches nearly as well.
 */
function collapseCopies<T extends Searchable>(hits: Hit<T>[]): Hit<T>[] {
  const groups = new Map<string, Hit<T>[]>();
  for (const hit of hits) {
    const key = installName(hit.skill);
    groups.set(key, [...(groups.get(key) ?? []), hit]);
  }
  return [...groups.values()]
    .map((copies) => {
      const best = Math.max(...copies.map((hit) => hit.score));
      const pick = copies
        .filter((hit) => hit.score >= best * COPY_SCORE_SHARE)
        .sort((a, b) => b.skill.quality - a.skill.quality || b.score - a.score)[0] as Hit<T>;
      const repos = new Set(copies.map((hit) => hit.skill.id.split(':')[0])).size;
      return { ...pick, score: best * (1 + COPY_BONUS * Math.log(repos)) };
    })
    .sort((a, b) => b.score - a.score);
}

export class Index<T extends Searchable = Searchable> {
  private readonly skills: readonly T[];
  private readonly postings: Postings;
  private readonly avgLength: number;

  constructor(skills: readonly T[], postings?: Postings) {
    this.skills = skills;
    this.postings = postings ?? buildPostings(skills);
    this.avgLength = this.postings.lengths.reduce((sum, length) => sum + length, 0) / Math.max(1, skills.length);
  }

  private list(term: string): number[] | undefined {
    return Object.hasOwn(this.postings.terms, term) ? this.postings.terms[term] : undefined;
  }

  private df(term: string): number {
    return (this.list(term)?.length ?? 0) / 2;
  }

  /** Share of the query's terms that occur anywhere in the catalog; low for a prompt in another language. */
  knownShare(query: string): number {
    const terms = tokenize(query);
    return terms.length ? terms.filter((term) => this.df(term) > 0).length / terms.length : 0;
  }

  idf(term: string): number {
    const n = this.df(term);
    return Math.log(1 + (this.skills.length - n + 0.5) / (n + 0.5));
  }

  search(query: string, options: { limit?: number; exclude?: ReadonlySet<string> } = {}): Hit<T>[] {
    const scores = new Map<number, { score: number; matched: string[] }>();
    for (const term of new Set(tokenize(query))) {
      const list = this.list(term);
      if (!list) continue;
      const idf = this.idf(term);
      for (let i = 0; i < list.length; i += 2) {
        const doc = list[i] as number;
        const tf = list[i + 1] as number;
        const length = this.postings.lengths[doc] ?? 0;
        const entry = scores.get(doc) ?? { score: 0, matched: [] };
        entry.score += (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * length) / this.avgLength));
        if (idf >= MIN_IDF) entry.matched.push(term);
        scores.set(doc, entry);
      }
    }

    const hits: Hit<T>[] = [];
    for (const [doc, { score, matched }] of scores) {
      const skill = this.skills[doc];
      if (!skill || options.exclude?.has(skill.name) || options.exclude?.has(skill.id) || options.exclude?.has(installName(skill))) continue;
      const nameTerms = new Set(tokenize(skill.name.replace(/[-_]/g, ' ')));
      const informativeName = [...nameTerms].filter((term) => this.idf(term) >= MIN_IDF);
      const nameCoverage = informativeName.length ? informativeName.filter((term) => matched.includes(term)).length / informativeName.length : 0;
      const [onlyTerm] = informativeName;
      const generic = informativeName.length === 1 && this.idf(onlyTerm as string) < GENERIC_NAME_IDF && this.df(onlyTerm as string) >= GENERIC_NAME_MIN_DF;
      hits.push({ skill, score: score * (0.5 + skill.quality / 200) * (generic ? GENERIC_NAME_FACTOR : 1), matched, nameCoverage });
    }
    return collapseCopies(hits).slice(0, options.limit ?? 10);
  }
}
