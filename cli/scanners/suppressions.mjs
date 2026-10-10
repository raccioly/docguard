/**
 * The suppression model — every way a DocGuard project tells DocGuard not to
 * look, in one list (specs/057-ignore-reasons, raccioly/docguard#420).
 *
 * Each entry:
 *   { kind, pattern | codes | key, scope, reason, expires, state, problem?, source }
 *
 *   kind     `path` (a glob), `code` (an inline pragma), `validator` /
 *            `section` (an N/A marker), `fingerprint` (a baseline entry)
 *   scope    `all-validators`, `validator:<key>`, `section:<id>`, `line`
 *            (the pragma's line and the next), `finding` (one fingerprint)
 *   reason   what the author wrote, or null. Never synthesised: a suppression
 *            whose source cannot carry a reason has `reason: null`.
 *   expires  `YYYY-MM-DD` or null; only `.docguardignore` can carry one
 *   state    `active` | `expired` | `invalid` (does not apply) | `disabled`
 *            (a baseline turned off by `"baseline": false`)
 *   source   { file, line } or { file, key }
 *
 * Read-only. Inline pragmas are found by walking the project (skipping
 * DEFAULT_IGNORE_DIRS, dot entries and paths the active ignore set excludes,
 * where a pragma has nothing to suppress); `coverage` says whether that walk
 * was complete.
 *
 * @implements docguard.ignore-reasons#FR-006
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInlinePragma } from '../findings.mjs';
import {
  buildIgnoreFilter, listCanonicalDocs, loadDocguardIgnoreEntries, relPosix, utcToday, walkFiles,
} from '../shared-ignore.mjs';
import { listValidatorMarkers } from '../validator-markers.mjs';

/** `.docguard.json` arrays that suppress paths, and the scope each one has. */
export const CONFIG_IGNORE_KEYS = Object.freeze({
  ignore: 'all-validators',
  securityIgnore: 'validator:security',
  todoIgnore: 'validator:todoTracking',
  documentLifecycle: 'validator:documentLifecycle',
});

const MAX_SCAN_BYTES = 1024 * 1024;
const SECTION_MARKER_RE = /<!--\s*docguard:section\s+([A-Za-z0-9_-]+)\s+n\/a\b([^>]*?)-->/gi;
/** The Structure validator honours a section marker only with a reason starting with a letter or digit. */
const SECTION_HONOURED_RE = /^\s*[—-]+\s*[A-Za-z0-9]/;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function readJson(path) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : null; } catch { return null; }
}

function docguardIgnoreEntries(projectDir, today) {
  return loadDocguardIgnoreEntries(projectDir, { today }).map(e => ({
    kind: 'path',
    pattern: e.pattern,
    scope: 'all-validators',
    reason: e.reason,
    expires: e.expires,
    state: e.state,
    ...(e.problem ? { problem: e.problem } : {}),
    source: { file: '.docguardignore', line: e.line },
  }));
}

function configEntries(projectDir) {
  const raw = readJson(resolve(projectDir, '.docguard.json'));
  if (!raw || typeof raw !== 'object') return [];
  const out = [];
  for (const [key, scope] of Object.entries(CONFIG_IGNORE_KEYS)) {
    if (!Array.isArray(raw[key])) continue;
    for (const pattern of raw[key]) {
      if (typeof pattern !== 'string' || !pattern) continue;
      out.push({ kind: 'path', pattern, scope, reason: null, expires: null, state: 'active', source: { file: '.docguard.json', key } });
    }
  }
  return out;
}

