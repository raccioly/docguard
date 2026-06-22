/**
 * `docguard sync --tests` — reconcile the TEST-SPEC Source-to-Test Map from disk.
 *
 * Background (LLM field report #10): the source→test table in TEST-SPEC.md is
 * hand-maintained, so plain `docguard sync` (which only refreshes
 * docguard:generated code-truth SECTIONS) reports "nothing drifted" even when the
 * table has a ghost service (source deleted), a ghost test (test file deleted),
 * and N services that gained tests. The Test-Spec validator already detects the
 * ghosts; this writes the reconciliation back.
 *
 * SAFETY — this edits a human-curated table, so it does ONLY the two unambiguous
 * operations and previews by default (`--write` applies):
 *   - REMOVE a row whose SOURCE file no longer exists on disk (ghost service).
 *   - APPEND a row for a co-located source↔test pair found on disk but absent
 *     from the table (newly-covered service).
 * Ghost TEST references (source still exists, test file gone) are REPORTED but
 * never auto-edited — blanking a hand-maintained status/notes cell is too
 * destructive, and the Test-Spec validator already warns on them.
 *
 * Zero npm dependencies — pure Node.js built-ins.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { c } from '../shared.mjs';
import { shouldIgnore } from '../shared-ignore.mjs';

const TEST_SPEC_DOC = 'docs-canonical/TEST-SPEC.md';
const CODE_EXT = /\.[cm]?[jt]sx?$/;
const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const WALK_SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.next', '__pycache__', '.venv', 'vendor']);

// ── On-disk discovery ──────────────────────────────────────────────────────

function walkCodeFiles(projectDir, config) {
  const out = [];
  const visit = (absDir, relDir) => {
    let entries;
    try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (WALK_SKIP.has(e.name)) continue;
      const relPath = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) { visit(resolve(absDir, e.name), relPath); continue; }
      if (!CODE_EXT.test(e.name)) continue;
      if (shouldIgnore(relPath, config)) continue;
      out.push(relPath);
    }
  };
  visit(resolve(projectDir), '');
  return out;
}

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = (p) => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p);
const stemOf = (b) => b.replace(CODE_EXT, '').replace(/\.(test|spec)$/, '');

/**
 * Discover co-located source↔test pairs on disk. A test counts as covering a
 * source when their stems match AND the test sits in the same directory or a
 * sibling `__tests__/`. Conservative by design — cross-directory basename
 * collisions (two `index.ts`) would pollute the table, so they're excluded.
 *
 * @returns {Array<{ source: string, test: string }>}
 */
export function discoverTestPairs(projectDir, config = {}) {
  const files = walkCodeFiles(projectDir, config);
  const tests = files.filter((f) => TEST_RE.test(f));
  const sources = files.filter((f) => !TEST_RE.test(f));
  const pairs = [];
  for (const src of sources) {
    const sDir = dirOf(src);
    const sStem = stemOf(baseOf(src));
    const match = tests.find((t) => {
      if (stemOf(baseOf(t)) !== sStem) return false;
      const tDir = dirOf(t);
      return tDir === sDir || tDir === `${sDir}/__tests__` || (sDir === '' && tDir === '__tests__');
    });
    if (match) pairs.push({ source: src, test: match });
  }
  return pairs;
}

// ── Table parsing (mirrors test-spec.mjs column detection) ─────────────────

const isPathLike = (v) => !!v && !/\s/.test(v) && (/[\\/]/.test(v) || /\.[A-Za-z0-9]{1,6}$/.test(v));
const splitRow = (line) => {
  const parts = line.split('|');
  parts.shift();
  parts.pop();
  return parts.map((s) => s.trim());
};

/**
 * Locate the Source-to-Test Map table and classify its rows against disk.
 * @returns {null | { headerLine, sepLine, sourceIdx, testIdxs, ncols, keep:string[],
 *                    removed:object[], ghostTests:object[], blockStart, blockEnd }}
 */
