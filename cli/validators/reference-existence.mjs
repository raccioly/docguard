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
 *
 * REF002 (ADR citations, the code→doc direction): a code comment citing
 * `ADR-NNN` is a reference into the docs — if no ADR document defines that
 * number, the citation is stale (renumbered, removed, or never written).
 * ADRs have no external registry, so a missing number is a real signal.
 * RFC citations are deliberately OUT of scope: `RFC 793` in a comment almost
 * always cites the IETF registry (external, unverifiable) and would
 * false-positive on every network stack. Numbers compare as integers, so
 * `ADR-00NN` in code matches `ADR-NN` in docs.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, extname, relative, basename } from 'node:path';
import { isGitRepo, lastCommitHash, symbolExistsAtRev } from '../shared-git.mjs';
import { walkFiles, isNonProductPath } from '../shared-ignore.mjs';
import { readScannable } from '../shared-source.mjs';
import { resolveDocDirs } from '../shared.mjs';
import { mkFinding, resultFromFindings, lineSuppresses } from '../findings.mjs';

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

// ── REF002 helpers ──────────────────────────────────────────────────────────

// Uppercase-only by design: teams cite decision records as "ADR-NNN" / "ADR NN";
// lowercase "adr" is too often an abbreviation for something else.
const ADR_CITE_SRC = String.raw`\bADR[- ]?(\d{1,5})\b`;

/**
 * Index of the comment portion of a code line, or -1 when the line has no
 * comment. A citation only counts when it sits inside a comment — `ADR-NN`
 * in a string literal or identifier is data, not a citation. Whole-line
 * comments (incl. `*` block-comment continuations) count from column 0;
 * trailing comments are recognised by their marker. ` # ` requires spacing so
 * `"#fff"`-style literals don't read as Python/shell comments.
 */
function commentIndex(line) {
  const t = line.trimStart();
  if (/^(\/\/|\/\*|\*|#|--|<!--)/.test(t)) return 0;
  let idx = -1;
  for (const marker of ['//', '/*', '<!--', ' # ', ' -- ']) {
    const i = line.indexOf(marker);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  return idx;
}

/** Collect ADR citations found in comments of one source file. */
function collectAdrCitations(content, relPath, out) {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('ADR')) continue;
    const ci = commentIndex(line);
    if (ci < 0) continue;
    const re = new RegExp(ADR_CITE_SRC, 'g'); // local: shared stateful g-regexes are a footgun
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m.index < ci) continue;
      if (lineSuppresses('REF002', line, lines[i - 1] || '')) continue;
      out.push({ num: parseInt(m[1], 10), raw: m[0], file: relPath, line: i + 1 });
    }
  }
}

/**
 * Discover which ADR numbers the project's docs actually define.
 * Sources, in decreasing specificity:
 *   - files/dirs named after ADRs (`ADR.md`, `docs/adr/`, `docs/decisions/`):
 *     every ADR-NNN mention counts, plus madr-style numeric filenames
 *     (`0001-use-postgres.md`);
 *   - any other markdown in a doc home: heading lines only (`## ADR-NNN: …`),
 *     so a prose mention ("see ADR-NN") never counts as a definition.
 */
