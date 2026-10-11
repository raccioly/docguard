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
 * that it can keep two different lines for one key; the reader treats that as
 * a conflict (ANC009) and the link as unreviewed, so a bad merge fails closed.
 * Identical duplicates and a duplicated header (both sides keep it) collapse.
 *
 * The lock records only the latest accept per key. Earlier accepts are in
 * `git log -p -- .docguard-anchor-lock.jsonl`, an audit trail with no cap.
 *
 * @implements docguard.requirement-anchors#FR-016
 * @implements docguard.requirement-anchors#FR-017
 * @implements docguard.requirement-anchors#FR-018
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

/**
 * Read the lock.
 * @returns {{ exists: boolean, error: string|null, links: Map<string, object>, dispositions: Map<string, object>, conflicts: { key: string, lines: number[] }[] }}
 */
export function readAnchorLock(projectDir) {
  const path = resolve(projectDir, ANCHOR_LOCK_PATH);
  const empty = { exists: false, error: null, links: new Map(), dispositions: new Map(), conflicts: [] };
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
  const lines = raw.split('\n');
  const seen = new Map(); // key → { line, text, entry }
  const conflicted = new Map(); // key → line numbers
  let header = false;
  const headerText = stableLine(LOCK_HEADER);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text) continue;
    let value;
    try { value = JSON.parse(text); } catch (e) {
      return { ...empty, exists: true, error: `${ANCHOR_LOCK_PATH}:${i + 1} is not valid JSON (${e.message})` };
    }
    if (value && value.kind !== undefined && value.key === undefined) {
      if (stableLine(value) !== headerText) {
        return { ...empty, exists: true, error: `${ANCHOR_LOCK_PATH}:${i + 1} has an unsupported header ${JSON.stringify(value)}; this DocGuard reads ${headerText}` };
      }
      header = true;
      continue;
    }
    const problem = entryProblem(value);
    if (problem) return { ...empty, exists: true, error: `${ANCHOR_LOCK_PATH}:${i + 1}: ${problem}` };
    const canonical = stableLine(value);
    const prior = seen.get(value.key);
    if (!prior) { seen.set(value.key, { line: i + 1, text: canonical, entry: value }); continue; }
    if (prior.text === canonical) continue; // identical duplicate from a union merge
    if (!conflicted.has(value.key)) conflicted.set(value.key, [prior.line]);
    conflicted.get(value.key).push(i + 1);
  }
  if (!header) return { ...empty, exists: true, error: `${ANCHOR_LOCK_PATH} has no header line ${headerText}` };
  const links = new Map();
  const dispositions = new Map();
  for (const [key, { entry }] of seen) {
    if (conflicted.has(key)) continue; // fail closed: neither side counts
    (key.startsWith('disposition|') ? dispositions : links).set(key, entry);
  }
  const conflicts = [...conflicted].map(([key, lineNumbers]) => ({ key, lines: lineNumbers })).sort((a, b) => (a.key < b.key ? -1 : 1));
  return { exists: true, error: null, links, dispositions, conflicts };
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
