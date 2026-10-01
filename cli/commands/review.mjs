/**
 * `docguard review` — the doc dependency lock's only writer.
 *
 * Spec: specs/030-doc-dependency-lock (docguard.doc-dependency-lock).
 *
 *   docguard review [--format json]                       list covered sections and their state
 *   docguard review --accept <doc>#<id>|<doc> --reason …  record a review (fingerprints, HEAD, date)
 *   docguard review --prune                               drop lock entries whose section is gone
 *   docguard review --suggest <doc> [--format json]       propose covers= values; never writes
 *
 * Accepting is a human (or agent) statement that the prose was checked
 * against the code, so it requires a reason. sync, fix and generate never
 * write the lock (FR-005).
 *
 * @implements docguard.doc-dependency-lock#FR-005
 * @implements docguard.doc-dependency-lock#FR-006
 * @implements docguard.output-ux#FR-012
 */

import { loadOwnership } from '../scanners/doc-ownership.mjs';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { c } from '../shared.mjs';
import { commitFileTransaction } from '../writers/file-transaction.mjs';
import {
  acceptedEntry, candidateDocs, coveredSections, createContext, docLockStatus, DOC_LOCK_PATH,
  readLock, serializeLock,
} from '../scanners/doc-deps.mjs';

const STATE_ICON = { current: '✅', changed: '⚠️ ', 'missing-dependency': '❌', unaccepted: '○ ', unverifiable: '? ', empty: '○ ' };
const EXIT = { current: 0 };

function headRevision(projectDir) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

function writeLock(projectDir, lock) {
  const path = resolve(projectDir, DOC_LOCK_PATH);
  commitFileTransaction([{ path, content: serializeLock(lock) }], {
    validate: () => {
      const back = readLock(projectDir);
      if (back.error) throw new Error(back.error);
    },
  });
}

function acceptSections(projectDir, config, flags) {
  const reason = String(flags.reason || '').replace(/\s+/g, ' ').trim();
  if (reason.length < 8 || reason.length > 500) throw new Error('review --accept requires --reason with 8-500 characters: say what you checked.');
  const target = String(flags.accept);
  const [doc, id] = target.includes('#') ? [target.slice(0, target.indexOf('#')), target.slice(target.indexOf('#') + 1)] : [target, null];
  if (!candidateDocs(projectDir, config).includes(doc)) throw new Error(`${doc} is not a canonical doc, README.md or AGENTS.md.`);
  const sections = coveredSections(readFileSync(resolve(projectDir, doc), 'utf8')).filter(s => !id || s.id === id);
  if (!sections.length) throw new Error(id ? `${doc} has no section ${id} with covers=.` : `${doc} has no section with covers=.`);
  const { lock, error } = readLock(projectDir);
  if (error) throw new Error(`${error} — restore it from git or delete it before accepting.`);
  const ctx = createContext(projectDir, config);
  const entryBase = { reason, revision: headRevision(projectDir), date: new Date().toISOString().slice(0, 10) };
  const accepted = [];
  for (const section of sections) {
    lock.sections[`${doc}#${section.id}`] = acceptedEntry(ctx, section, entryBase);
    accepted.push(`${doc}#${section.id}`);
  }
  writeLock(projectDir, lock);
  return { command: 'review', action: 'accept', status: 'ACCEPTED', accepted };
}

function pruneLock(projectDir, config) {
  const status = docLockStatus(projectDir, config);
  if (status.lockError) throw new Error(status.lockError);
  if (!status.orphans.length) return { command: 'review', action: 'prune', status: 'CURRENT', pruned: [] };
  const { lock } = readLock(projectDir);
  for (const orphan of status.orphans) delete lock.sections[orphan.key];
  writeLock(projectDir, lock);
  return { command: 'review', action: 'prune', status: 'PRUNED', pruned: status.orphans.map(o => o.key) };
}

/**
 * Low-confidence proposals: existing file paths a section already mentions.
 * Sections are the covered ones plus every `## ` heading block.
 */
