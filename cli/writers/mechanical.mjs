/**
 * Mechanical Fix Registry — applies deterministic, no-LLM fixes in place.
 *
 * Validators surface structured `fixes[]` actions; this module knows how to
 * apply each TYPE safely and idempotently. These are surgical token/structure
 * edits the validator already located precisely — never prose rewrites.
 *
 * Fix types:
 *   - replace-count   : stale "N validators/checks" → actual count (Metrics-Consistency)
 *   - replace-version : stale version ref → current version (Metadata-Sync)
 *   - insert-changelog-unreleased : add a `## [Unreleased]` header (Changelog)
 *   - remove-endpoint : delete a documented-but-absent endpoint (API-Surface; delegated)
 *
 * Pure file edits, no LLM. Zero NPM dependencies.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { removeEndpoints, hasGeneratedMarker } from './api-reference.mjs';

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** replace-count: "<found> <label>" → "<actual> <label>" in the file. */
function applyReplaceCount(projectDir, fix) {
  const full = resolve(projectDir, fix.file);
  if (!existsSync(full)) return { applied: false };
  const content = readFileSync(full, 'utf-8');
  const re = new RegExp(`\\b${esc(fix.found)}(\\s+(?:automated\\s+)?${esc(fix.label)}\\b)`, 'g');
  const next = content.replace(re, `${fix.actual}$1`);
  if (next === content) return { applied: false };
  writeFileSync(full, next, 'utf-8');
  return { applied: true, detail: `${fix.file}: "${fix.found} ${fix.label}" → "${fix.actual} ${fix.label}"` };
}

/** replace-version: stale version → current, ONLY in actionable contexts. */
function applyReplaceVersion(projectDir, fix) {
  const full = resolve(projectDir, fix.file);
  if (!existsSync(full)) return { applied: false };
  const content = readFileSync(full, 'utf-8');
  const f = esc(fix.found);
  // Mirror metadata-sync's actionable detection so we never touch prose.
  const patterns = [
    new RegExp(`((?:archive|tags|releases|download)\\/v?)${f}`, 'g'),
    new RegExp(`(@)${f}`, 'g'),
    new RegExp(`(version:\\s*["']?)${f}`, 'g'),
  ];
  let next = content;
  for (const re of patterns) next = next.replace(re, `$1${fix.actual}`);
  if (next === content) return { applied: false };
  writeFileSync(full, next, 'utf-8');
  return { applied: true, detail: `${fix.file}: v${fix.found} → v${fix.actual}` };
}

/** insert-changelog-unreleased: add `## [Unreleased]` after the title/intro. */
function applyInsertChangelogUnreleased(projectDir, fix) {
  const full = resolve(projectDir, fix.file);
  if (!existsSync(full)) return { applied: false };
  const content = readFileSync(full, 'utf-8');
  if (/\[unreleased\]/i.test(content)) return { applied: false }; // idempotent
  const lines = content.split('\n');
  // Insert before the first version heading `## [x.y.z]`, else after the H1, else top.
  let idx = lines.findIndex(l => /^##\s*\[\d/.test(l));
  if (idx < 0) {
    const h1 = lines.findIndex(l => /^#\s/.test(l));
    idx = h1 >= 0 ? h1 + 1 : 0;
  }
  const block = idx > 0 && lines[idx - 1].trim() !== '' ? ['', '## [Unreleased]', ''] : ['## [Unreleased]', ''];
  lines.splice(idx, 0, ...block);
  writeFileSync(full, lines.join('\n'), 'utf-8');
  return { applied: true, detail: `${fix.file}: added ## [Unreleased]` };
}

/** remove-endpoint: delegate to the API-REFERENCE writer (marker-gated). */
function applyRemoveEndpoint(projectDir, fix, { force = false } = {}) {
  const full = resolve(projectDir, fix.doc || 'docs-canonical/API-REFERENCE.md');
  if (!existsSync(full)) return { applied: false };
  const content = readFileSync(full, 'utf-8');
  if (!hasGeneratedMarker(content) && !force) {
    return { applied: false, skipped: `${fix.doc} not docguard:generated (use --force)` };
  }
  const { content: next, removed } = removeEndpoints(content, [{ method: fix.method, path: fix.path }]);
  if (removed.length === 0 || next === content) return { applied: false };
  writeFileSync(full, next, 'utf-8');
  return { applied: true, detail: `${fix.doc}: removed ${fix.method} ${fix.path}` };
}

const APPLIERS = {
  'replace-count': applyReplaceCount,
  'replace-version': applyReplaceVersion,
  'insert-changelog-unreleased': applyInsertChangelogUnreleased,
  'remove-endpoint': applyRemoveEndpoint,
};

export const MECHANICAL_FIX_TYPES = Object.keys(APPLIERS);

/** Apply a single structured fix. Returns { applied, detail?, skipped? }. */
export function applyMechanicalFix(projectDir, fix, opts = {}) {
  const fn = APPLIERS[fix.type];
  if (!fn) return { applied: false, skipped: `unknown fix type: ${fix.type}` };
  return fn(projectDir, fix, opts);
}

/**
 * Apply a batch of fixes; returns a summary.
 * @returns {{ applied: object[], skipped: object[] }}
 */
export function applyMechanicalFixes(projectDir, fixes, opts = {}) {
  const applied = [];
  const skipped = [];
  for (const fix of fixes) {
    const r = applyMechanicalFix(projectDir, fix, opts);
    if (r.applied) applied.push({ ...fix, detail: r.detail });
    else if (r.skipped) skipped.push({ ...fix, reason: r.skipped });
  }
  return { applied, skipped };
}
