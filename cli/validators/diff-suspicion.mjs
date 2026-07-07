/**
 * Diff-Overlap Suspicion validator (DSP) — v0.31.0.
 *
 * Research basis: the outdated-comment work (arXiv 2010.01625) found that a
 * purely deterministic rule — "flag the prose as suspect if its tokens overlap
 * a Delete/ReplaceOld span of the code change" — hits F1 74.7, beating every
 * post-hoc neural model. We apply it to DOCS instead of comments.
 *
 * Precision-first pairing (two independent signals must BOTH hold):
 *   1. the doc REFERENCES the changed code file (path / basename / `module`),
 *   2. the doc's wording OVERLAPS tokens that were REMOVED from that file.
 * Requiring both is what keeps this from firing on every doc that happens to
 * share a common word with a diff. All findings are confidence:'low' (soft /
 * reportable) — this is a "review this" signal, never a hard failure.
 *
 * Change-driven: reads `config.changedSinceRef` (set by `guard --changed-only`)
 * or falls back to HEAD~1. Returns applicable:false when there's no git history
 * or no code change carries removed tokens, so it stays silent off-CI.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { isGitRepo, getDiffText } from '../shared-git.mjs';
import { parseUnifiedDiff, removedTokens, tokenize, tokenOverlap } from '../shared-diff.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';

const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|scala|dart)$/;

// Generic framework / language noise that overlaps between ANY React/TS doc and
// ANY diff — empirically the residual false-positive source (v0.31.0 corpus:
// "SECURITY.md ↔ page.tsx: page,set,use,state,active"). We require the shared
// tokens to contain DOMAIN identifiers, so these are stripped before counting.
const GENERIC_TOKENS = new Set([
  'page', 'components', 'component', 'shared', 'nav', 'state', 'use', 'set',
  'active', 'tab', 'react', 'props', 'prop', 'string', 'type', 'types', 'value',
  'values', 'data', 'status', 'config', 'client', 'none', 'all', 'com', 'https',
  'http', 'url', 'text', 'download', 'request', 'response', 'error', 'index',
  'item', 'items', 'list', 'name', 'key', 'map', 'log', 'update', 'updated',
  'version', 'content', 'document', 'description', 'service', 'services',
  'object', 'array', 'number', 'boolean', 'async', 'await', 'promise', 'void',
  'render', 'component', 'element', 'style', 'styles', 'class', 'div', 'span',
  'button', 'input', 'form', 'label', 'title', 'header', 'footer', 'main',
  // presentational / CSS — styling churn is not API-contract drift
  'font', 'color', 'colors', 'tracking', 'surface', 'auto', 'full', 'next',
  'body', 'sans', 'blue', 'accent', 'size', 'spacing', 'margin', 'padding',
  'width', 'height', 'flex', 'grid', 'font', 'bold', 'text', 'bg', 'rounded',
]);

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Index canonical docs + root agent-instruction files → Map<name, {lines, tokens}>.
function indexDocs(projectDir) {
  const docs = new Map();
  const add = (name, full) => {
    try {
      const content = readFileSync(full, 'utf-8');
      docs.set(name, { lines: content.split('\n'), tokens: tokenize(content) });
    } catch { /* skip unreadable */ }
  };
  const docsDir = resolve(projectDir, 'docs-canonical');
  if (existsSync(docsDir)) {
    try {
      for (const f of readdirSync(docsDir)) {
        if (f.endsWith('.md')) add(f, resolve(docsDir, f));
      }
    } catch { /* skip */ }
  }
  // Agent-instruction files are documentation too — they routinely name code.
  for (const agent of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    const p = resolve(projectDir, agent);
    if (existsSync(p)) add(agent, p);
  }
  return docs;
}

// Does the doc reference this file? We deliberately accept ONLY `path` (the
// doc wrote the real file path) and `module` (the doc backticked the module
// stem) references. We DROP bare `basename` matches: empirical corpus testing
// (v0.31.0) showed basename refs pair an architecture doc that lists every
// `page.tsx` with framework-noise tokens (page/components/state/use/nav),
// producing false positives. path/module refs are intentional and high-signal.
function referenceKind(docLines, file) {
  const normalized = file.replace(/^\.\//, '');
  const base = basename(normalized);
  const stem = base.replace(/\.[^.]+$/, '');
  const stemRe = new RegExp(`\`${escapeRegex(stem)}\``);
  for (const line of docLines) {
    if (line.includes(normalized)) return 'path';
    if (stemRe.test(line)) return 'module';
  }
  return null;
}

export function validateDiffSuspicion(projectDir, config = {}) {
  const cfg = config.diffSuspicion || {};
  const minOverlap = Number.isInteger(cfg.minOverlap) ? cfg.minOverlap : 2;
  const ref = cfg.since || config.changedSinceRef || 'HEAD~1';

  if (!isGitRepo(projectDir)) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }

  const diffText = getDiffText(projectDir, ref);
  const changedFiles = parseUnifiedDiff(diffText).filter(
    f => f.newPath && CODE_EXTENSIONS.test(f.newPath) && f.status !== 'deleted'
  );
  // Precompute removed-token sets; drop files whose change removed nothing.
  const changed = changedFiles
    .map(f => ({ path: f.newPath, removed: removedTokens(f) }))
    .filter(f => f.removed.size > 0);

  if (changed.length === 0) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }

  const docs = indexDocs(projectDir);
  if (docs.size === 0) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }

  const findings = [];
  let pairsChecked = 0;
  for (const [docName, doc] of docs) {
    for (const cf of changed) {
      const kind = referenceKind(doc.lines, cf.path);
      if (!kind) continue; // signal 1: doc must reference the changed file (path|module)
      pairsChecked++;
      const { shared: rawShared } = tokenOverlap(doc.tokens, cf.removed);
      // signal 2: doc must share DOMAIN (non-generic) removed tokens
      const shared = rawShared.filter(t => !GENERIC_TOKENS.has(t));
      if (shared.length < minOverlap) continue;
      findings.push(mkFinding({
        code: 'DSP001',
        validator: 'diff-suspicion',
        severity: 'warn',
        confidence: 'low',
        message: `${docName} describes ${cf.path} (${kind} ref), which just had ${shared.slice(0, 5).join(', ')}${shared.length > 5 ? '…' : ''} removed/changed (${ref}..HEAD) — verify the doc still matches.`,
        location: { file: docName },
        suggestion: {
          summary: `Re-read ${docName} against the current ${cf.path}; the removed symbols (${shared.slice(0, 8).join(', ')}) may now be wrong.`,
        },
      }));
    }
  }

  return resultFromFindings(findings, {
    passed: pairsChecked - findings.length,
    total: pairsChecked,
    applicable: true,
  });
}
