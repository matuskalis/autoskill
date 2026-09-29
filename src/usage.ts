import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { claudeDir } from './paths.ts';

export interface Usage {
  count: number;
  last: string;
}

const COMMAND = /<command-name>\/([\w:.-]+)<\/command-name>/g;
const SKILL_MD = /\/skills\/([\w.-]+)\/SKILL\.md$/;
const SKILL_MD_IN_COMMAND = /\/skills\/([\w.-]+)\/SKILL\.md\b/g;

/** `plugin:name` and `dir:name` both count toward `name`. */
const bare = (skill: string) => skill.split(':').pop() ?? skill;

function record(usage: Map<string, Usage>, name: string, at: string) {
  const entry = usage.get(name) ?? { count: 0, last: '' };
  entry.count += 1;
  if (at > entry.last) entry.last = at;
  usage.set(name, entry);
}

export function transcripts(since: number): string[] {
  const root = join(claudeDir(), 'projects');
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.jsonl'))
    .map((path) => join(root, path))
    .filter((path) => statSync(path).mtimeMs >= since);
}

interface Line {
  timestamp?: string;
  message?: { content?: unknown };
}

/**
 * How often each skill was actually used, read from Claude Code's session
 * transcripts: a Skill tool call, a typed /command, or reading its SKILL.md
 * with Read or in a Bash command (how Claude loads a skill it just installed).
 */
export async function skillUsage(sinceDays = 365): Promise<Map<string, Usage>> {
  const usage = new Map<string, Usage>();
  for (const file of transcripts(Date.now() - sinceDays * 86_400_000)) {
    const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
    for await (const text of lines) {
      if (!text.includes('"Skill"') && !text.includes('<command-name>') && !text.includes('SKILL.md')) continue;
      let line: Line;
      try {
        line = JSON.parse(text) as Line;
      } catch {
        continue;
      }
      const at = line.timestamp ?? '';
      const content = line.message?.content;
      if (typeof content === 'string') {
        for (const match of content.matchAll(COMMAND)) record(usage, bare(match[1] ?? ''), at);
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const block of content as { type?: string; name?: string; text?: string; input?: Record<string, unknown> }[]) {
        if (block.type === 'text' && block.text) {
          for (const match of block.text.matchAll(COMMAND)) record(usage, bare(match[1] ?? ''), at);
        }
        if (block.type !== 'tool_use') continue;
        if (block.name === 'Skill' && typeof block.input?.skill === 'string') record(usage, bare(block.input.skill), at);
        if (block.name === 'Read' && typeof block.input?.file_path === 'string') {
          const match = SKILL_MD.exec(block.input.file_path);
          if (match?.[1]) record(usage, match[1], at);
        }
        // Claude often reads a fresh skill with `cat` instead of Read.
        if (block.name === 'Bash' && typeof block.input?.command === 'string') {
          for (const name of new Set([...block.input.command.matchAll(SKILL_MD_IN_COMMAND)].map((m) => m[1]))) if (name) record(usage, name, at);
        }
      }
    }
  }
  return usage;
}
