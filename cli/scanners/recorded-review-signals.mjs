/**
 * Freshness signals from recorded reviews and per-reference staleness
 * (specs/095-recorded-document-reviews).
 *
 *   FRS006  an agent-instruction document names a file most of whose lines
 *           were added since the document's review (and, with a recorded
 *           review, whose fingerprint changed)
 *   FRS007  package scripts / top-level directories added since the review
 *           that the document never mentions
 *   FRS008  an agent-instruction document with no review record
 *   FRS009  a review marker advanced past a recorded review by a commit that
 *           changed nothing else in the document
 *   FRS010  the reviews file cannot be read: every recorded review is unusable
 *
 * Canonical documents get no FRS006: their FRS002/FRS003 carries the same
 * evidence as `staleness` (FR-007). Widening FRS006 to another role waits for
 * benchmark evidence for that role.
 *
 * @implements docguard.recorded-document-reviews#FR-006
 * @implements docguard.recorded-document-reviews#FR-007
 * @implements docguard.recorded-document-reviews#FR-008
 * @implements docguard.recorded-document-reviews#FR-009
 */

import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { agentInstructionDocs } from '../shared-agent-instructions.mjs';
import { listTrackedFiles, runGit } from '../shared-git.mjs';
import { createContext, fingerprint } from './doc-deps.mjs';
import { DOC_REVIEWS_PATH, documentReferences, readDocReviews } from './doc-reviews.mjs';
import {
  commitAtEndOfDay, commitExists, commitTime, measureReferences, mentionsDir, mentionsScript, surfaceAt, surfaceNow,
} from './reference-staleness.mjs';

export const DEFAULT_REFERENCE_SHARE = 0.5;
const MARKER_RE = /<!--\s*docguard:last-reviewed\s+(\d{4}-\d{2}-\d{2})\s*-->/;
const pct = x => `${Math.round(x * 100)}%`;

const reviewsCache = new Map();
function reviewsFor(dir) {
  const abs = resolve(dir);
  let key = `${abs}:none`;
  try { const st = lstatSync(resolve(abs, DOC_REVIEWS_PATH)); key = `${abs}:${st.mtimeMs}:${st.size}`; } catch { /* absent */ }
  if (!reviewsCache.has(key)) reviewsCache.set(key, readDocReviews(abs));
  return reviewsCache.get(key);
}

/** The recorded review date of a document, as a Date, or null. */
export function recordedReviewDate(dir, doc) {
  const entry = reviewsFor(dir).reviews?.documents?.[doc];
  if (!entry) return null;
  const d = new Date(`${entry.reviewedAt}T00:00:00Z`);
  return isNaN(d.getTime()) || d.getTime() > Date.now() ? null : d;
}

export function laterDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

function markerDate(content) {
  const m = String(content).match(MARKER_RE);
  if (!m) return null;
  const d = new Date(`${m[1]}T00:00:00Z`);
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[1] || d.getTime() > Date.now() ? null : m[1];
}

/** The referenceShare threshold from config, or the default. */
export function referenceShare(config) {
  const v = config?.freshness?.referenceShare;
  return typeof v === 'number' && v > 0 && v <= 1 ? v : DEFAULT_REFERENCE_SHARE;
}

/** The commit that last set the marker line, and whether it changed anything else in the document. */
function markerOnlyCommit(dir, doc, content) {
  const lineNo = String(content).split('\n').findIndex(l => MARKER_RE.test(l)) + 1;
  if (!lineNo) return null;
  const b = runGit(dir, ['blame', '--porcelain', '-L', `${lineNo},${lineNo}`, 'HEAD', '--', doc], { operation: 'git blame (review marker)', answers: [0] });
  const commit = (b.stdout || '').match(/^([0-9a-f]{40,64}) /)?.[1];
  if (!commit || /^0+$/.test(commit)) return null;
  const d = runGit(dir, ['show', '--format=', '--unified=0', commit, '--', doc], { operation: 'git show (review marker commit)', answers: [0], maxBuffer: 16 * 1024 * 1024 });
  const changed = (d.stdout || '').split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l));
  const other = changed.filter(l => !MARKER_RE.test(l) && l.slice(1).trim() !== '');
  return { commit, markerOnly: changed.length > 0 && other.length === 0 };
}

