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

// v0.14-P1: resolve the suppression predicate at module load. Top-level
// await is supported by ESM; if the import fails (e.g. partial install),
// `_shouldSuppress` stays null and suppression is silently disabled —
// fail-open, never block legit fixes.
let _shouldSuppress = null;
try {
  const mod = await import('./fix-memory.mjs');
  if (mod && typeof mod.shouldSuppressFix === 'function') {
    _shouldSuppress = mod.shouldSuppressFix;
  }
} catch {
  _shouldSuppress = null;
}

// v0.14-P3: section read/write API — loaded once at module init for the
// regenerate-section applier. Same defensive pattern as the suppressor.
let _sectionsModule = null;
try {
  _sectionsModule = await import('./sections.mjs');
} catch {
  _sectionsModule = null;
}

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

/**
 * v0.14-P3 — regenerate-section: rewrite a `source=code` section's body
 * with the scanner's expected output. Emitted by the Generated-Staleness
 * validator (M-1) when on-disk content drifts from what the memory plan
 * would produce.
 *
 * Idempotent: if the section already matches `fix.body`, do nothing.
 * Bounded: only writes inside `<!-- docguard:section id=X source=code -->`
 * markers — never touches surrounding prose.
 *
 * fix shape: { type: 'regenerate-section', doc, sectionId, body }
 */
function applyRegenerateSection(projectDir, fix) {
  if (!fix.doc || !fix.sectionId || fix.body == null) {
    return { applied: false, skipped: 'regenerate-section needs doc, sectionId, body' };
  }
  const full = resolve(projectDir, fix.doc);
  if (!existsSync(full)) return { applied: false, skipped: `doc not found: ${fix.doc}` };
  const content = readFileSync(full, 'utf-8');
  // Lazy-import the section writer to avoid a top-level circular risk.
  // section APIs are synchronous and well-isolated; this works because
  // mechanical.mjs already uses top-level await for fix-memory.
  const { getSection, replaceSection } = _sectionsModule || {};
  if (typeof getSection !== 'function' || typeof replaceSection !== 'function') {
    return { applied: false, skipped: 'sections module unavailable' };
  }
  const existing = getSection(content, fix.sectionId);
  if (!existing) return { applied: false, skipped: `section ${fix.sectionId} not present in ${fix.doc}` };
  if (existing.body.trim() === String(fix.body).trim()) {
    return { applied: false, skipped: `${fix.doc} § ${fix.sectionId} already current` };
  }
  const next = replaceSection(content, fix.sectionId, fix.body).content;
  writeFileSync(full, next, 'utf-8');
  return { applied: true, detail: `${fix.doc}: regenerated § ${fix.sectionId}` };
}

/**
 * v0.14.1-S12+ — replace-anchor: rewrite a broken markdown anchor with a
 * high-confidence suggested slug. Emitted by Cross-Reference when its
 * fuzzy match is unambiguous (edit distance <= 2, no other close candidates).
 *
 * fix shape: { type: 'replace-anchor', doc, from, to, line?, summary? }
 *
 * Bounded: only rewrites occurrences of `](#${from})` and `](#X${from})`-like
 * forms — won't touch the broken slug if it happens to appear as plain text.
 * Idempotent: if no occurrence is found (already fixed), no-op.
 */
function applyReplaceAnchor(projectDir, fix) {
  if (!fix.doc || !fix.from || !fix.to) {
    return { applied: false, skipped: 'replace-anchor needs doc, from, to' };
  }
  const full = resolve(projectDir, fix.doc);
  if (!existsSync(full)) return { applied: false, skipped: `doc not found: ${fix.doc}` };
  const content = readFileSync(full, 'utf-8');

  // Match an anchor inside a markdown link: `](#from)` OR `](path#from)`.
  // Use a regex that captures the prefix and suffix so we only touch the
  // anchor part — leaving the link text and path intact.
  const fromEsc = esc(fix.from);
  const re = new RegExp(`(\\]\\([^)]*#)${fromEsc}([)\\s])`, 'g');
  const next = content.replace(re, `$1${fix.to}$2`);
  if (next === content) {
    return { applied: false, skipped: `${fix.doc}: anchor #${fix.from} not found (already fixed?)` };
  }
  writeFileSync(full, next, 'utf-8');
  return { applied: true, detail: `${fix.doc}: #${fix.from} → #${fix.to}` };
}

const APPLIERS = {
  'replace-count': applyReplaceCount,
  'replace-version': applyReplaceVersion,
  'insert-changelog-unreleased': applyInsertChangelogUnreleased,
  'remove-endpoint': applyRemoveEndpoint,
  'regenerate-section': applyRegenerateSection,
  'replace-anchor': applyReplaceAnchor,
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
 *
 * M-2: When `opts.recordHistory` is true (default true when not in dry-run),
 * each successfully applied fix is appended to `.docguard/fixed.json` so
 * the project has a persistent audit trail. Pass `recordHistory: false` to
 * disable (used by dry-run tests).
 *
 * @returns {{ applied: object[], skipped: object[] }}
 */
export function applyMechanicalFixes(projectDir, fixes, opts = {}) {
  const applied = [];
  const skipped = [];

  for (const fix of fixes) {
    // v0.14-P1: ping-pong suppression. If this same fingerprint has been
    // applied >= N times before (default 2) and --force-redo isn't set,
    // skip with a clear reason. Suppression is OFF when:
    //   - recordHistory === false (e.g. dry-run tests don't want this state)
    //   - forceRedo === true (user explicitly asked to re-apply)
    if (opts.recordHistory !== false && !opts.forceRedo && _shouldSuppress) {
      const decision = _shouldSuppress(projectDir, fix, {
        pingPongThreshold: opts.pingPongThreshold,
      });
      if (decision.suppressed) {
        skipped.push({ ...fix, reason: `suppressed: ${decision.reason}` });
        continue;
      }
    }
    const r = applyMechanicalFix(projectDir, fix, opts);
    if (r.applied) applied.push({ ...fix, detail: r.detail });
    else if (r.skipped) skipped.push({ ...fix, reason: r.skipped });
  }

  if (applied.length > 0 && opts.recordHistory !== false) {
    // Lazy-import to avoid the circular risk and keep mechanical.mjs's
    // synchronous-only contract clean for callers that don't want history.
    import('./fix-memory.mjs').then(({ appendFixes }) => {
      const entries = applied.map(f => ({
        type: f.type,
        file: f.file || f.path || '',
        summary: f.summary || f.detail || `${f.type} applied`,
      }));
      appendFixes(projectDir, entries, opts.appliedBy || 'fix --write');
    }).catch(() => {
      // Never let history-write break the fix flow — it's auxiliary.
    });
  }

  return { applied, skipped };
}
