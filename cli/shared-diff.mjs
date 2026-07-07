/**
 * Shared Unified-Diff Parser + Tokenizer — zero-dependency foundation for the
 * change-driven detectors added in v0.31.0.
 *
 * ONE parser, consumed by four features so they never re-implement diff
 * scraping (each previously would have grepped `git diff` output ad hoc):
 *   - diff-overlap suspicion (validators/diff-suspicion.mjs): does a doc's
 *     wording overlap tokens that were DELETED/REPLACED-OLD in the code diff?
 *   - reference-existence (validators/reference-existence.mjs): which symbols
 *     left the tree between two revisions.
 *   - impact blast-radius (commands/impact.mjs): which docs cite changed code.
 *   - structured-diff staging (commands/verify.mjs): hand agents an ordered
 *     replace/delete/add representation (the CARL-CCI "activity-labeled diff"
 *     shown to beat raw-text diffs — arXiv 2512.19883) instead of a raw patch.
 *
 * Pure Node built-ins. No git here — this operates on diff TEXT a caller
 * already produced (see shared-git.getDiffSpans). That keeps it unit-testable
 * without a repo and reusable on any unified-diff string.
 */

// ── Tokenizer ────────────────────────────────────────────────────────────────
// Identifier-aware: keeps `getUserById`, `user_id`, `UserService` whole, then
// also emits their sub-words so a doc saying "user id" still overlaps code
// token `user_id`. Deterministic, lowercase, stopword-filtered.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'of', 'to',
  'in', 'on', 'at', 'by', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'this',
  'that', 'these', 'those', 'it', 'its', 'with', 'from', 'not', 'no', 'we', 'you',
  'return', 'returns', 'const', 'let', 'var', 'function', 'class', 'import',
  'export', 'default', 'new', 'true', 'false', 'null', 'void', 'public', 'private',
]);

/**
 * Split identifiers into sub-words: getUserById → [get,user,by,id];
 * user_id → [user,id]; HTTPServer → [http,server].
 */