export function suggestCovers(projectDir, doc, config = {}) {
  const content = readFileSync(resolve(projectDir, doc), 'utf8');
  const blocks = [];
  let current = { heading: '(preamble)', lines: [] };
  let fence = null;
  for (const line of content.split('\n')) {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) { if (m && m[1][0] === fence[0]) fence = null; continue; }
    if (m) { fence = m[1]; continue; }
    if (/^##\s+/.test(line)) { blocks.push(current); current = { heading: line.replace(/^##\s+/, '').trim(), lines: [] }; continue; }
    current.lines.push(line);
  }
  blocks.push(current);
  const out = [];
  for (const block of blocks) {
    const paths = new Set();
    for (const m of block.lines.join('\n').matchAll(/`((?:[\w.@-]+\/)+[\w.@-]+\.[A-Za-z]\w{0,9})`/g)) {
      const rel = m[1];
      if (!rel.includes('..') && existsSync(resolve(projectDir, rel))) paths.add(rel);
    }
    if (paths.size) out.push({ heading: block.heading, covers: [...paths].sort(), confidence: 'low' });
  }
  // docguard.doc-ownership-map#FR-004: what the ownership map says this doc's
  // sections are responsible for. Still low confidence: owning a directory
  // is not describing each symbol in it.
  const map = loadOwnership(projectDir, config);
  if (map.present && !map.error) {
    for (const entry of map.entries.filter(e => e.doc === doc.replace(/^\.\//, ''))) {
      out.push({ heading: entry.section ? `#${entry.section} (ownership)` : '(ownership)', covers: entry.patterns.map(p => p.raw).sort(), confidence: 'low', source: 'ownership' });
    }
  }
  return out;
}

function printStatus(status) {
  console.log(`${c.bold}📌 Doc dependency lock${c.reset} ${c.dim}(${DOC_LOCK_PATH})${c.reset}\n`);
  if (status.lockError) { console.log(`  ${c.red}✗ ${status.lockError}${c.reset}`); return; }
  if (!status.sections.length && !status.orphans.length) {
    console.log(`  ${c.dim}No section declares covers=. Add covers="path#symbol" to a docguard:section marker to track the code it describes.${c.reset}`);
    return;
  }
  for (const s of status.sections) {
    console.log(`  ${STATE_ICON[s.state] || '  '} ${s.key} — ${s.state}`);
    for (const d of s.deps) if (d.state !== 'current') console.log(`       ${c.dim}${d.ref}: ${d.state}${d.reason ? ` (${d.reason})` : ''}${c.reset}`);
  }
  for (const o of status.orphans) console.log(`  🗑  ${o.key} — no such section (docguard review --prune)`);
}

export function runReview(projectDir, config, flags = {}) {
  try {
    let result;
    if (flags.accept) result = acceptSections(projectDir, config, flags);
    else if (flags.prune) result = pruneLock(projectDir, config);
    else if (flags.suggest) {
      if (flags.suggest === true) throw new Error('Usage: docguard review --suggest <doc> — name the document to propose covers= values for.');
      const doc = String(flags.suggest);
      if (!candidateDocs(projectDir, config).includes(doc)) throw new Error(`${doc} is not a canonical doc, README.md or AGENTS.md.`);
      result = { command: 'review', action: 'suggest', status: 'SUGGESTED', doc, suggestions: suggestCovers(projectDir, doc, config), note: 'Low-confidence: paths the text mentions. Declare only what the section actually describes.' };
    } else {
      const status = docLockStatus(projectDir, config);
      const worst = status.lockError ? 'UNREADABLE'
        : status.sections.some(s => s.state !== 'current') || status.orphans.length ? 'REVIEW' : 'CURRENT';
      result = { command: 'review', action: 'status', status: worst, lockError: status.lockError, sections: status.sections.map(s => ({ key: s.key, state: s.state, dependencies: s.deps.map(d => ({ ref: d.ref, tier: d.tier, state: d.state })) })), orphans: status.orphans.map(o => o.key) };
      if (flags.format !== 'json') printStatus(status);
      process.exitCode = worst === 'UNREADABLE' ? 1 : worst === 'REVIEW' ? 2 : EXIT.current;
      if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
      return result;
    }
    if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
    else if (result.action === 'suggest') {
      console.log(`${c.bold}Suggested covers= for ${result.doc}${c.reset} ${c.dim}(${result.note})${c.reset}\n`);
      for (const s of result.suggestions) console.log(`  ## ${s.heading}\n    covers="${s.covers.join(', ')}"`);
    } else if (result.action === 'prune' && result.pruned.length === 0) {
      console.log(`${c.green}✓ Nothing to prune${c.reset} ${c.dim}— every lock entry still has its section.${c.reset}`);
    } else console.log(`${c.green}✓ ${result.status}${c.reset} ${(result.accepted || result.pruned || []).join(', ')}`);
    return result;
  } catch (error) {
    if (flags.format === 'json') console.log(JSON.stringify({ command: 'review', status: 'ERROR', error: error.message }, null, 2));
    else console.error(`${c.red}✗${c.reset} ${error.message}`);
    process.exitCode = 1;
    return { command: 'review', status: 'ERROR', error: error.message };
  }
}
