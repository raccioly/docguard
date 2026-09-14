/**
 * Small, dependency-free multi-file transaction for lifecycle state.
 *
 * Every replacement is staged beside its destination before the first visible
 * mutation. Originals are retained in memory and restored if any replacement,
 * deletion, or post-commit validation fails. This gives callers an all-old or
 * all-new working tree for the small bounded JSON/Markdown files DocGuard owns.
 * @implements docguard.document-lifecycle#FR-013
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

function cleanup(paths) {
  for (const path of paths) {
    try { rmSync(path, { force: true }); } catch { /* best-effort cleanup */ }
  }
}

/**
 * Commit a bounded set of file replacements/deletions.
 *
 * `content: null` deletes a file. `validate` runs after all visible mutations;
 * throwing from it rolls the complete set back. The optional `afterMutation`
 * test seam is intentionally undocumented outside the module tests.
 */
export function commitFileTransaction(entries, { validate = null, afterMutation = null } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('File transaction requires at least one entry.');
  const targets = new Set();
  const tx = randomUUID();
  const prepared = [];
  try {
    for (const [index, entry] of entries.entries()) {
      if (!entry?.path || typeof entry.path !== 'string') throw new Error('Every file transaction entry needs a path.');
      if (targets.has(entry.path)) throw new Error(`File transaction repeats target: ${entry.path}`);
      targets.add(entry.path);
      const existed = existsSync(entry.path);
      const original = existed ? readFileSync(entry.path) : null;
      const staged = entry.content === null ? null : `${entry.path}.docguard-${tx}-${index}.tmp`;
      prepared.push({ ...entry, existed, original, staged });
      if (staged) {
        mkdirSync(dirname(entry.path), { recursive: true });
        writeFileSync(staged, entry.content, 'utf8');
      }
    }
  } catch (error) {
    cleanup(prepared.map(entry => entry.staged).filter(Boolean));
    throw new Error(`File transaction preparation failed: ${error.message}`);
  }

  const applied = [];
  try {
    for (const entry of prepared) {
      if (entry.content === null) {
        if (entry.existed) rmSync(entry.path);
      } else {
        // copyFileSync overwrites on every supported Node platform. renameSync
        // cannot replace an existing destination consistently on Windows.
        copyFileSync(entry.staged, entry.path);
      }
      applied.push(entry);
      if (afterMutation) afterMutation(entry, applied.length);
    }
    if (validate) validate();
  } catch (error) {
    for (const entry of [...applied].reverse()) {
      try {
        if (entry.existed) writeFileSync(entry.path, entry.original);
        else rmSync(entry.path, { force: true });
      } catch { /* report the initiating error; callers validate on next run */ }
    }
    cleanup(prepared.map(entry => entry.staged).filter(Boolean));
    throw new Error(`File transaction rolled back: ${error.message}`);
  }
  cleanup(prepared.map(entry => entry.staged).filter(Boolean));
}