function collectAdrNumbers(projectDir, config) {
  const nums = new Set();
  const addAll = (text) => {
    for (const m of text.matchAll(new RegExp(ADR_CITE_SRC, 'g'))) nums.add(parseInt(m[1], 10));
  };
  const files = new Set();
  try {
    for (const f of readdirSync(projectDir)) {
      if (f.endsWith('.md')) files.add(resolve(projectDir, f));
    }
  } catch { /* unreadable root */ }
  for (const d of resolveDocDirs(projectDir, config)) {
    const abs = resolve(projectDir, d);
    if (!existsSync(abs)) continue;
    walkFiles(abs, (full) => { if (full.endsWith('.md')) files.add(full); });
  }
  for (const full of files) {
    let content;
    try { content = readFileSync(full, 'utf-8'); } catch { continue; }
    const base = basename(full);
    const norm = full.replace(/\\/g, '/');
    const isAdrHome = /adr/i.test(base) || /\/(adrs?|decisions?)\//i.test(norm);
    const numericName = base.match(/^(\d{1,5})[-_.]/);
    if (isAdrHome && numericName) nums.add(parseInt(numericName[1], 10));
    const adrInName = base.match(/adr[-_ ]?(\d{1,5})/i);
    if (adrInName) nums.add(parseInt(adrInName[1], 10));
    if (isAdrHome) {
      addAll(content);
    } else {
      for (const line of content.split('\n')) {
        if (/^#{1,6}\s/.test(line)) addAll(line);
      }
    }
  }
  return nums;
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
  const adrEnabled = cfg.adrCitations !== false;

  if (!isGitRepo(projectDir)) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }
  const docs = indexDocs(projectDir);
  const needIds = docs.some(d => d.refs.length > 0);
  if (!needIds && !adrEnabled) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }

  // ONE walk over the source tree serves both checks: the REF001 identifier
  // set and the REF002 ADR-citation scan. Each part is skipped when its check
  // has nothing to do, so the walk stays as cheap as before for either alone.
  const headIds = new Set();
  const citations = [];
  walkFiles(projectDir, (full) => {
    if (!CODE_EXT.has(extname(full))) return;
    const content = readScannable(full);
    if (!content) return;
    if (needIds) {
      const m = content.match(IDENT);
      if (m) for (const id of m) headIds.add(id);
    }
    if (adrEnabled && content.includes('ADR')) {
      // Tests/fixtures/examples cite ADRs as fixture data, not as real
      // citations — same non-product scoping the surface scanners use.
      const rel = relative(projectDir, full);
      if (!isNonProductPath(rel.replace(/\\/g, '/'), config)) {
        collectAdrCitations(content, rel, citations);
      }
    }
  });

  if (!needIds && citations.length === 0) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }

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

  // ── REF002: every distinct cited ADR number is one check ──
  const MAX_ADR_FINDINGS = 10; // calm cap — a flood means a systemic numbering change, not 40 separate problems
  let adrDistinct = 0;
  let adrMissing = 0;
  if (adrEnabled && citations.length > 0) {
    const known = collectAdrNumbers(projectDir, config);
    const byNum = new Map(); // num → [{raw, file, line}]
    for (const c of citations) {
      if (!byNum.has(c.num)) byNum.set(c.num, []);
      byNum.get(c.num).push(c);
    }
    adrDistinct = byNum.size;
    for (const [num, locs] of byNum) {
      if (known.has(num)) continue;
      adrMissing++;
      if (adrMissing > MAX_ADR_FINDINGS) continue;
      const first = locs[0];
      const where = `${first.file}:${first.line}${locs.length > 1 ? ` (+${locs.length - 1} more)` : ''}`;
      const message = known.size > 0
        ? `Code cites ${first.raw} (${where}) but no ADR document defines that number — renumbered, removed, or never written.`
        : `Code cites ${first.raw} (${where}) but the repo has no ADR documents — the decision record it points to is missing.`;
      findings.push(mkFinding({
        code: 'REF002',
        validator: 'reference-existence',
        severity: 'warn',
        confidence: 'low',
        message,
        location: { file: first.file, line: first.line },
        suggestion: {
          summary: known.size > 0
            ? `Fix the number or write the missing ADR entry (or suppress with // docguard:ignore REF002 on the citation line).`
            : `Create an ADR doc (docguard init writes templates/ADR.md) or suppress with // docguard:ignore REF002.`,
        },
      }));
    }
  }

  // A missing number beyond the finding cap is still a failed check.
  const total = totalChecked + adrDistinct;
  const overCap = Math.max(0, adrMissing - MAX_ADR_FINDINGS);
  const res = resultFromFindings(findings, {
    passed: total - findings.length - overCap,
    total,
    applicable: true,
  });
  res.absentAtHead = absentAtHead; // instrumentation: proves the pipeline reaches the rev check
  return res;
}
