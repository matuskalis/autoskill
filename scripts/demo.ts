/**
 * Records the README demo: real autoskill commands against a throwaway HOME, so nothing
 * touches ~/.claude or ~/.autoskill. The output is verbatim except that long lines are
 * wrapped at word boundaries to fit the page, and the throwaway home is shown as ~.
 *
 *   node scripts/demo.ts
 *
 * Writes docs/demo/session.txt and docs/demo/session.svg (the commands and what they print)
 * and docs/demo/hook.txt (the note the UserPromptSubmit hook hands Claude for the same task).
 * One step, the install, downloads two small files from GitHub without a token; the rest is local.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACKAGE_ROOT } from '../src/paths.ts';

const COLUMNS = 110;
/** The hook note is pasted into a README code block inside a list, which is narrower than the image. */
const NOTE_COLUMNS = 88;
const TASK = 'draft internal comms for the new office policy: a company newsletter and an FAQ';
const STEPS: string[][] = [
  ['search', TASK, '--limit', '1'],
  ['add', 'anthropics/skills:skills/internal-comms'],
  ['add', 'anthropics/skills:skills/xlsx'],
  ['list'],
];

const home = realpathSync(mkdtempSync(join(tmpdir(), 'autoskill-demo-')));
const env = { PATH: process.env.PATH ?? '', HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), AUTOSKILL_HOME: join(home, '.autoskill'), LANG: 'en_US.UTF-8' };
const quote = (arg: string) => (/[\s"']/.test(arg) ? `"${arg}"` : arg);

/** Breaks at spaces, indenting continuation rows under the text; a word longer than a row is cut. */
function wrap(line: string, columns = COLUMNS): string[] {
  const hanging = ' '.repeat(/^\s*(- )?/.exec(line)?.[0].length ?? 0);
  const rows: string[] = [];
  let rest = line;
  while (rest.length > columns) {
    const space = rest.lastIndexOf(' ', columns);
    const at = space > hanging.length ? space : columns;
    rows.push(rest.slice(0, at));
    rest = hanging + rest.slice(at).trimStart();
  }
  rows.push(rest);
  return rows;
}

const run = (args: string[], input?: string) => spawnSync(process.execPath, [join(PACKAGE_ROOT, 'bin', 'autoskill'), ...args], { encoding: 'utf8', env, input });

// A fresh state dir would start the daily background download; a stamp from now says it already ran.
mkdirSync(env.AUTOSKILL_HOME, { recursive: true });
writeFileSync(join(env.AUTOSKILL_HOME, 'last-update-attempt'), new Date().toISOString());

// The hook runs first: once the skill is installed it would (rightly) stop suggesting it.
const hook = run(['hook'], JSON.stringify({ prompt: TASK, session_id: 'demo', cwd: home }));
const note = (JSON.parse(hook.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext;

const lines: { text: string; command: boolean }[] = [];
for (const step of STEPS) {
  if (lines.length) lines.push({ text: '', command: false });
  lines.push({ text: `$ autoskill ${step.map(quote).join(' ')}`, command: true });
  const result = run(step);
  for (const line of `${result.stdout}${result.stderr}`.replaceAll(home, '~').trimEnd().split('\n')) {
    for (const row of wrap(line)) lines.push({ text: row, command: false });
  }
}
rmSync(home, { recursive: true, force: true });

const CHAR_WIDTH = 7.8;
const LINE_HEIGHT = 20;
const PADDING = 24;
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const width = Math.ceil(COLUMNS * CHAR_WIDTH + PADDING * 2);
const height = lines.length * LINE_HEIGHT + PADDING * 2;
const rows = lines
  .map(({ text, command }, index) =>
    text
      ? `<text x="${PADDING}" y="${PADDING + 14 + index * LINE_HEIGHT}" textLength="${(text.length * CHAR_WIDTH).toFixed(1)}" lengthAdjust="spacing"${command ? ' class="cmd"' : ''}>${escape(text)}</text>`
      : '',
  )
  .filter(Boolean)
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t d" xml:space="preserve">
<title id="t">autoskill in a terminal: search, a safe install, a refused install, list</title>
<desc id="d">Real output of scripts/demo.ts. The full text is in docs/demo/session.txt.</desc>
<style>
text { font: 13px ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; fill: #c9d1d9; white-space: pre; }
.cmd { fill: #ffffff; font-weight: 700; }
</style>
<rect width="${width}" height="${height}" rx="6" fill="#0d1117"/>
${rows}
</svg>
`;

mkdirSync(join(PACKAGE_ROOT, 'docs', 'demo'), { recursive: true });
writeFileSync(join(PACKAGE_ROOT, 'docs', 'demo', 'session.txt'), lines.map((line) => line.text).join('\n') + '\n');
writeFileSync(join(PACKAGE_ROOT, 'docs', 'demo', 'session.svg'), svg);
writeFileSync(join(PACKAGE_ROOT, 'docs', 'demo', 'hook.txt'), note.split('\n').flatMap((line) => wrap(line, NOTE_COLUMNS)).join('\n') + '\n');
console.log(`wrote docs/demo/session.txt, session.svg (${lines.length} lines, ${width}x${height}) and hook.txt`);
