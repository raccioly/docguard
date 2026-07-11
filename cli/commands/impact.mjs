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
 * v0.31.0 — blast radius (feat 1):
 *   - Agent-instruction files (AGENTS.md/CLAUDE.md/GEMINI.md) are indexed
 *     alongside canonical docs, so a changed code file they reference is
 *     surfaced too (agent instructions drift when the code they describe moves).
 *   - Doc→doc graph: when a DOC changes, the docs that reference it — INCLUDING
 *     agent-instruction files — are flagged as suspect ("blast radius"). This is
 *     the unclaimed slice: a change in ARCHITECTURE.md marks the AGENTS.md that
 *     points at it for review.
 *
 * @req SC-S11-001 — impact reports per-file → doc mappings
 * @req SC-S11-002 — files with no doc references are listed as "no impact"
 * @req SC-S11-003 — --format json emits parseable structured output
 * @req SC-S11-004 — non-code files (.md, .json, etc.) are skipped from impact analysis
 * @req SC-S11-007 — agent-instruction files participate in impact analysis
 * @req SC-S11-008 — a changed doc flags the docs that reference it (blast radius)
 *
 * Indirect impact (import-graph BFS):
 *   A changed file with no doc references can still invalidate docs about the
 *   modules that IMPORT it (change shared-git.mjs → the doc describing
 *   `impact` is suspect). We walk the reverse import graph up to 2 hops —
 *   beyond that, hub modules connect everything and the signal drowns.
 *   JS/TS only (the graph builder's scope); `--no-indirect` disables.
 * @req SC-S11-009 — docs referencing an importer of a changed file are flagged as indirect
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

import { c } from '../shared.mjs';
import { changedFilesSince, isGitRepo } from '../shared-git.mjs';
import { buildImportGraph } from '../validators/architecture.mjs';

/**
 * File extensions we consider "code" for the purposes of impact analysis.
 * Match the set used by other validators (Docs-Sync, Freshness).
 */
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift)$/;

// Root agent-instruction files — documentation that names code and other docs.
const AGENT_FILES = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md'];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Doc→doc references: which indexed docs reference `changedDocPath` — by its
 * basename (the form used in prose "see ARCHITECTURE.md" and markdown links
 * `](ARCHITECTURE.md)`) or by an extension-less Obsidian wikilink
 * (`[[ARCHITECTURE]]`, `[[ARCHITECTURE#Heading]]`, `[[ARCHITECTURE|alias]]`).
 * Skips self. This is the blast-radius edge set.
 */
