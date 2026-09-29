import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildIndex } from '../src/catalog.ts';
import type { Catalog } from '../src/types.ts';
import { type BenchCase, checkMetrics, run, score } from '../scripts/bench-hook.ts';
import { skill } from './fixtures.ts';

const catalog: Catalog = {
  version: 1,
  generatedAt: new Date().toISOString(),
  skills: [
    skill('pdf', 'Extract text and tables from PDF documents, fill PDF forms, merge and split PDFs.'),
    skill('xlsx', 'Create and edit Excel spreadsheets with formulas, charts and pivot tables.'),
    ...Array.from({ length: 300 }, (_, i) => skill(`filler-${i}`, `Generic helper number ${i} for everyday tasks and review.`)),
  ],
};
const index = buildIndex(catalog);
const PDF_PROMPT = 'extract the tables from this PDF document and fill the PDF form fields';
const SILENT_PROMPT = 'what time is it in Tokyo right now';

const check = (cases: BenchCase[], minF1?: number) => checkMetrics(score(run(index, cases, {})), minF1);

test('the check passes when the hook fires on the right skill and stays silent otherwise', () => {
  assert.deepEqual(check([{ prompt: PDF_PROMPT, expect: ['pdf'] }, { prompt: SILENT_PROMPT, expect: [] }]), []);
});

test('the check fails when the hook fires on a prompt that should stay silent', () => {
  const failures = check([{ prompt: PDF_PROMPT, expect: ['pdf'] }, { prompt: PDF_PROMPT, expect: [] }]);
  assert.equal(failures.length, 1);
  assert.match(failures[0] ?? '', /silent fire rate 100\.0% is above 10\.0%/);
});

test('the check fails when F1 is below the floor', () => {
  const cases = [{ prompt: PDF_PROMPT, expect: ['xlsx'] }, { prompt: SILENT_PROMPT, expect: [] }];
  const failures = check(cases);
  assert.equal(failures.length, 1);
  assert.match(failures[0] ?? '', /F1 0\.000 is below the floor 0\.6/);
  assert.deepEqual(check(cases, 0), []);
});
