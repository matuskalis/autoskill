import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, test } from 'node:test';
import { writeCatalog } from '../src/catalog.ts';
import { checkHookLatency } from '../src/doctor.ts';
import { runHook } from '../src/hook.ts';
import { skill } from './fixtures.ts';

const PDF_PROMPT = 'extract the tables from this PDF document and fill the PDF form fields';
const XLSX_PROMPT = 'create an xlsx spreadsheet with formulas, charts and pivot tables';

const tempDir = (label: string) => mkdtempSync(join(tmpdir(), `autoskill-hook-${label}-`));

beforeEach(() => {
  process.env.CLAUDE_CONFIG_DIR = tempDir('home');
  process.env.AUTOSKILL_HOME = tempDir('state');
  delete process.env.AUTOSKILL_DISABLE;
  // A copy dated 2999 beats the bundled one, and a fresh index.json means the hook starts no background download.
  writeCatalog(
    {
      version: 1,
      generatedAt: '2999-01-01T00:00:00.000Z',
      skills: [
        skill('pdf', 'Extract text and tables from PDF documents, fill PDF forms, merge and split PDFs.'),
        skill('xlsx', 'Create and edit Excel spreadsheets with formulas, charts and pivot tables.'),
        ...Array.from({ length: 300 }, (_, i) => skill(`filler-${i}`, `Generic helper number ${i} for everyday tasks and review.`)),
      ],
    },
    process.env.AUTOSKILL_HOME,
  );
});

const note = (output: string | null): string => {
  assert.ok(output, 'the hook stayed silent');
  const { hookSpecificOutput } = JSON.parse(output) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
  assert.equal(hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  return hookSpecificOutput.additionalContext;
};

const addSkillFolder = (root: string, name: string) => {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: Something.\n---\nBody.\n`);
};

test('the hook answers a clear fit with one note and stays silent otherwise', () => {
  assert.match(note(runHook({ prompt: PDF_PROMPT })), /acme\/skills:skills\/pdf \(pdf, safe, quality 80\/100\)/);
  assert.equal(runHook({ prompt: 'what time is it in Tokyo right now' }), null);
  assert.equal(runHook({}), null);
});

test('a skill is suggested once per session, and again in another session', () => {
  assert.ok(runHook({ prompt: PDF_PROMPT, session_id: 'one' }));
  assert.equal(runHook({ prompt: PDF_PROMPT, session_id: 'one' }), null);
  assert.ok(runHook({ prompt: PDF_PROMPT, session_id: 'two' }));
  // A different skill in the same session is still welcome.
  assert.match(note(runHook({ prompt: XLSX_PROMPT, session_id: 'one' })), /skills\/xlsx/);
});

test('a skill the user already has is never suggested, wherever Claude Code finds it', () => {
  const places: [string, (home: string, project: string) => void][] = [
    ['user skills', (home) => addSkillFolder(join(home, 'skills'), 'pdf')],
    ['project skills', (_, project) => addSkillFolder(join(project, '.claude', 'skills'), 'pdf')],
    ['a plugin that ships it', (home) => addSkillFolder(join(home, 'plugins', 'cache', 'market', 'docs-kit', '1.0.0', 'skills'), 'pdf')],
    ['a plugin named like it', (home) => mkdirSync(join(home, 'plugins', 'cache', 'market', 'pdf'), { recursive: true })],
  ];
  for (const [where, install] of places) {
    const home = tempDir('home');
    const project = tempDir('project');
    process.env.CLAUDE_CONFIG_DIR = home;
    assert.ok(runHook({ prompt: PDF_PROMPT, cwd: project }), `silent before installing (${where})`);
    install(home, project);
    assert.equal(runHook({ prompt: PDF_PROMPT, cwd: project }), null, `suggested although the user has it (${where})`);
  }
});

test('AUTOSKILL_DISABLE keeps the hook out of autoskill\'s own headless runs', () => {
  process.env.AUTOSKILL_DISABLE = '1';
  try {
    assert.equal(runHook({ prompt: PDF_PROMPT }), null);
  } finally {
    delete process.env.AUTOSKILL_DISABLE;
  }
});

test('autoskill doctor times the hook without starting the daily catalog download', () => {
  // A state dir with no index.json looks stale, so a real hook run would start the refresh and leave this stamp.
  const bare = tempDir('bare');
  process.env.AUTOSKILL_HOME = bare;
  assert.match(checkHookLatency().detail, /s on a fixed prompt/);
  assert.equal(existsSync(join(bare, 'last-update-attempt')), false);
});
