/**
 * Per-reference staleness (specs/095-recorded-document-reviews FR-005).
 *
 * For each file a document references: the share of the file's current lines
 * added since the document last looked at it. The base is the review point,
 * or the commit that last changed the referencing line when that is later
 * (a line rewritten after the review was looked at then).
 *
 * Cost: one `git diff --numstat` from the review point covers every reference;
 * only a reference that crosses the threshold from there AND whose line was
 * edited after the review is re-measured from that line's commit. The
 * document itself is blamed only in that case. Numstat ranked references the
 * same as blame on the Stage 1 sample at a fraction of the cost.
 *
 * @implements docguard.recorded-document-reviews#FR-005
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runGit } from '../shared-git.mjs';

const lineCount = text => { const n = text.split('\n').length; return text.endsWith('\n') ? n - 1 : n; };

/** The last commit on or before the end of a YYYY-MM-DD day, on HEAD's history. */
export function commitAtEndOfDay(projectDir, date) {
  const r = runGit(projectDir, ['rev-list', '-1', `--before=${date}T23:59:59Z`, 'HEAD'], { operation: 'git rev-list (review point)', answers: [0] });
  const sha = (r.stdout || '').trim();
  return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

export function commitExists(projectDir, revision) {
  const r = runGit(projectDir, ['cat-file', '-e', `${revision}^{commit}`], { operation: 'git cat-file (review point)', stdio: 'ignore' });
  return r.status === 0 && !r.error;
}

export function commitTime(projectDir, revision) {
  const r = runGit(projectDir, ['show', '-s', '--format=%ct', revision], { operation: 'git show (commit time)', answers: [0] });
  return Number((r.stdout || '').trim()) || 0;
}

/** Numstat and added files between `base` and HEAD, keyed by current path. */
function diffSince(projectDir, base, cache) {
  if (cache.has(base)) return cache.get(base);
  const out = { numstat: new Map(), added: new Set(), ok: true };
  // One spawn: numstat for the counts, --summary for the files that are new.
  const ns = runGit(projectDir, ['diff', '-z', '-M', '--numstat', '--summary', base, 'HEAD'], { operation: 'git diff --numstat (reference staleness)', answers: [0], maxBuffer: 64 * 1024 * 1024 });
  if (ns.status !== 0) { out.ok = false; cache.set(base, out); return out; }
  // -z numstat: "added\tdeleted\tpath\0" or, for a rename, "added\tdeleted\t\0old\0new\0";
  // the summary follows as newline-separated " create mode <mode> <path>" lines.
  const parts = ns.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const chunk = parts[i];
    const m = chunk.match(/^(-|\d+)\t(-|\d+)\t(.*)$/s);
    if (m) {
      let path = m[3];
      if (path === '') { path = parts[i + 2]; i += 2; }
      out.numstat.set(path, { added: m[1] === '-' ? null : Number(m[1]), deleted: m[2] === '-' ? null : Number(m[2]) });
      continue;
    }
    for (const line of chunk.split('\n')) {
      const c = line.match(/^ create mode \d+ (.+)$/);
      if (c) out.added.add(c[1]);
    }
  }
  cache.set(base, out);
  return out;
}

