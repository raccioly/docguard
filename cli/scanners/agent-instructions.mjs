/**
 * Agent instruction chains — what an agent actually loads.
 *
 * Codex concatenates AGENTS.md files from the repository root down to the
 * working directory (AGENTS.override.md replaces AGENTS.md in its directory)
 * and stops at `project_doc_max_bytes`, 32 KiB by default. Text past the limit
 * is dropped silently, and the nested, most specific files come last. This
 * scanner measures every chain so the Structure validator can compare it with
 * a budget.
 *
 * @implements docguard.agent-instruction-budget#FR-001
 */

import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { walkFiles, relPosix, buildIgnoreFilter, loadDocguardIgnore } from '../shared-ignore.mjs';

export const DEFAULT_INSTRUCTION_BUDGET = 32768;
const NAMES = ['AGENTS.override.md', 'AGENTS.md'];

/** The instruction file an agent loads from one directory, or null. */
function fileForDir(absDir) {
  for (const name of NAMES) {
    const full = join(absDir, name);
    if (existsSync(full)) return full;
  }
  return null;
}

/**
 * @returns {{ leaf: string, files: string[], bytes: number }[]} one entry per
 *   directory that holds an instruction file, sorted by leaf path.
 */
export function measureInstructionChains(projectDir) {
  const root = resolve(projectDir);
  // buildIgnoreFilter, not shared.mjs loadIgnorePatterns: the latter drops
  // gitignore-style `dir/` patterns (tracked on #455).
  const isIgnored = buildIgnoreFilter(loadDocguardIgnore(projectDir));
  const dirs = new Set();
  if (fileForDir(root)) dirs.add(root);
  walkFiles(root, (full) => {
    if (!NAMES.includes(basename(full))) return;
    const rel = relPosix(projectDir, full);
    if (isIgnored(rel)) return;
    dirs.add(dirname(full));
  });

  const chains = [];
  for (const dir of dirs) {
    const files = [];
    let bytes = 0;
    // Root first, then each ancestor directory down to `dir`.
    const segments = relPosix(projectDir, dir).split('/').filter(s => s && s !== '.');
    const stops = [root];
    for (let i = 0; i < segments.length; i++) stops.push(join(root, ...segments.slice(0, i + 1)));
    for (const stop of stops) {
      const file = fileForDir(stop);
      if (!file) continue;
      files.push(relPosix(projectDir, file));
      try { bytes += statSync(file).size; } catch { /* unreadable: count nothing */ }
    }
    chains.push({ leaf: files[files.length - 1], files, bytes });
  }
  return chains.sort((a, b) => a.leaf.localeCompare(b.leaf));
}