function docsReferencing(changedDocPath, index) {
  const cbase = basename(changedDocPath);
  const stem = cbase.replace(/\.md$/i, '');
  const wikiRe = new RegExp(`\\[\\[${escapeRegex(stem)}(?:[#|\\]])`);
  const dependents = [];
  for (const [docName, lines] of index) {
    if (docName === cbase || docName === changedDocPath) continue; // not self
    if (lines.some(l => l.includes(cbase) || wikiRe.test(l))) dependents.push(docName);
  }
  return dependents;
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

/**
 * Ancestors of `file` in the reverse import graph, capped at `maxHops`.
 * Returns Map<ancestorPath, {hops, via}> where `via` is the first hop on the
 * path back toward the changed file (for explainable output).
 */
function reverseImportAncestors(file, reverseEdges, maxHops = 2) {
  const seen = new Map(); // ancestor → hops from the changed file
  let frontier = [file];
  for (let hop = 1; hop <= maxHops && frontier.length > 0; hop++) {
    const next = [];
    for (const cur of frontier) {
      for (const importer of reverseEdges.get(cur) || []) {
        if (importer === file || seen.has(importer)) continue;
        seen.set(importer, hop);
        next.push(importer);
      }
    }
    frontier = next;
  }
  return seen;
}

// ── PR doc-conflict analysis (`impact --prs`) ───────────────────────────────
//
// Two open PRs whose changed files impact the SAME canonical doc are a
// merge-order risk: whichever lands second must re-verify (and often re-edit)
// a doc the first one already changed the ground truth for. The graph-
// community version of this idea ships in graphify's `prs --conflicts`; this
// is the doc-integrity equivalent, computed from DocGuard's own code→doc
// reference index. Pure function — the `gh` plumbing stays at the edge.

/**
 * @param {Array<{number:number,title:string,files:string[]}>} prs
 * @param {Map<string,string[]>} docsIndex  docName → lines[]
 * @returns {{prImpacts: Array, conflicts: Array}}
 */
export function computeDocConflicts(prs, docsIndex) {
  const prImpacts = prs.map(pr => {
    const docs = new Set();
    for (const f of pr.files) {
      if (!CODE_EXTENSIONS.test(f)) {
        // A PR that edits a canonical doc directly impacts that doc too.
        if (f.endsWith('.md') && docsIndex.has(basename(f))) docs.add(basename(f));
        continue;
      }
      for (const r of findReferences(f, docsIndex)) docs.add(r.doc);
    }
    return { number: pr.number, title: pr.title, docs: [...docs].sort() };
  });

  const conflicts = [];
  for (let i = 0; i < prImpacts.length; i++) {
    for (let j = i + 1; j < prImpacts.length; j++) {
      const shared = prImpacts[i].docs.filter(d => prImpacts[j].docs.includes(d));
      if (shared.length > 0) {
        conflicts.push({ prs: [prImpacts[i].number, prImpacts[j].number], docs: shared });
      }
    }
  }
  return { prImpacts, conflicts };
}

const MAX_PRS = 20; // keep the per-PR file fetches bounded

/** Fetch open PRs + their changed files via the gh CLI. Throws with a human message. */
function fetchOpenPrs(projectDir) {
  const gh = (args) => execFileSync('gh', args, {
    cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  let list;
  try {
    list = JSON.parse(gh(['pr', 'list', '--state', 'open', '--json', 'number,title', '--limit', String(MAX_PRS)]));
  } catch (err) {
    const msg = String(err?.message || err);
    if (/ENOENT/.test(msg)) throw new Error('the GitHub CLI (gh) is not installed — install it or run impact without --prs');
    throw new Error(`gh pr list failed — is this repo on GitHub and gh authenticated? (${msg.split('\n')[0]})`);
  }
  return list.map(pr => {
    let files = [];
    try {
      files = JSON.parse(gh(['pr', 'view', String(pr.number), '--json', 'files']))
        .files.map(f => f.path);
    } catch { /* PR vanished mid-scan — treat as no files */ }
    return { number: pr.number, title: pr.title, files };
  });
}

function runPrConflicts(projectDir, flags, docsIndex) {
  const isJson = flags.format === 'json';
  let prs;
  try {
    prs = fetchOpenPrs(projectDir);
  } catch (err) {
    if (isJson) {
      console.log(JSON.stringify({ error: err.message, prs: [], conflicts: [] }, null, 2));
    } else {
      console.log(`  ${c.yellow}⚠ ${err.message}${c.reset}`);
    }
    return;
  }

  const { prImpacts, conflicts } = computeDocConflicts(prs, docsIndex);

  if (isJson) {
    console.log(JSON.stringify({ prs: prImpacts, conflicts, timestamp: new Date().toISOString() }, null, 2));
    return;
  }

  console.log(`${c.bold}📊 DocGuard Impact — open-PR doc conflicts${c.reset}\n`);
  if (prImpacts.length === 0) {
    console.log(`  ${c.green}✅ No open PRs.${c.reset}`);
    return;
  }
  for (const pr of prImpacts) {
    const docsNote = pr.docs.length > 0 ? pr.docs.join(', ') : `${c.dim}no canonical-doc impact${c.reset}`;
    console.log(`  ${c.cyan}#${pr.number}${c.reset} ${pr.title.slice(0, 60)} ${c.dim}→${c.reset} ${docsNote}`);
  }
  if (conflicts.length === 0) {
    console.log(`\n  ${c.green}✅ No two open PRs impact the same canonical doc.${c.reset}`);
    return;
  }
  console.log(`\n  ${c.yellow}⚠ ${conflicts.length} doc-conflict pair(s) — merge order matters:${c.reset}`);
  for (const cf of conflicts) {
    console.log(`  ${c.yellow}#${cf.prs[0]} × #${cf.prs[1]}${c.reset} both impact ${c.cyan}${cf.docs.join(', ')}${c.reset}`);
  }
  console.log(`  ${c.dim}Whichever lands second should re-run docguard impact before updating the shared doc(s).${c.reset}`);
}

export function runImpact(projectDir, config, flags) {
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

  // Index canonical docs once, PLUS root agent-instruction files (they name
  // code and other docs, so they belong in both code→doc and doc→doc analysis).
  const docsDir = resolve(projectDir, 'docs-canonical');
  const docsIndex = new Map(); // docName → lines[]
  const agentDocs = new Set(); // which indexed docs are agent-instruction files
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
  for (const a of AGENT_FILES) {
    const p = resolve(projectDir, a);
    if (!existsSync(p)) continue;
    try { docsIndex.set(a, readFileSync(p, 'utf-8').split('\n')); agentDocs.add(a); } catch { /* skip */ }
  }

  // `impact --prs`: cross-PR doc-conflict analysis instead of a --since diff.
  if (flags.prs) {
    runPrConflicts(projectDir, flags, docsIndex);
    return;
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
    isAgentFile: agentDocs.has(doc),
  }));

  // ── Indirect impact: docs about the IMPORTERS of a changed file ──
  // Reverse-import BFS (2 hops max). A doc already directly affected by the
  // same changed file is not repeated here — direct wins.
  const indirectDocs = [];
  if (flags.indirect !== false && codeChanged.length > 0) {
    const graph = buildImportGraph(projectDir, config || {});
    if (graph.edges.length > 0) {
      const reverseEdges = new Map(); // to → [from…]
      const outDegree = new Map();    // from → number of imports
      for (const e of graph.edges) {
        if (!reverseEdges.has(e.to)) reverseEdges.set(e.to, []);
        reverseEdges.get(e.to).push(e.from);
        outDegree.set(e.from, (outDegree.get(e.from) || 0) + 1);
      }
      // Hub suppression (dogfooded): an orchestrator that imports many modules
      // (a CLI dispatcher, a barrel index) would flag its docs on EVERY
      // dependency change — recurring noise, not signal. Its doc-relevant
      // surface rarely shifts when one of 30 imports does.
      const HUB_OUT_DEGREE = 15;
      const isHub = (f) => (outDegree.get(f) || 0) > HUB_OUT_DEGREE;
      const changedSet = new Set(codeChanged.map(f => f.replace(/^\.\//, '')));
      const indirectMap = new Map(); // doc → chains[]
      for (const f of codeChanged) {
        const norm = f.replace(/^\.\//, '');
        const directDocs = new Set(
          (fileImpact.find(fi => fi.file === f)?.references || []).map(r => r.doc));
        for (const [ancestor, hops] of reverseImportAncestors(norm, reverseEdges)) {
          if (changedSet.has(ancestor)) continue; // changed files have their own direct row
          if (isHub(ancestor)) continue;          // hub modules: noise, not signal
          for (const r of findReferences(ancestor, docsIndex)) {
            if (directDocs.has(r.doc)) continue;
            if (!indirectMap.has(r.doc)) indirectMap.set(r.doc, []);
            const chains = indirectMap.get(r.doc);
            if (!chains.some(ch => ch.changed === norm && ch.via === ancestor)) {
              chains.push({ changed: norm, via: ancestor, hops });
            }
          }
        }
      }
      for (const [doc, chains] of indirectMap) {
        indirectDocs.push({ doc, isAgentFile: agentDocs.has(doc), chains });
      }
    }
  }

  // ── Doc→doc blast radius: a changed DOC flags the docs that reference it ──
  // (including agent-instruction files that point at it). Only meaningful edges
  // are emitted (changed doc with ≥1 dependent).
  //
  // A source must be an INDEXED canonical/agent doc — not any changed `.md`.
  // Otherwise a CHANGELOG.md / README.md / .wolf/*.md change flags every doc
  // that merely mentions it in passing (dogfooding false positives).
  const indexBasenames = new Set(docsIndex.keys());
  const changedDocs = changed.filter(f => f.endsWith('.md') && indexBasenames.has(basename(f)));
  const blastRadius = [];
  for (const cd of changedDocs) {
    const dependents = docsReferencing(cd, docsIndex);
    if (dependents.length > 0) {
      blastRadius.push({
        changedDoc: cd,
        dependents: dependents.map(d => ({ doc: d, isAgentFile: agentDocs.has(d) })),
      });
    }
  }

  // ── JSON output ──
  if (isJson) {
    console.log(JSON.stringify({
      since,
      changedFiles: codeChanged,
      changedDocs,
      ignoredFiles: changed.filter(f => !CODE_EXTENSIONS.test(f) && !f.endsWith('.md')),
      affectedDocs,
      indirectDocs,
      blastRadius,
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

  // Doc→doc blast radius — shown whether or not code changed (a doc-only change
  // can still ripple to the docs / agent files that reference it).
  const printBlast = () => {
    if (blastRadius.length === 0) return;
    console.log(`\n  ${c.bold}🌐 Doc blast radius${c.reset} ${c.dim}(${changedDocs.length} doc(s) changed)${c.reset}`);
    for (const { changedDoc, dependents } of blastRadius) {
      console.log(`  ${c.cyan}${changedDoc}${c.reset} ${c.dim}changed → review ${dependents.length} dependent doc(s):${c.reset}`);
      for (const dep of dependents.slice(0, 8)) {
        const tag = dep.isAgentFile ? ` ${c.yellow}[agent-instruction]${c.reset}` : '';
        console.log(`     ${c.dim}↳${c.reset} ${dep.doc}${tag}`);
      }
      if (dependents.length > 8) console.log(`     ${c.dim}... ${dependents.length - 8} more${c.reset}`);
    }
  };

  if (codeChanged.length === 0) {
    console.log(`  ${c.dim}No code files changed (${changedDocs.length} doc(s) + ${changed.length - changedDocs.length} other non-code file(s)).${c.reset}`);
    if (blastRadius.length === 0 && changedDocs.length > 0) {
      console.log(`  ${c.green}✅ No other docs reference the changed doc(s).${c.reset}`);
    }
    printBlast();
    return;
  }

  console.log(`  ${c.cyan}${codeChanged.length}${c.reset} code file(s) changed.\n`);

  if (affectedDocs.length === 0) {
    console.log(`  ${c.yellow}⚠ No canonical docs reference any of the changed files.${c.reset}`);
    console.log(`  ${c.dim}This often means the changed code is undocumented. Consider:${c.reset}`);
    console.log(`  ${c.dim}  - Running ${c.cyan}docguard generate --plan${c.dim} to add doc skeletons${c.reset}`);
    console.log(`  ${c.dim}  - Reviewing whether the change belongs in an existing doc${c.reset}`);
  } else {
    console.log(`  ${c.green}${affectedDocs.length}${c.reset} canonical doc(s) reference the changed files:\n`);
    for (const { doc, files, isAgentFile } of affectedDocs) {
      const tag = isAgentFile ? ` ${c.yellow}[agent-instruction]${c.reset}` : '';
      console.log(`  ${c.cyan}${doc}${c.reset}${tag} ${c.dim}(${files.length} file${files.length > 1 ? 's' : ''})${c.reset}`);
      for (const f of files.slice(0, 5)) {
        console.log(`     ${c.dim}via${c.reset} ${f}`);
      }
      if (files.length > 5) console.log(`     ${c.dim}... ${files.length - 5} more${c.reset}`);
    }
  }

  // Indirect impact — docs about modules that import a changed file.
  if (indirectDocs.length > 0) {
    console.log(`\n  ${c.bold}↺ Indirect impact${c.reset} ${c.dim}(docs about modules that import the changed files)${c.reset}`);
    for (const { doc, isAgentFile, chains } of indirectDocs.slice(0, 8)) {
      const tag = isAgentFile ? ` ${c.yellow}[agent-instruction]${c.reset}` : '';
      console.log(`  ${c.cyan}${doc}${c.reset}${tag}`);
      for (const ch of chains.slice(0, 3)) {
        console.log(`     ${c.dim}↳ describes${c.reset} ${ch.via}${c.dim}, which imports${c.reset} ${ch.changed} ${c.dim}(${ch.hops} hop${ch.hops > 1 ? 's' : ''})${c.reset}`);
      }
      if (chains.length > 3) console.log(`     ${c.dim}... ${chains.length - 3} more chain(s)${c.reset}`);
    }
    if (indirectDocs.length > 8) console.log(`  ${c.dim}... ${indirectDocs.length - 8} more doc(s)${c.reset}`);
  }

  // List code files with NO doc references — these may need new docs
  const orphaned = fileImpact.filter(fi => fi.references.length === 0).map(fi => fi.file);
  if (orphaned.length > 0) {
    console.log(`\n  ${c.yellow}${orphaned.length} changed file(s) have NO canonical doc reference:${c.reset}`);
    for (const f of orphaned.slice(0, 5)) console.log(`     ${c.dim}• ${f}${c.reset}`);
    if (orphaned.length > 5) console.log(`     ${c.dim}... ${orphaned.length - 5} more${c.reset}`);
    console.log(`  ${c.dim}These may be undocumented — review whether they belong in an existing doc.${c.reset}`);
  }

  printBlast();
}
