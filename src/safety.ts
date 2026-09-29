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
  { pattern: /\b(fetch|download|visit|open|read|load|retrieve|pull|follow)\b[^\n]{0,80}?https?:\/\//i, reason: 'points Claude at a remote URL for instructions or files' },
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

  if (DYNAMIC_CONTEXT.test(fold(skillMd)) && !DYNAMIC_CONTEXT.test(fold(body))) reasons.push('frontmatter contains shell on load (!`…`)');
  // Every check is recorded, not just the first that fires: the tier is the same either way
  // (any reason means review), and the full list is what the catalog's statistics count.
  const documents = { 'SKILL.md': body, ...texts };
  for (const [path, raw] of Object.entries(documents)) {
    // Line-wrapped base64 (76 or 64 characters a line) is joined so the blob check sees it whole.
    const text = fold(raw).replace(/([A-Za-z0-9+/=]{40,})\r?\n(?=[A-Za-z0-9+/=]{20,})/g, '$1');
    if (DYNAMIC_CONTEXT.test(text)) reasons.push(`${path} runs shell on load (!\`…\`)`);
    // License texts indent whole paragraphs; for a root license only a real fence counts as code.
    if (FENCE.test(text) || (!ROOT_LICENSE.test(path) && INDENTED_CODE.test(text))) reasons.push(`${path} has code blocks`);
    if (COMMAND.test(text)) reasons.push(`${path} names shell or network commands`);
    if (PERMISSIONS.test(text)) reasons.push(`${path} talks about Claude Code settings or permissions`);
    for (const { pattern, reason } of REACH) if (pattern.test(text)) reasons.push(`${path} ${reason}`);
    // Legal prose says "execute"; only a root license is spared this one check.
    if (!ROOT_LICENSE.test(path) && RUN_PHRASE.test(text)) reasons.push(`${path} tells the model to run something`);
  }

  return { risk: reasons.length ? 'review' : 'safe', reasons };
}

/**
 * Hosts nobody installs software from on purpose: raw IPs, plain http, paste
 * sites, tunnels and link shorteners. A vendor installer from its own domain
 * piped to a shell is ordinary setup and counts as a capability, not a flag.
 */
const UNTRUSTED_HOST =
  /^(\d{1,3}(\.\d{1,3}){3}(:\d+)?|([\w-]+\.)*(pastebin\.com|hastebin\.com|paste\.ee|ghostbin\.\w+|transfer\.sh|0x0\.st|termbin\.com|ngrok(-free)?\.(io|app|dev)|trycloudflare\.com|serveo\.net|localtunnel\.me|loca\.lt|bit\.ly|tinyurl\.com|t\.co|is\.gd|rb\.gy|cutt\.ly)|[\w.-]+\.(tk|ml|ga|cf|gq|top|xyz|zip|mov))$/i;

const RED_FLAGS = [
  {
    rule: 'pipes a download from an untrusted host into a shell',
    pattern: /\b(curl|wget|iwr|irm|Invoke-WebRequest)\b[^\n|]*?(https?):\/\/([^\s/'"`)]+)[^\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/i,
    suspicious: (m: RegExpMatchArray) => m[2]?.toLowerCase() === 'http' || UNTRUSTED_HOST.test(m[3] ?? ''),
  },
  {
    rule: 'decodes a blob and runs it',
    pattern: /base64\s+(-d|--decode|-D)[^\n]*\|\s*(sudo\s+)?(ba|z)?sh\b|\b(eval|exec)\s*\(\s*(atob|base64\.b64decode|Buffer\.from)\b/i,
  },
  {
    rule: 'overrides or hides instructions',
    pattern:
      /\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(previous|prior|above|earlier|system|your)\s+(instructions|rules|prompts?|guidelines)|\b(do\s+not|don't|never)\s+(tell|inform|mention|reveal|show|disclose)[^.\n]{0,40}\b(the\s+)?(user|human|operator)\b|\bwithout\s+(telling|asking|informing|notifying)\s+the\s+user\b|\bhide\s+(this|these|it|them|the\s+\w+)\s+from\s+the\s+user\b|\bsilently\s+(run|execute|send|upload|delete|install|exfiltrate)\b/i,
  },
  {
    rule: 'sends the whole environment or credential files to a URL',
    pattern:
      /\b(curl|wget|fetch|requests\.(post|put)|axios\.post|http\.(post|request)|urlopen)\b[^\n]{0,200}(~\/\.ssh|\.aws\/credentials|\.netrc|id_rsa|id_ed25519|data\s*=\s*os\.environ\b|json\s*=\s*dict\(os\.environ\)|JSON\.stringify\(process\.env\)|\$\(env\)|\$\(printenv\))/i,
  },
  {
    rule: 'reads private keys or credential files',
    pattern: /\b(cat|read|open|less|head|type|Get-Content)\b[^\n]{0,40}(~\/\.ssh\/(id_|.*key)|\.aws\/credentials|\.netrc|\.config\/gh\/hosts\.yml|Keychains|\.docker\/config\.json)/i,
  },
  {
    rule: 'fetches remote instructions and follows them',
    pattern:
      /\b(fetch|download|curl|wget|read|load|retrieve|get)\b[^\n]{0,80}https?:\/\/[^\n]{0,120}\b(and|then)\s+(follow|execute|run|obey|apply|do\s+what)\b/i,
  },
] as const;

export interface RedFlag {
  rule: string;
  path: string;
  line: number;
  snippet: string;
}

/**
 * Patterns that are not capabilities but warning signs, with the evidence a
 * person needs to verify each by hand: file, line and the line itself. Scans
 * every text it is given, scripts included.
 */
export function redFlags(files: Readonly<Record<string, string>>): RedFlag[] {
  const flags: RedFlag[] = [];
  for (const [path, raw] of Object.entries(files)) {
    fold(raw)
      .split('\n')
      .forEach((text, index) => {
        for (const check of RED_FLAGS) {
          const match = text.match(check.pattern);
          if (!match) continue;
          if ('suspicious' in check && !check.suspicious(match)) continue;
          flags.push({ rule: check.rule, path, line: index + 1, snippet: text.trim().slice(0, 160) });
        }
      });
  }
  return flags;
}

/** Frontmatter keys that make Claude Code run or permit something the moment a skill loads. */
const LOAD_TIME_KEYS = ['allowed-tools', 'hooks', 'shell', 'agent', 'context', 'background'];

/**
 * Why a skill must not even be loaded for a measurement: loading it could
 * pre-approve tools, register hooks or run shell, whatever tools the eval grants.
 */
export function loadTimeRisks(skillMd: string): string[] {
  const { fields, body, malformed } = parseFrontmatter(skillMd);
  const risks = Object.keys(fields).filter((key) => LOAD_TIME_KEYS.includes(key)).map((key) => `frontmatter sets ${key}`);
  if (malformed) risks.push('frontmatter uses YAML this checker cannot read');
  // The whole file, not just the body: parsers disagree on where frontmatter ends.
  if (DYNAMIC_CONTEXT.test(fold(skillMd))) risks.push('runs shell on load (!`…`)');
  return risks;
}
