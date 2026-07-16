/**
 * Score History — local-first trend memory at `.docguard/history.jsonl`.
 *
 * `docguard ci` appends one line per run ({timestamp, commit, score, grade,
 * errors, warnings, passed, total, status}); `docguard score --trend` reads
 * it back and renders the trajectory. JSONL because append is the hot path:
 * one O(1) write per CI run, and a truncated last line (crash mid-write)
 * corrupts one entry, not the file. The rare trim rewrite goes through a
 * temp-file + rename so a crash mid-trim can't truncate history; concurrent
 * appends during a trim window can still lose an entry — acceptable for a
 * trend log, not a ledger.
 *
 * Local-first by design: `.docguard/` is gitignored, so history accumulates
 * per checkout. In ephemeral CI, persist it across runs with a cache/artifact
 * step (see CI-RECIPES) — the file format is stable and merge-friendly.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const HISTORY_PATH = '.docguard/history.jsonl';

// Trim trigger: beyond this many entries the file is rewritten keeping the
// most recent MAX_ENTRIES. Generous — 1000 CI runs of ~150 bytes ≈ 150 KB.
const MAX_ENTRIES = 1000;

/**
 * Append one run entry. Silent no-op on failure (read-only checkouts, odd
 * CI filesystems) — recording history must never fail the pipeline it's
 * recording.
 */
export function appendHistory(projectDir, entry) {
  try {
    const p = resolve(projectDir, HISTORY_PATH);
    mkdirSync(dirname(p), { recursive: true });
    appendFileSync(p, JSON.stringify(entry) + '\n');
    // Occasional trim, checked cheaply by size (~200 KB ≫ MAX_ENTRIES rows).
    // Temp-file + rename: a crash mid-trim leaves the old file intact
    // instead of a truncated one (L2).
    if (statSync(p).size > 256 * 1024) {
      const rows = loadHistory(projectDir, MAX_ENTRIES);
      const tmp = p + '.tmp';
      writeFileSync(tmp, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
      renameSync(tmp, p);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the last `limit` valid entries, oldest → newest. Malformed lines
 * (partial writes, hand edits) are skipped, never thrown.
 */
export function loadHistory(projectDir, limit = 50) {
  try {
    const p = resolve(projectDir, HISTORY_PATH);
    if (!existsSync(p)) return [];
    const out = [];
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e && typeof e.score === 'number') out.push(e);
      } catch { /* skip malformed line */ }
    }
    return out.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Unicode sparkline over the score series (0–100 → ▁–█). Pure display.
 */
export function sparkline(scores) {
  const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  return scores
    .map(s => BARS[Math.min(BARS.length - 1, Math.max(0, Math.floor((s / 100) * BARS.length)))])
    .join('');
}
