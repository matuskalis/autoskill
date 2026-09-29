import type { Frontmatter } from './types.ts';

const KEY_LINE = /^([A-Za-z_][\w-]*):\s*(.*)$/;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^(['"]).*\1$/s.test(trimmed)) {
    const inner = trimmed.slice(1, -1);
    return trimmed.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, ' ') : inner.replace(/''/g, "'");
  }
  return trimmed;
}

/**
 * Reads the YAML frontmatter Claude Code reads: only when `---` is the first
 * line. Enough YAML for skill files: scalars, quoted strings, `>` and `|`
 * block scalars. Nested maps and lists are kept as raw text, since only their
 * key matters to the safety check.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') return { fields: {}, body: normalized, malformed: false };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end === -1) return { fields: {}, body: normalized, malformed: false };

  const fields: Record<string, string> = Object.create(null) as Record<string, string>;
  // Claude Code closes frontmatter at the first `---` anywhere, even mid-line; a line that contains one
  // means Claude Code and this parser disagree on where the body starts.
  let malformed = lines.slice(1, end).some((line) => line.includes('---'));
  let key: string | null = null;
  let block: '>' | '|' | null = null;
  let parts: string[] = [];
  const flush = () => {
    if (key === null) return;
    const joined = block === '|' ? parts.join('\n') : parts.join(' ');
    fields[key] = unquote(joined.trim());
  };

  for (const line of lines.slice(1, end)) {
    const match = /^\s/.test(line) ? null : KEY_LINE.exec(line);
    if (match) {
      flush();
      key = match[1] ?? null;
      const value = match[2] ?? '';
      block = /^[>|][+-]?$/.test(value.trim()) ? (value.trim()[0] as '>' | '|') : null;
      parts = block ? [] : [value];
    } else if (key !== null && /^\s/.test(line) && line.trim()) {
      parts.push(line.trim());
    } else if (line.trim() && !line.trim().startsWith('#')) {
      // A quoted key, a flow map or an indented root: real YAML may read keys here that this parser cannot see.
      malformed = true;
    }
  }
  flush();
  return { fields, body: lines.slice(end + 1).join('\n'), malformed };
}
