/**
 * The anchor lock: `.docguard-anchor-lock.jsonl`, the reviewed state of every
 * requirement link.
 *
 * Spec: specs/070-requirement-anchors (docguard.requirement-anchors).
 * Contract: specs/070-requirement-anchors/contracts/anchor-lock.md.
 *
 * JSON Lines, not JSON, because two branches that each review links of the
 * same spec must merge without a conflict: `.gitattributes` declares the file
 * `merge=union`, and a union merge works line by line. The cost of union is
 * that it keeps two different lines when both branches reviewed the same key.
 * The reader keeps every distinct line (`variants`) and the caller resolves
 * them against the link as it is now (`resolveEntry` in anchors.mjs): the line
 * whose fingerprints match is the review, the others are superseded. A
 * duplicate is never an error. Every writer writes one line per key.
 * Identical duplicates and a duplicated header (both sides keep it) collapse.
 * A lock that still carries git conflict markers is unreadable here (ANC005);
 * `docguard anchors merge --write` resolves it.
 * (Spec: specs/102-anchor-lock-merge, docguard.anchor-lock-merge#FR-001.)
 *
 * The lock records only the latest accept per key. Earlier accepts are in
 * `git log -p -- .docguard-anchor-lock.jsonl`, an audit trail with no cap.
 *
 * @implements docguard.requirement-anchors#FR-016
 * @implements docguard.requirement-anchors#FR-017
 * @implements docguard.requirement-anchors#FR-018
 * @implements docguard.anchor-lock-merge#FR-001
 * @implements docguard.anchor-lock-merge#FR-005
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ANCHOR_LOCK_PATH = '.docguard-anchor-lock.jsonl';
export const ANCHOR_LOCK_SCHEMA_VERSION = 1;
export const LOCK_HEADER = Object.freeze({ kind: 'docguard-anchor-lock', schemaVersion: ANCHOR_LOCK_SCHEMA_VERSION });
export const GITATTRIBUTES_LINE = `${ANCHOR_LOCK_PATH} merge=union`;
const MAX_LOCK_BYTES = 64 * 1024 * 1024;

const FP_RE = /^dg\d+:sha256:[0-9a-f]{64}$/;
const REVISION_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LINK_KEYS = new Set(['key', 'requirement', 'file', 'anchor', 'scope', 'tier', 'code', 'floor', 'req', 'prev', 'state', 'revision', 'date', 'reason', 'bulk']);
const DISPOSITION_KEYS = new Set(['key', 'file', 'anchor', 'kind', 'reason', 'date', 'revision', 'bulk']);
export const DISPOSITION_KINDS = Object.freeze(['derived', 'dead', 'infrastructure']);

/** Deterministic line: keys sorted at every level. */
export function stableLine(value) {
  const sort = v => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])]));
    return v;
  };
  return JSON.stringify(sort(value));
}

const reasonProblem = reason => (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500
  ? 'reason must be 10-500 characters' : null);

/** Why an entry is malformed, or null. */
export function entryProblem(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return 'must be an object';
  if (typeof entry.key !== 'string' || !entry.key) return 'key must be a non-empty string';
  if (entry.key.startsWith('disposition|')) {
    for (const k of Object.keys(entry)) if (!DISPOSITION_KEYS.has(k)) return `unknown field ${k}`;
    if (!DISPOSITION_KINDS.includes(entry.kind)) return `kind must be one of ${DISPOSITION_KINDS.join(', ')}`;
  } else {
    for (const k of Object.keys(entry)) if (!LINK_KEYS.has(k)) return `unknown field ${k}`;
    for (const k of ['requirement', 'file', 'anchor', 'scope', 'tier']) if (typeof entry[k] !== 'string' || !entry[k]) return `${k} must be a non-empty string`;
    if (!['file', 'symbol', 'statement', 'route'].includes(entry.scope)) return 'scope must be file, symbol, statement or route';
    for (const k of ['code', 'floor', 'req']) if (!FP_RE.test(entry[k] || '')) return `${k} must be a dg fingerprint`;
    if (entry.prev !== null && entry.prev !== undefined) {
      if (typeof entry.prev !== 'object') return 'prev must be an object or null';
      for (const k of ['code', 'floor', 'req']) if (!FP_RE.test(entry.prev[k] || '')) return `prev.${k} must be a dg fingerprint`;
    }
    if (!['reviewed', 'baselined'].includes(entry.state)) return 'state must be reviewed or baselined';
  }
  if (entry.revision !== null && !REVISION_RE.test(entry.revision || '')) return 'revision must be a full commit id or null';
  if (!DATE_RE.test(entry.date || '')) return 'date must be YYYY-MM-DD';
  const reason = reasonProblem(entry.reason);
  if (reason) return reason;
  if (typeof entry.bulk !== 'boolean') return 'bulk must be true or false';
  return null;
}

const MARKER_OPEN = /^<{7}(?: |$)/;
const MARKER_BASE = /^\|{7}(?: |$)/;
const MARKER_MID = /^={7}$/;
const MARKER_CLOSE = /^>{7}(?: |$)/;
const isMarker = text => MARKER_OPEN.test(text) || MARKER_BASE.test(text) || MARKER_MID.test(text) || MARKER_CLOSE.test(text);

/** The one thing to do about a lock that carries git conflict markers. */
export const MERGE_COMMAND = 'docguard anchors merge --write';

