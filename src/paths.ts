import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const BUNDLED_CATALOG_DIR = join(PACKAGE_ROOT, 'catalog');
/** The `catalog` branch: rebuilt and force-pushed every day by the crawl workflow. */
export const CATALOG_BASE_URL = 'https://raw.githubusercontent.com/matuskalis/autoskill/catalog';

/** Where Claude Code keeps user config; CLAUDE_CONFIG_DIR moves it. */
export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

export function skillsDir(): string {
  return join(claudeDir(), 'skills');
}

/** autoskill's own state: the downloaded catalog and what was suggested per session. */
export function stateDir(): string {
  return process.env.AUTOSKILL_HOME || join(homedir(), '.autoskill');
}

export const MARKER = '.autoskill.json';
