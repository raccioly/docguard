/**
 * Suppressions validator — `.docguardignore` entries that have lapsed, cannot
 * be read, or (when the project asks) carry no reason.
 *
 *   IGN001  entry expired: it no longer excludes anything
 *   IGN002  entry has no `# reason` (only with `suppressions.requireReason`)
 *   IGN003  entry unreadable: bad `expires:` date or no pattern; excludes nothing
 *
 * Parsing lives in `cli/shared-ignore.mjs`, so the entries judged here are the
 * ones every other validator applies (Principle IV).
 *
 * @implements docguard.ignore-reasons#FR-005
 */

import { mkFinding, resultFromFindings } from '../findings.mjs';
import { loadDocguardIgnoreEntries, utcToday } from '../shared-ignore.mjs';

const VALIDATOR = 'suppressions';

const show = entry => entry.pattern ? `"${entry.pattern}"` : 'the entry';
const because = entry => entry.reason ? ` (reason: ${entry.reason})` : '';

/**
 * @param {string} projectDir
 * @param {object} [config]
 * @param {{ today?: string }} [opts] - `YYYY-MM-DD` (UTC); defaults to now
 */
export function validateSuppressions(projectDir, config = {}, { today = utcToday() } = {}) {
  const entries = loadDocguardIgnoreEntries(projectDir, { today });
  if (entries.length === 0) return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  const requireReason = config?.suppressions?.requireReason === true;
  const findings = [];
  let passed = 0;
  for (const entry of entries) {
    const location = `.docguardignore:${entry.line}`;
    const before = findings.length;
    if (entry.state === 'expired') {
      findings.push(mkFinding({
        code: 'IGN001',
        validator: VALIDATOR,
        severity: 'warn',
        confidence: 'high',
        message: `${location} — ${show(entry)} expired on ${entry.expires} and no longer excludes anything${because(entry)}.`,
        location,
        suggestion: {
          kind: 'review',
          text: 'Decide whether the reason still holds: set a new expires: date if it does, delete the line if it does not.',
        },
      }));
    } else if (entry.state === 'invalid') {
      findings.push(mkFinding({
        code: 'IGN003',
        validator: VALIDATOR,
        severity: 'warn',
        confidence: 'high',
        message: entry.problem === 'no-pattern'
          ? `${location} — the line has an expiry or a reason but no pattern, so it excludes nothing.`
          : `${location} — ${show(entry)} has expires:${entry.expiryText}, which is not a YYYY-MM-DD calendar date, so it excludes nothing.`,
        location,
        suggestion: {
          kind: 'review',
          text: entry.problem === 'no-pattern'
            ? 'Put the pattern first on the line: `path/  expires:YYYY-MM-DD  # reason`.'
            : 'Write the date as expires:YYYY-MM-DD (for example expires:2026-12-31), or remove the token.',
        },
      }));
    }
    if (requireReason && !entry.reason) {
      findings.push(mkFinding({
        code: 'IGN002',
        validator: VALIDATOR,
        severity: 'warn',
        confidence: 'high',
        message: `${location} — ${show(entry)} has no reason; suppressions.requireReason asks every entry to say why it excludes a path.`,
        location,
        suggestion: {
          kind: 'fix',
          text: 'Add a trailing `# reason` after the pattern saying why the path is excluded.',
        },
      }));
    }
    if (findings.length === before) passed++;
  }
  return resultFromFindings(findings, { passed, total: entries.length, applicable: true });
}