/**
 * @returns {object[]} freshness result entries ({ status, code, doc, message, … })
 */
export function recordedReviewSignals(dir, config, { ignored, docFiles, results }) {
  const out = [];
  const read = reviewsFor(dir);
  if (read.error) {
    out.push({
      status: 'fail', code: 'FRS010', doc: DOC_REVIEWS_PATH, confidence: 'high', disposition: 'act',
      message: `${read.error}; every recorded document review is unusable, so review evidence falls back to markers`,
      suggestion: { kind: 'fix', text: `Restore ${DOC_REVIEWS_PATH} from git (git checkout -- ${DOC_REVIEWS_PATH}), or delete it and record reviews again with docguard review --accept <doc> --reason "…". Put a new field under "extensions".` },
    });
  }
  const recorded = read.reviews?.documents || {};
  const threshold = referenceShare(config);
  const role = agentInstructionDocs(dir, config).docs;
  const authored = role.filter(d => !d.pointer && !d.vendored && !ignored(d.path));
  const vendored = new Set(role.filter(d => d.vendored).map(d => d.path));
  const pointerText = new Map();
  for (const d of role.filter(x => x.pointer?.target)) {
    try { pointerText.set(d.pointer.target, `${pointerText.get(d.pointer.target) || ''}\n${readFileSync(resolve(dir, d.path), 'utf8')}`); } catch { /* unreadable pointer */ }
  }
  const tracked = listTrackedFiles(dir);
  if (tracked === null) return out; // git unavailable: the history-based checks above already skipped
  const roleSet = new Set(authored.map(d => d.path));
  const trackedSet = new Set(tracked);
  const canonical = docFiles.filter(f => !roleSet.has(f) && !vendored.has(f));
  const cache = new Map();
  let fpCtx = null;
  const fpChanged = (path, rec) => {
    if (!rec) return true; // named after the review: no fingerprint to compare
    fpCtx ||= createContext(dir, config);
    const now = fingerprint(fpCtx, path, { preferTier: rec.tier });
    return !now.ok || now.fingerprint !== rec.fingerprint;
  };

  // One run, one HEAD: cache what several documents share (a review date, a commit's time).
  const eod = new Map();
  const times = new Map();
  const endOfDay = date => { if (!eod.has(date)) eod.set(date, commitAtEndOfDay(dir, date)); return eod.get(date); };
  const timeOf = rev => { if (!times.has(rev)) times.set(rev, commitTime(dir, rev)); return times.get(rev); };
  const reviewPointOf = (doc, content) => {
    const entry = recorded[doc];
    if (entry?.reviewedRevision) {
      if (!commitExists(dir, entry.reviewedRevision)) return { unavailable: `${doc}: the recorded review commit ${entry.reviewedRevision.slice(0, 12)} is not in this history (shallow clone or rewritten history)` };
      return { revision: entry.reviewedRevision, date: entry.reviewedAt, source: 'recorded', entry };
    }
    const marker = markerDate(content);
    if (marker) {
      const revision = endOfDay(marker);
      if (!revision) return { unavailable: `${doc}: no commit on or before its ${marker} review marker` };
      return { revision, date: marker, source: 'marker' };
    }
    return null;
  };

  const evidenceFor = (doc, content, point) => {
    const { references } = documentReferences(dir, doc, content, { tracked, vendored, config });
    const { references: measured, measured: complete } = measureReferences(dir, doc, references, { revision: point.revision, time: timeOf(point.revision) }, { threshold, cache });
    const crossing = measured.filter(r => r.share >= threshold && (point.source !== 'recorded' || fpChanged(r.path, point.entry.references?.[r.path])));
    return { measured, crossing, complete };
  };
  const describe = r => `L${r.line} ${r.path} ${pct(r.share)}${r.newSinceBase ? ' (did not exist then)' : ` (+${r.added}/−${r.deleted})`}`;

  for (const doc of authored) {
    let content;
    try { content = readFileSync(resolve(dir, doc.path), 'utf8'); } catch { continue; }
    const point = reviewPointOf(doc.path, content);
    if (point?.unavailable) { out.push({ status: 'skip', doc: doc.path, message: point.unavailable }); continue; }
    if (!point) {
      // An uncommitted file has FRS001 (no dated signal at all); FRS008 is for a
      // committed file that still has no review record: a commit is not a review.
      if (!trackedSet.has(doc.path)) continue;
      out.push({
        status: 'warn', code: 'FRS008', doc: doc.path, documentRole: 'agent-instruction', confidence: 'high', disposition: 'escalate',
        message: `${doc.path} — agent instructions with no review record: nothing says when, or against what, this file was last checked`,
        suggestion: { kind: 'review', text: `Read it against the code, then record the review: docguard review --accept ${doc.path} --reason "<what you checked>"` },
      });
      continue;
    }
    const { crossing, measured, complete } = evidenceFor(doc.path, content, point);
    if (!complete) out.push({ status: 'skip', doc: doc.path, message: `${doc.path}: some references could not be measured against ${point.revision.slice(0, 12)}` });
    if (crossing.length) {
      const top = crossing.slice(0, 3).map(describe).join('; ');
      const more = crossing.length > 3 ? `; and ${crossing.length - 3} more` : '';
      out.push({
        status: 'warn', code: 'FRS006', doc: `${doc.path}:${crossing[0].line}`, documentRole: 'agent-instruction', confidence: 'high', disposition: 'escalate',
        message: `${doc.path} names ${crossing.length} file(s) most of whose lines were added since its ${point.date} review${point.source === 'recorded' ? ' (recorded; fingerprint changed)' : ''}: ${top}${more}`,
        suggestion: { kind: 'review', text: `Read what ${doc.path} says about each file against the file now, update the document, then record the review: docguard review --accept ${doc.path} --reason "<what you checked>"` },
        staleness: { reviewPoint: { date: point.date, revision: point.revision, source: point.source }, threshold, references: crossing.slice(0, 10) },
      });
    }
    // FRS007: surface added since the review that the document never mentions.
    const then = surfaceAt(dir, point.revision);
    const now = surfaceNow(dir, tracked);
    // A file that tells agents to follow another instruction file (CLAUDE.md:
    // "Follow `AGENTS.md`") inherits that file's mentions.
    const followed = role.filter(r => r.path !== doc.path && new RegExp(`[\`(/]${r.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\`)]`).test(content))
      .map(r => { try { return readFileSync(resolve(dir, r.path), 'utf8'); } catch { return ''; } }).join('\n');
    const text = `${content}\n${pointerText.get(doc.path) || ''}\n${followed}`;
    const scripts = [...now.scripts].filter(s => !then.scripts.has(s) && !mentionsScript(text, s)).sort();
    const dirs = [...now.dirs].filter(d => !then.dirs.has(d) && !mentionsDir(text, d)).sort();
    if (scripts.length || dirs.length) {
      const parts = [scripts.length ? `package script(s) ${scripts.map(s => `\`${s}\``).join(', ')}` : '', dirs.length ? `top-level director${dirs.length > 1 ? 'ies' : 'y'} ${dirs.map(d => `\`${d}/\``).join(', ')}` : ''].filter(Boolean);
      out.push({
        status: 'warn', code: 'FRS007', doc: doc.path, documentRole: 'agent-instruction', confidence: 'high', disposition: 'escalate',
        message: `${doc.path} never mentions ${parts.join(' or ')}, added since its ${point.date} review`,
        suggestion: { kind: 'review', text: `Decide whether agents need to know about ${[...scripts, ...dirs.map(d => `${d}/`)].join(', ')}; say so in ${doc.path} (or record that it is irrelevant), then docguard review --accept ${doc.path} --reason "<what you checked>"` },
        surface: { scripts, dirs, reviewPoint: { date: point.date, revision: point.revision, source: point.source } },
      });
    }
    // FRS009: a marker advanced past a recorded review without one.
    const marker = markerDate(content);
    if (point.source === 'recorded' && marker && marker > point.date) {
      const m = markerOnlyCommit(dir, doc.path, content);
      if (m?.markerOnly) {
        out.push({
          status: 'warn', code: 'FRS009', doc: doc.path, documentRole: 'agent-instruction', confidence: 'high', disposition: 'escalate',
          message: `${doc.path} — review marker moved to ${marker} by ${m.commit.slice(0, 12)}, which changed nothing else in it; the last recorded review is ${point.date}, and staleness is still measured from it`,
          suggestion: { kind: 'review', text: `If the file was reviewed, record it: docguard review --accept ${doc.path} --reason "<what you checked>". A date alone does not say what was checked.` },
        });
      }
    }
    void measured;
  }

  // FR-007: canonical documents carry the evidence on their FRS002/FRS003.
  for (const doc of canonical) {
    const due = results.find(r => r.doc === doc && (r.code === 'FRS002' || r.code === 'FRS003'));
    if (!due) continue;
    let content;
    try { content = readFileSync(resolve(dir, doc), 'utf8'); } catch { continue; }
    const point = reviewPointOf(doc, content);
    if (!point || point.unavailable) continue;
    const { crossing } = evidenceFor(doc, content, point);
    due.documentRole = 'canonical';
    if (crossing.length) due.staleness = { reviewPoint: { date: point.date, revision: point.revision, source: point.source }, threshold, references: crossing.slice(0, 10) };
  }
  for (const r of results) if (!r.documentRole && r.doc && roleSet.has(r.doc)) r.documentRole = 'agent-instruction';
  return out;
}

/**
 * Stale references of one document named on lines `from`–`to`, for an
 * excerpt served to an agent (docguard.staleness-visibility#FR-004). Only a
 * document with a review point (recorded review or marker) is measured; the
 * same exclusions and threshold as FRS006 apply.
 * @returns {null | { reviewPoint, threshold, references: object[] }}
 */
export function excerptStaleness(dir, config, doc, from, to, { cache = new Map() } = {}) {
  let content;
  try { content = readFileSync(resolve(dir, doc), 'utf8'); } catch { return null; }
  const entry = reviewsFor(dir).reviews?.documents?.[doc];
  let point = null;
  if (entry?.reviewedRevision && commitExists(dir, entry.reviewedRevision)) point = { revision: entry.reviewedRevision, date: entry.reviewedAt, source: 'recorded' };
  else {
    const marker = markerDate(content);
    const revision = marker ? commitAtEndOfDay(dir, marker) : null;
    if (revision) point = { revision, date: marker, source: 'marker' };
  }
  if (!point) return null;
  const tracked = listTrackedFiles(dir);
  if (!tracked) return null;
  const vendored = new Set(agentInstructionDocs(dir, config).docs.filter(d => d.vendored).map(d => d.path));
  const { references } = documentReferences(dir, doc, content, { tracked, vendored, config });
  const inRange = references.filter(r => r.line >= from && r.line <= to);
  if (!inRange.length) return null;
  const threshold = referenceShare(config);
  const { references: measured } = measureReferences(dir, doc, inRange, { revision: point.revision, time: commitTime(dir, point.revision) }, { threshold, cache });
  let fpCtx = null;
  const crossing = measured.filter(r => r.share >= threshold && (point.source !== 'recorded' || (() => {
    const rec = entry.references?.[r.path];
    if (!rec) return true;
    fpCtx ||= createContext(dir, config);
    const now = fingerprint(fpCtx, r.path, { preferTier: rec.tier });
    return !now.ok || now.fingerprint !== rec.fingerprint;
  })()));
  if (!crossing.length) return null;
  return {
    reviewPoint: { date: point.date, revision: point.revision, source: point.source }, threshold,
    references: crossing.map(r => ({ path: r.path, line: r.line, share: Number(r.share.toFixed(4)), added: r.added, deleted: r.deleted, newSinceBase: r.newSinceBase })),
  };
}
