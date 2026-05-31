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

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// `<!-- docguard:validator <key> n/a [— reason] -->`
// Separator before the reason may be —, :, or one-or-more hyphens. Reason
// is optional. Case-insensitive on the keyword and "n/a".
const MARKER_RE = /<!--\s*docguard:validator\s+([A-Za-z0-9_-]+)\s+n\/a\b\s*(?:[—:\-]+\s*([^>]*?))?\s*-->/gi;

/** Files where a validator marker is honored — the docs humans actually read. */
function markerSourceFiles(projectDir) {
  const files = [];
  const canonicalDir = resolve(projectDir, 'docs-canonical');
  if (existsSync(canonicalDir)) {
    try {
      for (const f of readdirSync(canonicalDir)) {
        if (f.toLowerCase().endsWith('.md')) files.push(join(canonicalDir, f));
      }
    } catch { /* ignore */ }
  }
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
