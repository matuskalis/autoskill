/**
 * Prints catalog/measured.json as a markdown table for docs/measured-uplift.md.
 *
 *   node scripts/measured-table.ts [path]
 */
import { readFileSync } from 'node:fs';
import type { Measurement } from '../src/eval.ts';

const path = process.argv[2] ?? 'catalog/measured.json';
const measured = Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, Measurement>).map(([key, m]) => ({ ...m, mode: key.split('#')[1] ?? 'text' }));
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;

console.log('| skill | tasks | without | with | delta | focused delta (checks) | fired | note |');
console.log('|---|---|---|---|---|---|---|---|');
for (const m of measured.sort((a, b) => b.delta - a.delta)) {
  const note = [m.partial && 'partial', m.ceiling && 'ceiling', m.firedRate < 0.5 && 'rarely loaded'].filter(Boolean).join(', ');
  const name = m.id.split(':').pop()?.split('/').pop() ?? m.id;
  console.log(
    `| [${name}](https://github.com/${m.id.split(':')[0]}/tree/${m.sha}/${m.id.split(':')[1] ?? ''}) | ${m.mode} | ${m.withoutScore.toFixed(2)} | ${m.withScore.toFixed(2)} | ${signed(m.delta)} | ${signed(m.focusedDelta)} (${m.discriminatingChecks}) | ${Math.round(m.firedRate * 100)}% | ${note} |`,
  );
}
