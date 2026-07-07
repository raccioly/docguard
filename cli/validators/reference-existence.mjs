/**
 * Two-Revision Reference-Existence validator (REF001) — v0.31.0.
 *
 * Method (arXiv 2212.01479, field-tested at ~50% maintainer acceptance):
 * extract code-element references from a doc, then compare their existence in
 * the source tree at TWO revisions — the commit where the doc was LAST UPDATED
 * vs HEAD. A reference that matched source when the doc was written but matches
 * ZERO source instances now is flagged outdated. Fully deterministic.
 *
 * Performance: the "present now?" gate is answered from ONE in-memory identifier
 * set built by a single source walk (not a git grep per symbol — that was ~7s
 * on a 167-ref repo). The walk skips dot-directories (.github, .specify), so a
 * symbol the walk misses is CONFIRMED absent with an authoritative `git grep` at
 * HEAD before we trust it — otherwise a symbol living in a dot-dir reads as a
 * false "removed" (caught dogfooding DocGuard's own AGENTS.md). Only symbols
 * absent from BOTH the walk and HEAD git grep — the rare case — pay for the
 * historical `git grep` at the doc's last-update revision.
 *
 * Precision guards:
 *   - Only PURE COMPOUND identifiers (camelCase / snake_case / Pascal-multiword)
 *     from backticks are checked — never prose words ("`token`" is ignored), and
 *     dotted member/file refs are out of scope for v1 (documented).
 *   - CLI/config flags (`--foo`) excluded — the "removed but still relevant"
 *     false-positive mode (a) from the paper.
 *   - present-then-AND-absent-now is required, so a symbol that never existed
 *     at doc-time (a typo, an external lib) is not accused — false-positive
 *     mode (b) ("literal deleted but logic remains") is bounded by compound
 *     shape + the two-revision gate.
 * All findings are confidence:'low' / soft — "verify", never a hard failure.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { isGitRepo, lastCommitHash, symbolExistsAtRev } from '../shared-git.mjs';
import { walkFiles } from '../shared-ignore.mjs';
import { readScannable } from '../shared-source.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';

const CODE_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java',
  '.kt', '.rb', '.php', '.cs', '.swift', '.scala', '.dart', '.c', '.cpp', '.h',
]);
const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;

// Compound = clearly a code symbol, not a prose word: camelCase, snake_case,
// or PascalCase-multiword. Pure lowercase single words are excluded.
const COMPOUND = /[a-z][A-Z]|_|^[A-Z][a-z]+[A-Z]/;
function isCodeIdentifier(s) {
  if (s.length < 4 || s.length > 80) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return false; // pure identifier (no dots)
  return COMPOUND.test(s);
}

// One pass over the current source tree → Set of every whole identifier present.
function buildHeadIdentifierSet(projectDir) {
  const set = new Set();
  walkFiles(projectDir, (full) => {
    if (!CODE_EXT.has(extname(full))) return;
    const content = readScannable(full);
    if (!content) return;
    const m = content.match(IDENT);
    if (m) for (const id of m) set.add(id);
  });
  return set;
}

function extractRefs(content) {
  const refs = new Set();
  const backtick = /`([^`\n]{2,80})`/g;
  let m;
  while ((m = backtick.exec(content)) !== null) {
    let tok = m[1].trim().replace(/\(.*$/, '').replace(/[.,;:]+$/, '').trim();
    if (/^-/.test(tok)) continue;              // CLI flag → FP mode (a)
    if (isCodeIdentifier(tok)) refs.add(tok);
  }
  return [...refs];
}

function indexDocs(projectDir) {
  const docs = [];
  const push = (name, full) => {
    try {
      const content = readFileSync(full, 'utf-8');
      docs.push({ name, path: full, refs: extractRefs(content) });
    } catch { /* skip */ }
  };
  const docsDir = resolve(projectDir, 'docs-canonical');
  if (existsSync(docsDir)) {
    try {
      for (const f of readdirSync(docsDir)) if (f.endsWith('.md')) push(f, resolve(docsDir, f));
    } catch { /* skip */ }
  }
  for (const agent of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    const p = resolve(projectDir, agent);
    if (existsSync(p)) push(agent, p);
  }
  return docs;
}

export function validateReferenceExistence(projectDir, config = {}) {
  const cfg = config.referenceExistence || {};
  const maxRefsPerDoc = cfg.maxRefsPerDoc || 80;

  if (!isGitRepo(projectDir)) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }
  const docs = indexDocs(projectDir);
  if (docs.length === 0 || docs.every(d => d.refs.length === 0)) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }

  const headIds = buildHeadIdentifierSet(projectDir); // cheap gate, built once
  const revPresence = new Map(); // `${sym}\0${rev}` → bool
  // Authoritative HEAD absence (covers dot-dirs the walk skipped). Cached.
  const headAbsent = new Map();
  const confirmedAbsentAtHead = (sym) => {
    if (!headAbsent.has(sym)) headAbsent.set(sym, !symbolExistsAtRev(projectDir, sym, 'HEAD'));
    return headAbsent.get(sym);
  };

  const findings = [];
  let totalChecked = 0;
  let absentAtHead = 0;
  for (const doc of docs) {
    let rev = null; // resolve lazily — only if a ref is actually absent now
    for (const sym of doc.refs.slice(0, maxRefsPerDoc)) {
      totalChecked++;
      if (headIds.has(sym)) continue;            // in the walked tree → present (cheap)
      if (!confirmedAbsentAtHead(sym)) continue; // walk missed it but git finds it (dot-dir) → present
      absentAtHead++;
      if (rev === null) rev = lastCommitHash(projectDir, doc.path) || '';
      if (!rev) continue;                        // untracked doc → no "then" snapshot
      const key = `${sym}\0${rev}`;
      if (!revPresence.has(key)) revPresence.set(key, symbolExistsAtRev(projectDir, sym, rev));
      if (!revPresence.get(key)) continue;       // never existed at doc-time → not our signal
      findings.push(mkFinding({
        code: 'REF001',
        validator: 'reference-existence',
        severity: 'warn',
        confidence: 'low',
        message: `${doc.name} references \`${sym}\`, which existed in the code when the doc was last updated but has ZERO matches at HEAD — likely renamed or removed.`,
        location: { file: doc.name },
        suggestion: {
          summary: `Update or remove the \`${sym}\` reference in ${doc.name} (or suppress if it is a still-relevant user-facing name).`,
        },
      }));
    }
  }

  const res = resultFromFindings(findings, {
    passed: totalChecked - findings.length,
    total: totalChecked,
    applicable: true,
  });
  res.absentAtHead = absentAtHead; // instrumentation: proves the pipeline reaches the rev check
  return res;
}
