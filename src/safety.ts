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
/** A license at the skill root. Anywhere else, or under another name, it is an ordinary file. */
const ROOT_LICENSE = /^(LICEN[CS]E|COPYING|NOTICE)(\.(md|txt))?$/i;

/** Files whose text is scanned: markdown and plain text, plus a root license even without an extension. */
export function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.test(path) || ROOT_LICENSE.test(path);
}

/** `!`cmd`` runs a shell command when the skill loads, before the model sees it. */
const DYNAMIC_CONTEXT = /!`[^`\n]+`/;
/** Any fenced or indented code block. Safe skills are prose; code in a block is usually meant to be run. */
const FENCE = /^\s*(```|~~~)/m;
const INDENTED_CODE = /(^|\n)[ \t]*\n( {4,}|\t)\S/;
/** Prose that tells the model to execute something, with or without a block. */
const RUN_PHRASE =
  /\b(bash tool|terminal|command line|shell|subprocess|(run|execute)\s+(it|this|that|these|them)\b|(run|execute)\s+(the|a|an)?\s*(following|command|script|code|snippet|helper|binary|program))\b/i;
const COMMAND =
  /\b(curl|wget|sudo|chmod|chown|rm\s+-|pip3?|npm|pnpm|yarn|npx|bunx?|uvx?|deno|node\s+-|python3?|perl|ruby|php|bash|zsh|sh\s|git\s+(clone|push|reset)|make\s+(install|build|all|clean|test|-)|cargo|go\s+run|docker|kubectl|brew|apt(-get)?|osascript|powershell|eval|exec\(|base64|nc\s|ssh|scp|launchctl|crontab|defaults\s+write|export\s+\w+=)\b|\becho\s+["'$]|\|\s*tee\b|\bsource\s+~?[./]|\|\s*(ba|z)?sh\b|\.(zsh|bash)(rc|_profile|env)\b|\.profile\b/i;
/** Prose that changes what Claude Code may do: its settings, permissions, hooks or config directory. */
const PERMISSIONS =
  /settings(\.local)?\.json|bypass-?permissions|dangerously|allowed-?tools|allowedTools|defaultMode|permissionMode|\bpermissions\s*[:.{"']|\.claude\/|~\/\.claude\b|CLAUDE_CONFIG_DIR/i;

/**
 * Other ways prose can make Claude act or persist: tools that reach outside
 * the conversation, files Claude Code or git execute later, instructions
 * loaded from a URL at run time, data smuggled into a URL, and encoded blobs.
 */
const REACH = [
  { pattern: /\bmcp__\w+|\bMCP\s+(server|tool)s?\b/i, reason: 'uses MCP tools' },
  { pattern: /\.git\/hooks|\bgit\s+hooks?\b|\bhusky\b|\bpre-commit\s+hook\b/i, reason: 'touches git hooks' },
  { pattern: /\b(CLAUDE|AGENTS)(\.local)?\.md\b|\bmemory\s+(file|tool|directory)\b/i, reason: 'writes to Claude memory or project instructions' },
  { pattern: /LaunchAgents|LaunchDaemons|\bsystemd\b|\bautostart\b|\bstartup\s+(folder|items?)\b|\/etc\//i, reason: 'touches startup or system locations' },
  { pattern: /\b(fetch|download|visit|open|read|load|retrieve|pull|follow)\b[^.\n]{0,80}https?:\/\//i, reason: 'points Claude at a remote URL for instructions or files' },
  { pattern: /https?:\/\/[^\s)>\]]*[?&][^\s)>\]]*(\{|\$\{|<[A-Za-z_]+>|%s)/, reason: 'builds a URL from data' },
  { pattern: /[A-Za-z0-9+/]{120,}={0,2}|\b[0-9a-f]{120,}\b/i, reason: 'contains an encoded blob' },
] as const;

/** Fullwidth letters and zero-width characters would slip past every pattern above. */
function fold(text: string): string {
  return text.normalize('NFKC').replace(/[\u200b-\u200f\u2060-\u2064\ufeff\u00ad]/g, '');
}

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

  const code = files.filter((file) => !isTextFile(file.path));
  if (code.length) reasons.push(`ships ${code.length} non-text file${code.length === 1 ? '' : 's'} (${code.slice(0, 3).map((f) => f.path).join(', ')}${code.length > 3 ? ', …' : ''})`);

  for (const [path, text] of Object.entries(texts)) {
    const other = parseFrontmatter(text);
    if (Object.keys(other.fields).length || other.malformed) reasons.push(`${path} has frontmatter`);
  }

  const documents = { 'SKILL.md': body, ...texts };
  for (const [path, raw] of Object.entries(documents)) {
    const text = fold(raw);
    if (DYNAMIC_CONTEXT.test(text)) reasons.push(`${path} runs shell on load (!\`…\`)`);
    else if (FENCE.test(text) || INDENTED_CODE.test(text)) reasons.push(`${path} has code blocks`);
    else if (COMMAND.test(text)) reasons.push(`${path} names shell or network commands`);
    else if (PERMISSIONS.test(text)) reasons.push(`${path} talks about Claude Code settings or permissions`);
    else if (REACH.some(({ pattern }) => pattern.test(text))) reasons.push(`${path} ${REACH.find(({ pattern }) => pattern.test(text))?.reason}`);
    // Legal prose says "execute"; only a root license is spared this one check.
    else if (!ROOT_LICENSE.test(path) && RUN_PHRASE.test(text)) reasons.push(`${path} tells the model to run something`);
  }

  return { risk: reasons.length ? 'review' : 'safe', reasons };
}
