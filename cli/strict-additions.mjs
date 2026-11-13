/**
 * What joined `strict`, and in which release (specs/097-strict-by-default FR-012, FR-013).
 *
 * CI has no memory between runs, so the answer to "is this check new?" ships in
 * the package. Guard reads this table to label a strict failure "new in vX.Y"
 * (an item added in the running minor or the one before it) and, when a project
 * sets `enforcement.asOf`, to hold a later item as pending: reported, and never
 * part of the exit code.
 *
 * Keys are `<major>.<minor>` release lines. Values:
 *   - `validators`: registered validator keys that strict began to require then;
 *   - `gatingCodes`: finding codes that began to fail builds then. A code is
 *     listed here only because the evidence derives it (`deriveGatingSet`), and
 *     a test fails when this list and the derived set differ.
 *
 * Every registered validator is listed exactly once, and a test fails when one is
 * missing. All 37 sit under 0.48, the release that made strict the default: that
 * is the line on which strict began to require any of them. A project that pins
 * `asOf` to the line before (`"0.47"`) therefore gets today's `standard` exit
 * codes with the strict report beside them, and raises `asOf` as it adopts.
 * A validator added after 0.48 goes under the release that ships it.
 *
 * @implements docguard.strict-by-default#FR-012
 * @implements docguard.strict-by-default#FR-013
 */

export const STRICT_ADDITIONS = Object.freeze({
  '0.48': Object.freeze({
    validators: Object.freeze([
      'structure', 'docSections', 'docsSync', 'drift', 'changelog', 'testSpec', 'environment',
      'security', 'architecture', 'freshness', 'traceability', 'docsDiff', 'apiSurface',
      'metadataSync', 'docsCoverage', 'docQuality', 'todoTracking', 'schemaSync', 'specKit',
      'documentLifecycle', 'specRegistry', 'docDependency', 'requirementAnchors', 'pathScopedRules',
      'docOwnership', 'evidence', 'crossReference', 'generatedStaleness', 'surfaceSync',
      'suppressions', 'diffSuspicion', 'referenceExistence', 'apiDocSmells', 'decisionRecords',
      'aidlc', 'canonicalSync', 'metricsConsistency',
    ]),
    gatingCodes: Object.freeze([]),
  }),
});

/** `"0.48"` or `"0.48.3"` to `[0, 48]`; null when it is neither. */
export function parseLine(version) {
  const m = /^(\d+)\.(\d+)(?:\.\d+)?/.exec(String(version ?? ''));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Order two release lines: negative, zero or positive, like a comparator. */
export function compareLines(a, b) {
  const [pa, pb] = [parseLine(a), parseLine(b)];
  if (!pa || !pb) return 0;
  return pa[0] - pb[0] || pa[1] - pb[1];
}

/** The release line that lists a validator key, or null. */
export function validatorAddedIn(key, additions = STRICT_ADDITIONS) {
  for (const [line, a] of Object.entries(additions)) if ((a.validators || []).includes(key)) return line;
  return null;
}

/** The release line that lists a gating code, or null. */
export function codeAddedIn(code, additions = STRICT_ADDITIONS) {
  for (const [line, a] of Object.entries(additions)) if ((a.gatingCodes || []).includes(code)) return line;
  return null;
}

/**
 * Is an item listed under `line` new to a build that runs `runningVersion`?
 * New means added in the running minor or the one before it (FR-012); a line the
 * running build already lists but has not reached yet (a development build) is new too.
 */
export function isNewIn(line, runningVersion) {
  const run = parseLine(runningVersion);
  const at = parseLine(line);
  if (!run || !at) return false;
  const rank = ([maj, min]) => maj * 1000 + min;
  return rank(at) >= rank(run) - 1;
}