function parseMapTable(content, projectDir) {
  const sectionRe = /## (?:Service-to-Test Map|Source-to-Test Map)[\s\S]*?(?=\n## |$)/;
  const m = sectionRe.exec(content);
  if (!m) return null;
  const sectionStart = m.index;
  const sectionText = m[0];
  const sectionLines = sectionText.split('\n');

  // Find the FIRST pipe table inside the section (header + separator + rows).
  let headerLineIdx = -1;
  for (let i = 0; i < sectionLines.length - 1; i++) {
    if (sectionLines[i].trim().startsWith('|') && /^\s*\|[\s|:-]+\|\s*$/.test(sectionLines[i + 1])) {
      headerLineIdx = i;
      break;
    }
  }
  if (headerLineIdx === -1) return null;

  const header = splitRow(sectionLines[headerLineIdx]).map((h) => h.toLowerCase());
  const ncols = header.length;
  let sourceIdx = header.findIndex((h) => /\bsource\b/.test(h));
  if (sourceIdx < 0) sourceIdx = 0;
  let statusIdx = header.findIndex((h) => /\bstatus\b/.test(h));
  if (statusIdx < 0) statusIdx = ncols - 1;
  let testIdxs = header.map((h, i) => (/\btest\b|\be2e\b/.test(h) ? i : -1)).filter((i) => i >= 0 && i !== sourceIdx && i !== statusIdx);
  if (testIdxs.length === 0) { const fb = sourceIdx === 1 ? 0 : 1; if (fb !== statusIdx && fb < ncols) testIdxs = [fb]; }

  // Walk data rows after the separator until the table ends (a non-pipe line).
  const keep = [];           // raw row lines to retain
  const removed = [];        // { source } ghost-source rows dropped
  const ghostTests = [];     // { source, test } source exists but a test ref is gone
  const documentedSources = new Set();
  let dataEndIdx = headerLineIdx + 2;
  for (let i = headerLineIdx + 2; i < sectionLines.length; i++) {
    const line = sectionLines[i];
    if (!line.trim().startsWith('|')) break;
    dataEndIdx = i + 1;
    const cells = splitRow(line);
    const rawSource = (cells[sourceIdx] || '').replace(/`/g, '').trim();
    // Template/example/placeholder rows are left untouched.
    if (!rawSource || rawSource.startsWith('<!--') || rawSource.startsWith('*') || !isPathLike(rawSource)) {
      keep.push(line);
      continue;
    }
    if (!existsSync(resolve(projectDir, rawSource))) {
      removed.push({ source: rawSource });
      continue; // drop ghost-source row
    }
    documentedSources.add(rawSource);
    // Source exists — report (don't edit) any dead test reference.
    for (const ti of testIdxs) {
      const t = (cells[ti] || '').replace(/`/g, '').trim();
      if (isPathLike(t) && !existsSync(resolve(projectDir, t))) ghostTests.push({ source: rawSource, test: t });
    }
    keep.push(line);
  }

  return {
    sectionStart,
    headerAbsLine: headerLineIdx,
    sepLine: sectionLines[headerLineIdx + 1],
    headerLine: sectionLines[headerLineIdx],
    sourceIdx, testIdxs, statusIdx, ncols,
    keep, removed, ghostTests, documentedSources,
    // absolute char offsets of the table block within `content`
    blockStartLine: headerLineIdx,
    blockEndLine: dataEndIdx,
    sectionLines,
    sectionTextStart: sectionStart,
  };
}

/**
 * Compute the reconciliation. Pure: returns the diff + the rewritten content.
 * @returns {{ applicable:boolean, removed:object[], added:object[], ghostTests:object[], newContent:string|null, reason?:string }}
 */
