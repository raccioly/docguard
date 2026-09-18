/**
 * Regenerate this repository's checked-in llms.txt / llms-full.txt bundles.
 *
 * WHY THIS EXISTS AND NOT `docguard init --with llms`:
 *   The CLI path is the right one for *adopters* — it prints the init banner,
 *   and it writes through safeWrite(), which leaves a `.bak` sibling behind.
 *   For a repeatable maintenance script (and for the drift test that has to
 *   compare against what the generator would emit right now) we want the
 *   content, not the ceremony. Same generator functions either way, so the two
 *   paths cannot diverge.
 *
 * Usage:
 *   npm run llms          — rewrite both bundles in place
 *   node tools/generate-llms.mjs --check   — exit 1 if either is out of date
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadConfig } from '../cli/config.mjs';
import { generateLlmsTxt, generateLlmsFullTxt } from '../cli/commands/llms.mjs';

/** The bundles this repo publishes, keyed by their path relative to the root. */
export const LLMS_BUNDLES = ['llms.txt', 'llms-full.txt'];

/**
 * Render both bundles for `projectDir` without touching the filesystem.
 * @returns {Record<string, string>} bundle path → content
 */
export function renderLlmsBundles(projectDir) {
  const config = loadConfig(projectDir);
  return {
    'llms.txt': generateLlmsTxt(projectDir, config),
    'llms-full.txt': generateLlmsFullTxt(projectDir, config),
  };
}

function main(argv) {
  const projectDir = process.cwd();
  const rendered = renderLlmsBundles(projectDir);
  const check = argv.includes('--check');
  const stale = [];

  for (const name of LLMS_BUNDLES) {
    const path = resolve(projectDir, name);
    let current = null;
    try { current = readFileSync(path, 'utf-8'); } catch { /* missing counts as stale */ }
    if (current === rendered[name]) continue;
    stale.push(name);
    if (!check) writeFileSync(path, rendered[name], 'utf-8');
  }

  if (check) {
    if (stale.length === 0) {
      console.log('llms bundles are current.');
      return 0;
    }
    console.error(`Out of date: ${stale.join(', ')} — run \`npm run llms\`.`);
    return 1;
  }

  console.log(stale.length === 0
    ? 'llms bundles already current — nothing written.'
    : `Regenerated: ${stale.join(', ')}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