function inlinePragmas(projectDir, config) {
  const isIgnored = buildIgnoreFilter(Array.isArray(config?.ignore) ? config.ignore : []);
  const found = [];
  let unreadable = 0;
  const complete = walkFiles(projectDir, (abs) => {
    const rel = relPosix(projectDir, abs);
    if (isIgnored(rel)) return;
    let text;
    try {
      if (statSync(abs).size > MAX_SCAN_BYTES) return;
      const bytes = readFileSync(abs);
      if (bytes.subarray(0, 8192).includes(0)) return;
      text = bytes.toString('utf-8');
    } catch { unreadable++; return; }
    if (!/docguard:ignore/i.test(text)) return;
    text.split(/\r?\n/).forEach((line, i) => {
      const pragma = parseInlinePragma(line);
      if (!pragma) return;
      found.push({
        kind: 'code', codes: pragma.codes, scope: 'line', reason: pragma.reason, expires: null, state: 'active',
        source: { file: rel, line: i + 1 },
      });
    });
  }, { onError: () => { unreadable++; } });
  found.sort((a, b) => (a.source.file < b.source.file ? -1 : a.source.file > b.source.file ? 1 : a.source.line - b.source.line));
  return { found, complete: complete && unreadable === 0, unreadable };
}

function validatorMarkers(projectDir, validatorKeys) {
  return listValidatorMarkers(projectDir, validatorKeys).map(m => ({
    kind: 'validator', key: m.key, scope: `validator:${m.key}`, reason: m.reason, expires: null,
    state: m.known ? 'active' : 'invalid', ...(m.known ? {} : { problem: 'unknown-validator' }),
    source: { file: m.file, line: m.line },
  }));
}

function sectionMarkers(projectDir, config) {
  const isIgnored = buildIgnoreFilter(Array.isArray(config?.ignore) ? config.ignore : []);
  const out = [];
  for (const doc of listCanonicalDocs(projectDir, { isIgnored, config })) {
    let text;
    try { text = readFileSync(doc.abs, 'utf-8'); } catch { continue; }
    if (!text.includes('docguard:section')) continue;
    const re = new RegExp(SECTION_MARKER_RE.source, SECTION_MARKER_RE.flags);
    let m;
    while ((m = re.exec(text)) !== null) {
      const honoured = SECTION_HONOURED_RE.test(m[2]);
      const reason = m[2].replace(/^\s*[—:-]+\s*/, '').trim() || null;
      out.push({
        kind: 'section', key: m[1], scope: `section:${m[1]}`, reason, expires: null,
        state: honoured ? 'active' : 'invalid', ...(honoured ? {} : { problem: 'no-reason' }),
        source: { file: doc.rel, line: lineOf(text, m.index) },
      });
    }
  }
  return out;
}

function baselineEntries(projectDir, config) {
  const raw = readJson(resolve(projectDir, '.docguard.baseline.json'));
  if (!raw || typeof raw.fingerprints !== 'object' || raw.fingerprints === null) return [];
  const state = config?.baseline === false ? 'disabled' : 'active';
  return Object.keys(raw.fingerprints).sort().map(fp => ({
    kind: 'fingerprint', pattern: fp, scope: 'finding', reason: null, expires: null, state,
    source: { file: '.docguard.baseline.json', key: 'fingerprints' },
  }));
}

/**
 * Collect every native suppression in the project.
 *
 * @param {string} projectDir
 * @param {object} config - the loaded config (its `ignore` is the active set)
 * @param {{ today?: string, validatorKeys?: Iterable<string> }} [opts]
 * @returns {{ asOf: string, entries: object[], coverage: { inlineScan: 'complete'|'partial', unreadable: number } }}
 */
export function collectSuppressions(projectDir, config = {}, { today = utcToday(), validatorKeys = [] } = {}) {
  const inline = inlinePragmas(projectDir, config);
  const entries = [
    ...docguardIgnoreEntries(projectDir, today),
    ...configEntries(projectDir),
    ...inline.found,
    ...validatorMarkers(projectDir, validatorKeys),
    ...sectionMarkers(projectDir, config),
    ...baselineEntries(projectDir, config),
  ];
  return {
    asOf: today,
    entries,
    coverage: { inlineScan: inline.complete ? 'complete' : 'partial', unreadable: inline.unreadable },
  };
}
