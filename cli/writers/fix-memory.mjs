/**
 * Fix Memory — M-2 / S-10
 *
 * Persists a JSON log of every mechanical fix `docguard fix --write` applies,
 * stored at `.docguard/fixed.json`. Two purposes:
 *
 *   1. **Audit trail.** Users (and reviewers) can ask "what did the bot
 *      change in this repo and when?" without digging through git history.
 *      Especially valuable for the K-1 auto-fix Action which commits as
 *      `docguard-bot` — the memory file is the human-readable record.
 *
 *   2. **Future suppression hook.** A future `fix --write` can check the
 *      memory and skip fixes that were applied and then reverted — avoiding
 *      ping-pong loops where the bot keeps re-applying a fix the user keeps
 *      undoing. For v0.13 we just record; suppression is v0.14+.
 *
 * Format (JSON, gitignore-friendly):
 *   {
 *     "schemaVersion": "1",
 *     "entries": [
 *       {
 *         "id": "<sha256 of type+file+before+after, first 12 chars>",
 *         "type": "replace-version",
 *         "file": "README.md",
 *         "summary": "v0.11.2 → v0.12.0",
 *         "appliedAt": "2026-05-26T01:35:00Z",
 *         "appliedBy": "fix --write" | "sync --write" | "docguard-bot"
 *       }
 *     ]
 *   }
 *
 * The file is intentionally small (no full before/after content) to stay
 * checkable into git for teams that want the audit trail under version
 * control. Capped at 500 entries (rolling).
 *
 * @req SC-M2-001 — loadFixMemory returns an empty array when no file exists
 * @req SC-M2-002 — appendFixes creates .docguard/ if needed
 * @req SC-M2-003 — appendFixes is idempotent (same fix logged twice → one entry)
 * @req SC-M2-004 — fingerprint dedupes by type+file+summary (not timestamp)
 * @req SC-M2-005 — entries are capped at MAX_ENTRIES (oldest dropped)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const MEMORY_PATH = '.docguard/fixed.json';
const SCHEMA_VERSION = '1';
const MAX_ENTRIES = 500;

/**
 * Compute a stable fingerprint for a fix. Used for dedup — two fixes with
 * the same type+file+summary are considered the same operation, even if
 * applied at different times.
 */
export function fingerprintFix(fix) {
  const key = `${fix.type || ''}|${fix.file || ''}|${fix.summary || ''}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

/**
 * Load the fix memory from disk. Returns { schemaVersion, entries } —
 * always a valid shape, even if the file is missing or malformed.
 */
export function loadFixMemory(projectDir) {
  const p = resolve(projectDir, MEMORY_PATH);
  if (!existsSync(p)) {
    return { schemaVersion: SCHEMA_VERSION, entries: [] };
  }
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8'));
    if (!data || !Array.isArray(data.entries)) {
      return { schemaVersion: SCHEMA_VERSION, entries: [] };
    }
    return { schemaVersion: data.schemaVersion || SCHEMA_VERSION, entries: data.entries };
  } catch {
    return { schemaVersion: SCHEMA_VERSION, entries: [] };
  }
}

/**
 * Append fixes to the memory file. Dedupes by fingerprint — re-applying the
 * same fix updates the existing entry's appliedAt instead of adding a row.
 *
 * `fixes` is an array of { type, file, summary } objects. The function adds
 * `id` + `appliedAt` + `appliedBy` automatically.
 *
 * Returns the updated memory object.
 */
export function appendFixes(projectDir, fixes, appliedBy = 'fix --write') {
  if (!Array.isArray(fixes) || fixes.length === 0) {
    return loadFixMemory(projectDir);
  }
  const mem = loadFixMemory(projectDir);
  const now = new Date().toISOString();
  const byId = new Map(mem.entries.map(e => [e.id, e]));

  for (const f of fixes) {
    const id = fingerprintFix(f);
    const entry = {
      id,
      type: f.type || 'unknown',
      file: f.file || '',
      summary: f.summary || '',
      appliedAt: now,
      appliedBy,
    };
    byId.set(id, entry); // overwrites prior with same fingerprint → updates appliedAt
  }

  let entries = Array.from(byId.values());
  // Sort newest-first so the cap drops the oldest.
  entries.sort((a, b) => (b.appliedAt || '').localeCompare(a.appliedAt || ''));
  if (entries.length > MAX_ENTRIES) entries = entries.slice(0, MAX_ENTRIES);

  const next = { schemaVersion: SCHEMA_VERSION, entries };

  const fullPath = resolve(projectDir, MEMORY_PATH);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');

  return next;
}

/**
 * True if a candidate fix (by fingerprint) has been applied before.
 * Currently informational — future versions may use this to suppress.
 */
export function isFixRecorded(projectDir, candidate) {
  const id = fingerprintFix(candidate);
  return loadFixMemory(projectDir).entries.some(e => e.id === id);
}