/** Per line of a document at HEAD: { commit, time }. Uncommitted lines are the newest. */
function blameDocument(projectDir, doc) {
  const r = runGit(projectDir, ['blame', '--line-porcelain', 'HEAD', '--', doc], { operation: 'git blame (referencing line)', answers: [0], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;
  const lines = [];
  let cur = null;
  const times = new Map();
  for (const l of r.stdout.split('\n')) {
    const h = l.match(/^([0-9a-f]{40,64}) \d+ (\d+)/);
    if (h) { cur = h[1]; lines[Number(h[2])] = cur; continue; }
    const t = l.match(/^committer-time (\d+)/);
    if (t && cur && !times.has(cur)) times.set(cur, Number(t[1]));
  }
  return { lines, times };
}

function measureOne(projectDir, path, base, cache) {
  const diff = diffSince(projectDir, base, cache);
  if (!diff.ok) return null;
  let text;
  try { text = readFileSync(resolve(projectDir, path), 'utf8'); } catch { return null; }
  const total = lineCount(text);
  if (diff.added.has(path)) return { added: total, deleted: 0, total, share: 1, newSinceBase: true };
  const n = diff.numstat.get(path);
  if (!n) return { added: 0, deleted: 0, total, share: 0, newSinceBase: false };
  if (n.added === null) return null; // binary
  return { added: n.added, deleted: n.deleted, total, share: total ? Math.min(1, n.added / total) : 0, newSinceBase: false };
}

/**
 * @param {{ path, line }[]} references
 * @param {{ revision, time }} reviewPoint
 * @returns {{ references: object[], measured: boolean }}
 */
export function measureReferences(projectDir, doc, references, reviewPoint, { threshold = 0.5, cache = new Map() } = {}) {
  const out = [];
  let blame;
  let measured = true;
  for (const ref of references) {
    let m = measureOne(projectDir, ref.path, reviewPoint.revision, cache);
    if (!m) { measured = false; continue; }
    let base = reviewPoint.revision;
    if (m.share >= threshold) {
      // Only a candidate pays for the blame: was its line rewritten after the review?
      if (blame === undefined) blame = blameDocument(projectDir, doc);
      const lineCommit = blame?.lines[ref.line];
      const lineTime = lineCommit ? (blame.times.get(lineCommit) ?? 0) : 0;
      const isUncommitted = lineCommit && /^0+$/.test(lineCommit);
      if (isUncommitted) { m = { ...m, added: 0, share: 0, newSinceBase: false }; base = 'working tree'; }
      else if (lineCommit && lineTime > reviewPoint.time) {
        const again = measureOne(projectDir, ref.path, lineCommit, cache);
        if (again) { m = again; base = lineCommit; }
      }
    }
    out.push({ ...ref, ...m, base });
  }
  out.sort((a, b) => b.share - a.share || a.path.localeCompare(b.path));
  return { references: out, measured };
}

/** Package scripts and top-level tracked directories at a revision. */
export function surfaceAt(projectDir, revision) {
  const scripts = new Set();
  const pkg = runGit(projectDir, ['show', `${revision}:package.json`], { operation: 'git show (package.json at review)' });
  if (pkg.status === 0) {
    try { for (const k of Object.keys(JSON.parse(pkg.stdout).scripts || {})) scripts.add(k); } catch { /* not JSON then */ }
  }
  const dirs = new Set();
  const tree = runGit(projectDir, ['ls-tree', '-d', '--name-only', '-z', revision], { operation: 'git ls-tree (top-level dirs at review)', answers: [0] });
  for (const d of (tree.stdout || '').split('\0').filter(Boolean)) if (!d.startsWith('.')) dirs.add(d);
  return { scripts, dirs, packageAtReview: pkg.status === 0 };
}

/** Current package scripts and top-level tracked directories. */
export function surfaceNow(projectDir, tracked) {
  const scripts = new Set();
  try {
    const pkg = JSON.parse(readFileSync(resolve(projectDir, 'package.json'), 'utf8'));
    const all = Object.keys(pkg.scripts || {});
    for (const k of all) {
      const base = k.replace(/^(pre|post)/, '');
      if (base !== k && all.includes(base)) continue; // a hook of an existing script
      scripts.add(k);
    }
  } catch { /* no package.json */ }
  const dirs = new Set(tracked.filter(f => f.includes('/')).map(f => f.split('/')[0]).filter(d => !d.startsWith('.')));
  return { scripts, dirs };
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `text` mentions a package script or a top-level directory. */
export function mentionsScript(text, name) {
  const n = esc(name);
  return new RegExp(`(?:npm|pnpm|yarn|bun)\\s+(?:run\\s+)?${n}(?![\\w:-])|\`${n}\``).test(text);
}
export function mentionsDir(text, name) {
  return new RegExp(`(^|[^\\w.-])${esc(name)}(/|(?![\\w-]))`, 'm').test(text);
}
