import { parseFrontmatter } from './frontmatter.ts';
import type { Risk, SkillFile } from './types.ts';

/**
 * Frontmatter keys that only describe or route a skill. Every other key in the
 * skill reference changes what runs or with which permissions: allowed-tools,
 * hooks, shell, model, agent, context, background and anything unknown.
 */
const DESCRIPTIVE_KEYS = new Set([
  'name',
  'description',
  'when_to_use',
  'argument-hint',
  'arguments',
  'disable-model-invocation',
  'user-invocable',
  'metadata',
  'license',
  'compatibility',
  'paths',
  'version',
]);

const TEXT_EXTENSIONS = /\.(md|markdown|txt)$/i;
const LICENSE_FILE = /^(LICEN[CS]E|COPYING|NOTICE)(\.(md|txt))?$/i;

/** `!`cmd`` runs a shell command when the skill loads, before the model sees it. */
const DYNAMIC_CONTEXT = /!`[^`\n]+`/;
/** Any fenced block. Safe skills are prose; code in a fence is usually meant to be run. */
const FENCE = /^\s*(```|~~~)/m;
/** Prose that tells the model to execute something, with or without a fence. */
const RUN_PHRASE =
  /\b(bash tool|terminal|command line|shell|subprocess|(run|execute)\s+(it|this|that|these|the|a|an)?\s*(following|command|script|code|snippet|helper|binary|program))\b/i;
const COMMAND =
  /\b(curl|wget|sudo|chmod|chown|rm\s+-|pip3?|npm|pnpm|yarn|npx|bunx?|uvx?|deno|node\s+-|python3?|perl|ruby|php|bash|zsh|sh\s|git\s+(clone|push|reset)|make\s+(install|build|all|clean|test|-)|cargo|go\s+run|docker|kubectl|brew|apt(-get)?|osascript|powershell|eval|exec\(|base64|nc\s|ssh|scp)\b|\|\s*(ba|z)?sh\b/i;

export interface Classification {
  risk: Risk;
  reasons: string[];
}

/**
 * Safe means Claude may install the skill without asking: it only adds
 * instructions. A skill that ships code, asks for extra permissions, runs
 * shell at load time, or tells the model to run shell commands goes to review.
 */
export function classify(skillMd: string, files: readonly SkillFile[], texts: Readonly<Record<string, string>> = {}): Classification {
  const reasons: string[] = [];
  const { fields, body, malformed } = parseFrontmatter(skillMd);
  if (malformed) reasons.push('frontmatter uses YAML this checker cannot read');

  const extraKeys = Object.keys(fields).filter((key) => !DESCRIPTIVE_KEYS.has(key));
  if (extraKeys.length) reasons.push(`frontmatter sets ${extraKeys.join(', ')}`);

  const code = files.filter((file) => {
    const base = file.path.split('/').pop() ?? file.path;
    return !TEXT_EXTENSIONS.test(file.path) && !LICENSE_FILE.test(base);
  });
  if (code.length) reasons.push(`ships ${code.length} non-text file${code.length === 1 ? '' : 's'} (${code.slice(0, 3).map((f) => f.path).join(', ')}${code.length > 3 ? ', …' : ''})`);

  for (const [path, text] of Object.entries(texts)) {
    if (LICENSE_FILE.test(path.split('/').pop() ?? path)) continue;
    const other = parseFrontmatter(text);
    if (Object.keys(other.fields).length || other.malformed) reasons.push(`${path} has frontmatter`);
  }

  // A LICENSE says "execute" and "make" in legal prose; it is never read as instructions.
  const instructions = Object.entries(texts).filter(([path]) => !LICENSE_FILE.test(path.split('/').pop() ?? path));
  const documents = { 'SKILL.md': body, ...Object.fromEntries(instructions) };
  for (const [path, text] of Object.entries(documents)) {
    if (DYNAMIC_CONTEXT.test(text)) reasons.push(`${path} runs shell on load (!\`…\`)`);
    else if (FENCE.test(text)) reasons.push(`${path} has code blocks`);
    else if (COMMAND.test(text)) reasons.push(`${path} names shell or network commands`);
    else if (RUN_PHRASE.test(text)) reasons.push(`${path} tells the model to run something`);
  }

  return { risk: reasons.length ? 'review' : 'safe', reasons };
}
