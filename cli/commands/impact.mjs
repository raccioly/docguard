/**
 * Impact Command — S-11
 *
 * After a commit (or before opening a PR), shows which canonical doc
 * sections reference any file that changed since `--since` (default HEAD~1).
 * Combines the L-2 reverse-trace logic with the changed-files diff so you
 * get "you should re-read these doc sections" in one command.
 *
 * Use cases:
 *   - Post-commit hook: `docguard impact --since HEAD~1` runs after each
 *     commit and reminds the developer which docs to update.
 *   - PR prep: `docguard impact --since main` shows the doc surface area
 *     touched by the whole branch.
 *
 * JSON mode emits a structured `{ changedFiles, affectedDocs }` payload
 * for CI integrations and PR-comment bots.
 *
 * @req SC-S11-001 — impact reports per-file → doc mappings
 * @req SC-S11-002 — files with no doc references are listed as "no impact"
 * @req SC-S11-003 — --format json emits parseable structured output
 * @req SC-S11-004 — non-code files (.md, .json, etc.) are skipped from impact analysis
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';

import { c } from '../shared.mjs';
import { changedFilesSince, isGitRepo } from '../shared-git.mjs';

/**
 * File extensions we consider "code" for the purposes of impact analysis.
 * Match the set used by other validators (Docs-Sync, Freshness).
 */
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift)$/;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find canonical doc references for a single file. Reuses the same three
 * match strategies as trace --reverse for consistency: direct path,
 * basename, backticked module name.
 */
function findReferences(file, docs) {
  const refs = [];
  const normalized = file.replace(/^\.\//, '');
  const base = basename(normalized);
  const stem = base.replace(/\.[^.]+$/, '');
  const stemRe = new RegExp(`\`${escapeRegex(stem)}\``);
  for (const [docName, lines] of docs) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let kind = null;
      if (line.includes(normalized)) kind = 'path';
      else if (line.includes(base)) kind = 'basename';
      else if (stemRe.test(line)) kind = 'module';
      if (kind) {
        refs.push({ doc: docName, line: i + 1, kind });
      }
    }
  }
  return refs;
}

export function runImpact(projectDir, _config, flags) {
  const isJson = flags.format === 'json';
  const since = flags.since || 'HEAD~1';

  if (!isGitRepo(projectDir)) {
    if (isJson) {
      console.log(JSON.stringify({ since, error: 'not a git repository', changedFiles: [], affectedDocs: [] }, null, 2));
    } else {
      console.error(`${c.red}Not a git repository — impact requires git history.${c.reset}`);
    }
    process.exit(1);
  }

  const changed = changedFilesSince(projectDir, since);
  // Filter to code files only — markdown/json/yaml changes don't have "doc
  // impact" in the same sense; they ARE the docs (or config).
  const codeChanged = changed.filter(f => CODE_EXTENSIONS.test(f));

  // Index canonical docs once
  const docsDir = resolve(projectDir, 'docs-canonical');
  const docsIndex = new Map(); // docName → lines[]
  if (existsSync(docsDir)) {
    try {
      for (const f of readdirSync(docsDir)) {
        if (!f.endsWith('.md')) continue;
        try {
          const content = readFileSync(resolve(docsDir, f), 'utf-8');
          docsIndex.set(f, content.split('\n'));
        } catch { /* skip unreadable */ }
      }
    } catch { /* skip if dir unreadable */ }
  }

  // Compute per-file references
  const fileImpact = []; // { file, references: [{doc, line, kind}] }
  for (const f of codeChanged) {
    fileImpact.push({ file: f, references: findReferences(f, docsIndex) });
  }

  // Roll up: which docs are affected, with all source files
  const docMap = new Map(); // doc → Set<file>
  for (const { file, references } of fileImpact) {
    for (const r of references) {
      if (!docMap.has(r.doc)) docMap.set(r.doc, new Set());
      docMap.get(r.doc).add(file);
    }
  }
  const affectedDocs = Array.from(docMap.entries()).map(([doc, files]) => ({
    doc,
    files: Array.from(files),
  }));

  // ── JSON output ──
  if (isJson) {
    console.log(JSON.stringify({
      since,
      changedFiles: codeChanged,
      ignoredFiles: changed.filter(f => !CODE_EXTENSIONS.test(f)),
      affectedDocs,
      timestamp: new Date().toISOString(),
    }, null, 2));
    return;
  }

  // ── Text output ──
  console.log(`${c.bold}📊 DocGuard Impact${c.reset} ${c.dim}(since ${since})${c.reset}\n`);

  if (changed.length === 0) {
    console.log(`  ${c.green}✅ No file changes since ${since}.${c.reset}`);
    return;
  }
  if (codeChanged.length === 0) {
    console.log(`  ${c.dim}No code files changed (${changed.length} non-code files: ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? '…' : ''}).${c.reset}`);
    return;
  }

  console.log(`  ${c.cyan}${codeChanged.length}${c.reset} code file(s) changed.\n`);

  if (affectedDocs.length === 0) {
    console.log(`  ${c.yellow}⚠ No canonical docs reference any of the changed files.${c.reset}`);
    console.log(`  ${c.dim}This often means the changed code is undocumented. Consider:${c.reset}`);
    console.log(`  ${c.dim}  - Running ${c.cyan}docguard generate --plan${c.dim} to add doc skeletons${c.reset}`);
    console.log(`  ${c.dim}  - Reviewing whether the change belongs in an existing doc${c.reset}`);
    return;
  }

  console.log(`  ${c.green}${affectedDocs.length}${c.reset} canonical doc(s) reference the changed files:\n`);
  for (const { doc, files } of affectedDocs) {
    console.log(`  ${c.cyan}${doc}${c.reset} ${c.dim}(${files.length} file${files.length > 1 ? 's' : ''})${c.reset}`);
    for (const f of files.slice(0, 5)) {
      console.log(`     ${c.dim}via${c.reset} ${f}`);
    }
    if (files.length > 5) console.log(`     ${c.dim}... ${files.length - 5} more${c.reset}`);
  }

  // List code files with NO doc references — these may need new docs
  const orphaned = fileImpact.filter(fi => fi.references.length === 0).map(fi => fi.file);
  if (orphaned.length > 0) {
    console.log(`\n  ${c.yellow}${orphaned.length} changed file(s) have NO canonical doc reference:${c.reset}`);
    for (const f of orphaned.slice(0, 5)) console.log(`     ${c.dim}• ${f}${c.reset}`);
    if (orphaned.length > 5) console.log(`     ${c.dim}... ${orphaned.length - 5} more${c.reset}`);
    console.log(`  ${c.dim}These may be undocumented — review whether they belong in an existing doc.${c.reset}`);
  }
}
