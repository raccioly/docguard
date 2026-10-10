/**
 * Inline whole-validator N/A markers — "declare intentional non-applicability,
 * visibly."
 *
 * A project can mute an entire validator from inside its docs, with the
 * rationale right next to the declaration and tracked in git:
 *
 *   <!-- docguard:validator testSpec n/a — POC, no automated tests yet -->
 *   <!-- docguard:validator traceability n/a — no formal requirements doc -->
 *
 * This is the validator-level sibling of the section-level
 * `<!-- docguard:section <id> n/a — reason -->`. Unlike the config switch
 * (`validators: { testSpec: false }`), which renders as a silent "disabled",
 * a marked validator renders as a visible `➖ [N/A] (declared N/A: reason)` —
 * honest non-applicability, not an invisible skip or a fake green check.
 *
 * Markers are read from the project's primary docs (canonical docs + the root
 * agent/readme files) so the rationale lives where humans and agents read.
 *
 * Zero NPM dependencies — pure Node.js built-ins.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { listCanonicalDocs, relPosix } from './shared-ignore.mjs';

// `<!-- docguard:validator <key> n/a [— reason] -->`
// Separator before the reason may be —, :, or one-or-more hyphens. Reason
// is optional. Case-insensitive on the keyword and "n/a".
const MARKER_RE = /<!--\s*docguard:validator\s+([A-Za-z0-9_-]+)\s+n\/a\b\s*(?:[—:\-]+\s*([^>]*?))?\s*-->/gi;

/** Files where a validator marker is honored — the docs humans actually read. */
function markerSourceFiles(projectDir) {
  // Recursive: a marker declared in docs-canonical/01-architecture/FOO.md must
  // be honored too — a flat read silently dropped the suppression and the
  // validator ran anyway, which reads as "DocGuard ignored my n/a".
  const files = listCanonicalDocs(projectDir).map(d => d.abs);
  for (const root of ['AGENTS.md', 'README.md', 'CLAUDE.md']) {
    const p = resolve(projectDir, root);
    if (existsSync(p)) files.push(p);
  }
  return files;
}

/** Normalize a key for tolerant matching: `Test-Spec`/`test_spec` → `testspec`. */
function norm(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Scan the project's primary docs for `docguard:validator <key> n/a` markers.
 *
 * @param {string} projectDir
 * @param {Iterable<string>} validKeys - the canonical validator keys (camelCase)
 * @returns {{ suppressed: Map<string,string>, unknown: Array<{raw:string, file:string}> }}
 *   `suppressed` maps a canonical validator key → reason ('' if none given).
 *   `unknown` lists markers whose key didn't resolve (typo protection).
 */
export function loadValidatorSuppressions(projectDir, validKeys) {
  const canonicalByNorm = new Map();
  for (const k of validKeys) canonicalByNorm.set(norm(k), k);

  const suppressed = new Map();
  const unknown = [];

  for (const file of markerSourceFiles(projectDir)) {
    let content;
    try { content = readFileSync(file, 'utf-8'); } catch { continue; }
    if (!content.includes('docguard:validator')) continue;

    MARKER_RE.lastIndex = 0;
    let m;
    while ((m = MARKER_RE.exec(content)) !== null) {
      const rawKey = m[1];
      const reason = (m[2] || '').trim();
      const canonical = canonicalByNorm.get(norm(rawKey));
      if (!canonical) {
        unknown.push({ raw: rawKey, file });
        continue;
      }
      // First marker wins; keep its reason. Re-declaring is harmless.
      if (!suppressed.has(canonical)) suppressed.set(canonical, reason);
    }
  }

  return { suppressed, unknown };
}

/**
 * Every `docguard:validator <key> n/a` marker with its location, for the
 * suppression model (docguard.ignore-reasons#FR-006). Reads the same files and
 * the same syntax as `loadValidatorSuppressions`; unlike it, keeps duplicates
 * and unknown keys so a reviewer sees each declaration.
 *
 * @param {string} projectDir
 * @param {Iterable<string>} validKeys
 * @returns {Array<{key: string, known: boolean, reason: string|null, file: string, line: number}>}
 * @implements docguard.ignore-reasons#FR-006
 */
export function listValidatorMarkers(projectDir, validKeys) {
  const canonicalByNorm = new Map();
  for (const k of validKeys) canonicalByNorm.set(norm(k), k);
  const out = [];
  for (const file of markerSourceFiles(projectDir)) {
    let content;
    try { content = readFileSync(file, 'utf-8'); } catch { continue; }
    if (!content.includes('docguard:validator')) continue;
    const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
    let m;
    while ((m = re.exec(content)) !== null) {
      const canonical = canonicalByNorm.get(norm(m[1]));
      out.push({
        key: canonical || m[1],
        known: Boolean(canonical),
        reason: (m[2] || '').trim() || null,
        file: relPosix(projectDir, file),
        line: content.slice(0, m.index).split('\n').length,
      });
    }
  }
  return out;
}