/**
 * Parse the lock's text. Pure: no file, no link, no clock.
 *
 * `markers: 'refuse'` (the reader) treats a git conflict marker as an error;
 * `markers: 'drop'` (`anchors merge`) keeps both sides, drops the marker lines
 * and the `|||||||` base section of a diff3 style, so a review removed on one
 * side is not resurrected from the common ancestor.
 *
 * @returns {{ error: string|null, byKey: Map<string, object[]>, entryLines: number, markersRemoved: number }}
 *   `byKey`: every key with its distinct entries (identical after key sorting
 *   count once), in file order.
 */
export function parseAnchorLock(raw, { markers = 'refuse' } = {}) {
  const lines = raw.split('\n');
  const byKey = new Map(); // key → [{ text, entry }]
  let header = false;
  let entryLines = 0;
  let markersRemoved = 0;
  let inBase = false;
  const headerText = stableLine(LOCK_HEADER);
  const failed = error => ({ error, byKey: new Map(), entryLines: 0, markersRemoved: 0 });
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text) continue;
    if (isMarker(text)) {
      if (markers !== 'drop') return failed(`${ANCHOR_LOCK_PATH}:${i + 1} is a git conflict marker; run \`${MERGE_COMMAND}\` to keep both sides and resolve them`);
      markersRemoved++;
      if (MARKER_BASE.test(text)) inBase = true;
      else if (MARKER_MID.test(text) || MARKER_CLOSE.test(text)) inBase = false;
      continue;
    }
    if (inBase) continue;
    let value;
    try { value = JSON.parse(text); } catch (e) {
      return failed(`${ANCHOR_LOCK_PATH}:${i + 1} is not valid JSON (${e.message})`);
    }
    if (value && value.kind !== undefined && value.key === undefined) {
      if (stableLine(value) !== headerText) {
        return failed(`${ANCHOR_LOCK_PATH}:${i + 1} has an unsupported header ${JSON.stringify(value)}; this DocGuard reads ${headerText}`);
      }
      header = true;
      continue;
    }
    const problem = entryProblem(value);
    if (problem) return failed(`${ANCHOR_LOCK_PATH}:${i + 1}: ${problem}`);
    entryLines++;
    const canonical = stableLine(value);
    const list = byKey.get(value.key) || [];
    if (!list.some(x => x.text === canonical)) list.push({ text: canonical, entry: value });
    byKey.set(value.key, list);
  }
  if (!header) return failed(`${ANCHOR_LOCK_PATH} has no header line ${headerText}`);
  return { error: null, byKey: new Map([...byKey].map(([key, list]) => [key, list.map(x => x.entry)])), entryLines, markersRemoved };
}

/** The entry that stands when nothing says otherwise: the newest `date` (a day), then the last in file order. */
export function newestEntry(entries) {
  let best = entries[0];
  for (const e of entries) if (e.date >= best.date) best = e;
  return best;
}

/**
 * Read the lock.
 *
 * `links` and `dispositions` hold one entry per key: for a key with several
 * distinct lines, the newest. `variants` lists those keys with every line, so
 * a caller that knows the link as it is now can choose better
 * (`resolveLockLinks` in anchors.mjs). `collapsed` is the number of entry
 * lines beyond one per key. `conflicts` is always empty: a duplicate is no
 * longer a conflict (kept so callers that read it keep working).
 * @returns {{ exists: boolean, error: string|null, links: Map<string, object>, dispositions: Map<string, object>, variants: Map<string, object[]>, collapsed: number, conflicts: [] }}
 */
export function readAnchorLock(projectDir) {
  const path = resolve(projectDir, ANCHOR_LOCK_PATH);
  const empty = { exists: false, error: null, links: new Map(), dispositions: new Map(), variants: new Map(), collapsed: 0, conflicts: [] };
  if (!existsSync(path)) return empty;
  let raw;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) return { ...empty, exists: true, error: `${ANCHOR_LOCK_PATH} is not a regular file` };
    if (stat.size > MAX_LOCK_BYTES) return { ...empty, exists: true, error: `${ANCHOR_LOCK_PATH} is larger than ${MAX_LOCK_BYTES} bytes` };
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    return { ...empty, exists: true, error: `${ANCHOR_LOCK_PATH} cannot be read: ${e.message}` };
  }
  return lockFromText(raw, empty);
}

/** The reader's result for already-read text (`anchors merge` reads it once). */
export function lockFromText(raw, empty = { exists: true, error: null, links: new Map(), dispositions: new Map(), variants: new Map(), collapsed: 0, conflicts: [] }, options = {}) {
  const parsed = parseAnchorLock(raw, options);
  if (parsed.error) return { ...empty, exists: true, error: parsed.error };
  const links = new Map();
  const dispositions = new Map();
  const variants = new Map();
  for (const [key, entries] of parsed.byKey) {
    if (entries.length > 1) variants.set(key, entries);
    (key.startsWith('disposition|') ? dispositions : links).set(key, newestEntry(entries));
  }
  return { exists: true, error: null, links, dispositions, variants, collapsed: parsed.entryLines - parsed.byKey.size, conflicts: [], markersRemoved: parsed.markersRemoved };
}

/** The lock's text: header, then entries sorted by key, then a newline. */
export function serializeAnchorLock(links, dispositions = new Map()) {
  const entries = [...links.values(), ...dispositions.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return `${[stableLine(LOCK_HEADER), ...entries.map(stableLine)].join('\n')}\n`;
}

/** Whether `.gitattributes` declares the lock `merge=union`. */
export function gitattributesDeclaresUnion(projectDir) {
  try {
    const text = readFileSync(resolve(projectDir, '.gitattributes'), 'utf8');
    return text.split('\n').some(line => {
      const parts = line.trim().split(/\s+/);
      return parts[0] === ANCHOR_LOCK_PATH && parts.includes('merge=union');
    });
  } catch { return false; }
}