export function splitIdentifier(id) {
  return String(id)
    // camelCase / PascalCase / ACRONYMBoundary
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // snake_case, kebab-case, dot.paths
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Tokenize free text OR code into a lowercase word set. Keeps whole identifiers
 * AND their sub-words. `min` drops tokens shorter than it (default 3) to cut
 * noise; identifiers below `min` after splitting are still dropped.
 *
 * Returns an array (call-site decides Set vs list). Deduped, order-preserving.
 */
export function tokenize(text, { min = 3, keepStopwords = false } = {}) {
  const out = [];
  const seen = new Set();
  const raw = String(text).match(/[A-Za-z_][A-Za-z0-9_.-]*/g) || [];
  for (const word of raw) {
    // the whole identifier (lowercased) …
    const whole = word.toLowerCase();
    for (const t of [whole, ...splitIdentifier(word)]) {
      if (t.length < min) continue;
      if (!keepStopwords && STOPWORDS.has(t)) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

// ── Unified-diff parser ──────────────────────────────────────────────────────

/**
 * Parse a unified diff (git diff / diff -u) into structured file entries.
 * Handles multi-file diffs, adds/deletes (/dev/null), renames, and the
 * "\ No newline at end of file" marker.
 *
 * Returns: [{ oldPath, newPath, status, hunks: [{ oldStart, newStart,
 *   lines: [{ op: ' '|'-'|'+', text }] }] }]
 * status ∈ 'modified' | 'added' | 'deleted' | 'renamed'.
 */
export function parseUnifiedDiff(diffText) {
  const files = [];
  if (!diffText) return files;
  const lines = String(diffText).split('\n');
  let cur = null;
  let hunk = null;

  const pushHunkHeader = (m) => {
    hunk = { oldStart: parseInt(m[1], 10) || 0, newStart: parseInt(m[2], 10) || 0, lines: [] };
    cur.hunks.push(hunk);
  };

  for (const line of lines) {
    if (line.startsWith('diff --git')) {
      // a/<old> b/<new> — quotes possible but rare; keep it simple.
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      cur = { oldPath: m ? m[1] : null, newPath: m ? m[2] : null, status: 'modified', hunks: [] };
      files.push(cur);
      hunk = null;
      continue;
    }
    if (!cur) continue; // ignore any preamble before the first file
    if (line.startsWith('rename from ')) { cur.status = 'renamed'; cur.oldPath = line.slice(12); continue; }
    if (line.startsWith('rename to ')) { cur.status = 'renamed'; cur.newPath = line.slice(10); continue; }
    if (line.startsWith('--- ')) {
      const p = line.slice(4);
      if (p === '/dev/null') cur.status = 'added';
      else cur.oldPath = p.replace(/^a\//, '');
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4);
      if (p === '/dev/null') cur.status = 'deleted';
      else cur.newPath = p.replace(/^b\//, '');
      continue;
    }
    const hm = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hm) { pushHunkHeader(hm); continue; }
    if (!hunk) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    const op = line[0];
    if (op === ' ' || op === '+' || op === '-') {
      hunk.lines.push({ op, text: line.slice(1) });
    }
  }
  return files;
}

/**
 * Decompose a file's hunks into an ORDERED activity list — the CARL-CCI
 * "activity-labeled" representation. Consecutive removed/added runs are grouped:
 *   run of '-' then '+'  → { type: 'replace', del: [...], add: [...] }
 *   run of '-' only      → { type: 'delete', del: [...] }
 *   run of '+' only      → { type: 'add', add: [...] }
 * Context lines are the separators and are not emitted (they're not a change).
 *
 * This is what makes staged agent tasks legible: the agent sees "these lines
 * were replaced by those", not a flat blob.
 */
export function activityLabeledDiff(fileDiff) {
  const acts = [];
  for (const h of fileDiff.hunks || []) {
    let del = [];
    let add = [];
    const flush = () => {
      if (del.length && add.length) acts.push({ type: 'replace', del, add });
      else if (del.length) acts.push({ type: 'delete', del });
      else if (add.length) acts.push({ type: 'add', add });
      del = []; add = [];
    };
    for (const ln of h.lines) {
      if (ln.op === '-') {
        if (add.length) flush(); // an add run ended before this delete → boundary
        del.push(ln.text);
      } else if (ln.op === '+') {
        add.push(ln.text);
      } else {
        flush(); // context terminates the current activity
      }
    }
    flush();
  }
  return acts;
}

/**
 * Tokens that LEFT the code in this file diff — union over every '-' line
 * (both pure deletes and the "old" side of replaces). This is the
 * `deleted ∪ replaceOld` span the outdated-comment research keys on: a doc
 * that still talks about these tokens is a drift suspect.
 */
export function removedTokens(fileDiff, opts) {
  const set = new Set();
  for (const h of fileDiff.hunks || []) {
    for (const ln of h.lines) {
      if (ln.op === '-') for (const t of tokenize(ln.text, opts)) set.add(t);
    }
  }
  return set;
}

/** Tokens that were ADDED ('+' lines) — the new-side span. */
export function addedTokens(fileDiff, opts) {
  const set = new Set();
  for (const h of fileDiff.hunks || []) {
    for (const ln of h.lines) {
      if (ln.op === '+') for (const t of tokenize(ln.text, opts)) set.add(t);
    }
  }
  return set;
}

/**
 * Overlap score between a doc's tokens and a set of change tokens: the count
 * and the shared tokens themselves (for explainable findings). Deterministic.
 */
export function tokenOverlap(docTokens, changeTokenSet) {
  const shared = [];
  const seen = new Set();
  for (const t of docTokens) {
    if (changeTokenSet.has(t) && !seen.has(t)) { seen.add(t); shared.push(t); }
  }
  return { count: shared.length, shared };
}