export function reconcileTestMap(content, projectDir, config) {
  const parsed = parseMapTable(content, projectDir);
  if (!parsed) {
    return { applicable: false, removed: [], added: [], ghostTests: [], newContent: null, reason: 'no Source-to-Test Map table found' };
  }
  const pairs = discoverTestPairs(projectDir, config);
  const added = pairs.filter((p) => !parsed.documentedSources.has(p.source));

  // Build the new table block: header, separator, kept rows, appended rows.
  const newRowFor = ({ source, test }) => {
    const cells = new Array(parsed.ncols).fill('—');
    cells[parsed.sourceIdx] = `\`${source}\``;
    if (parsed.testIdxs.length) cells[parsed.testIdxs[0]] = `\`${test}\``;
    cells[parsed.statusIdx] = '⚠️ auto-added — verify';
    return `| ${cells.join(' | ')} |`;
  };
  const addedRows = added.map(newRowFor);
  const newBlock = [parsed.headerLine, parsed.sepLine, ...parsed.keep, ...addedRows].join('\n');

  // Splice the new block back into the original section text, then back into content.
  const sectionLines = parsed.sectionLines.slice();
  const before = sectionLines.slice(0, parsed.blockStartLine);
  const after = sectionLines.slice(parsed.blockEndLine);
  const newSection = [...before, newBlock, ...after].join('\n');
  const oldSection = parsed.sectionLines.join('\n');
  const newContent = content.slice(0, parsed.sectionTextStart) + newSection + content.slice(parsed.sectionTextStart + oldSection.length);

  const changed = parsed.removed.length > 0 || added.length > 0;
  return {
    applicable: true,
    removed: parsed.removed,
    added,
    ghostTests: parsed.ghostTests,
    newContent: changed ? newContent : null,
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────

export function runSyncTests(projectDir, config, flags) {
  const apply = !!flags.write;
  const isJson = flags.format === 'json';
  const docPath = resolve(projectDir, TEST_SPEC_DOC);

  if (!existsSync(docPath)) {
    if (isJson) { console.log(JSON.stringify({ applicable: false, reason: 'TEST-SPEC.md not present' }, null, 2)); return; }
    console.log(`${c.yellow}TEST-SPEC.md not found — run ${c.cyan}docguard init${c.yellow} first.${c.reset}\n`);
    return;
  }

  const content = readFileSync(docPath, 'utf-8');
  const r = reconcileTestMap(content, projectDir, config);

  if (isJson) {
    console.log(JSON.stringify({
      applicable: r.applicable, applied: apply && !!r.newContent,
      removed: r.removed, added: r.added, ghostTests: r.ghostTests, reason: r.reason || null,
    }, null, 2));
    if (apply && r.newContent) writeFileSync(docPath, r.newContent, 'utf-8');
    return;
  }

  console.log(`${c.bold}🔄 DocGuard Sync --tests — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   ${TEST_SPEC_DOC} · ${apply ? 'Applying' : 'Dry run (use --write to apply)'}${c.reset}\n`);

  if (!r.applicable) {
    console.log(`  ${c.yellow}No Source-to-Test Map table found in TEST-SPEC.md.${c.reset}`);
    console.log(`  ${c.dim}Add a "## Source-to-Test Map" table (col 1 = source, last col = status), then re-run.${c.reset}\n`);
    return;
  }

  if (r.removed.length === 0 && r.added.length === 0 && r.ghostTests.length === 0) {
    console.log(`  ${c.green}✅ Source-to-Test Map matches disk — nothing to reconcile.${c.reset}\n`);
    return;
  }

  if (r.removed.length) {
    console.log(`  ${apply ? c.green : c.yellow}${apply ? '✅ Removed' : '• Remove'} ${r.removed.length} ghost-source row(s) (source file deleted):${c.reset}`);
    for (const x of r.removed) console.log(`     ${c.dim}- ${x.source}${c.reset}`);
  }
  if (r.added.length) {
    console.log(`  ${apply ? c.green : c.yellow}${apply ? '✅ Added' : '• Add'} ${r.added.length} newly-covered source(s):${c.reset}`);
    for (const x of r.added) console.log(`     ${c.dim}+ ${x.source} → ${x.test}${c.reset}`);
  }
  if (r.ghostTests.length) {
    console.log(`  ${c.yellow}⚠ ${r.ghostTests.length} ghost test reference(s) (source exists, test file gone) — fix by hand:${c.reset}`);
    for (const x of r.ghostTests) console.log(`     ${c.dim}~ ${x.source} → ${x.test} (missing)${c.reset}`);
  }

  if (apply && r.newContent) {
    writeFileSync(docPath, r.newContent, 'utf-8');
    console.log(`\n  ${c.green}↻ ${TEST_SPEC_DOC} updated. Review the ⚠️ auto-added rows, then ${c.cyan}docguard guard${c.green}.${c.reset}\n`);
  } else if (!apply) {
    console.log(`\n  ${c.dim}Apply: ${c.cyan}docguard sync --tests --write${c.reset}\n`);
  } else {
    console.log('');
  }
}
