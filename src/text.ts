/** Third-party text shown to the model: one line, no backticks, bounded. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\s]+/g, ' ').replace(/`/g, "'").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** The folder a skill installs into under ~/.claude/skills. */
export function installName(skill: { name: string; dir?: string; repo?: string }): string {
  const clean = (text: string) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 64);
  return clean(skill.name) || clean(skill.dir?.split('/').pop() ?? '') || clean(skill.repo?.split('/')[1] ?? '') || 'skill';
}
