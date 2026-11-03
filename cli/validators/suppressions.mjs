/**
 * Suppressions validator — `.docguardignore` entries that have lapsed, cannot
 * be read, or (when the project asks) carry no reason.
 *
 *   IGN001  entry expired: it no longer excludes anything
 *   IGN002  entry has no `# reason` (only with `suppressions.requireReason`)
 *   IGN003  entry unreadable: bad `expires:` date or no pattern; excludes nothing
 *   IGN004  suppression names no owner (only with `suppressions.requireOwner`)
 *   IGN005  suppression ends later than `suppressions.maxDays` allows, or never
 *
 * Since spec 084 every kind of suppression that can carry metadata is judged:
 * inline pragmas, validator and section N/A markers, `.docguard.json` object
 * entries and `.docguardignore` lines. Baseline fingerprints are exempt.
 *
 * Parsing lives in `cli/shared-ignore.mjs`, so the entries judged here are the
 * ones every other validator applies (Principle IV).
 *
 * @implements docguard.ignore-reasons#FR-005
 * @implements docguard.accountable-suppressions#FR-004
 * @implements docguard.accountable-suppressions#FR-005
 * @implements docguard.accountable-suppressions#FR-006
 */

import { mkFinding, resultFromFindings } from '../findings.mjs';
import { loadDocguardIgnoreEntries, utcToday } from '../shared-ignore.mjs';
import { collectSuppressions } from '../scanners/suppressions.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const KIND_LABEL = { code: 'inline pragma', validator: 'validator N/A marker', section: 'section N/A marker', path: 'ignore entry' };
const where = e => (e.source.line ? `${e.source.file}:${e.source.line}` : `${e.source.file} (${e.source.key})`);
const what = e => (e.kind === 'code' ? `docguard:ignore ${e.codes ? e.codes.join(',') : '(any code)'}` : e.kind === 'path' ? `"${e.pattern}"` : `${e.kind} ${e.key}`);

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
  const requireReason = config?.suppressions?.requireReason === true;
  const requireOwner = config?.suppressions?.requireOwner === true;
  const maxDays = Number.isInteger(config?.suppressions?.maxDays) && config.suppressions.maxDays > 0 ? config.suppressions.maxDays : null;
  // Every other kind, from the one suppression model (docguard.ignore-reasons#FR-006).
  // The pragma walk costs a full project read, so it runs only when the project
  // asks for a waiver policy; otherwise only the cheap kinds are judged, and
  // only those carrying waiver metadata, so a project that uses none of it
  // gets exactly the pre-084 result (SC-002).
  const policyOn = requireOwner || maxDays !== null;
  const others = collectSuppressions(projectDir, config, { today, inline: policyOn }).entries
    .filter(e => e.kind !== 'fingerprint' && !(e.kind === 'path' && e.source.file === '.docguardignore'))
    .filter(e => policyOn || e.owner || e.expires || e.metadataProblem);
  if (entries.length === 0 && others.length === 0) return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  const findings = [];
  let passed = 0;
  const policy = (e, location) => {
    if (requireOwner && !e.owner) {
      findings.push(mkFinding({
        code: 'IGN004', validator: VALIDATOR, severity: 'warn', confidence: 'high', disposition: 'act',
        message: `${location} — ${KIND_LABEL[e.kind] || 'suppression'} ${what(e)} names no owner; suppressions.requireOwner asks every waiver to name who answers for it.`,
        location,
        suggestion: { kind: 'fix', text: 'Add a trailing owner:@handle (or owner:team/name) after the reason.' },
      }));
    }
    if (maxDays) {
      const latest = addDays(today, maxDays);
      if (!e.expires || e.expires > latest) {
        findings.push(mkFinding({
          code: 'IGN005', validator: VALIDATOR, severity: 'warn', confidence: 'high', disposition: 'act',
          message: e.expires
            ? `${location} — ${KIND_LABEL[e.kind] || 'suppression'} ${what(e)} expires ${e.expires}, later than suppressions.maxDays (${maxDays}) allows: ${latest}.`
            : `${location} — ${KIND_LABEL[e.kind] || 'suppression'} ${what(e)} has no end date; suppressions.maxDays (${maxDays}) asks every waiver to expire by ${latest}.`,
          location,
          suggestion: { kind: 'fix', text: `Set expires:YYYY-MM-DD on or before ${latest}, and renew it then if the reason still holds.` },
        }));
      }
    }
  };
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
          : entry.problem === 'unreadable-metadata'
            ? `${location} — ${show(entry)} has unreadable waiver metadata (${entry.metadataProblem}), so it excludes nothing.`
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
    if (entry.state !== 'invalid') policy({ ...entry, kind: 'path', source: { file: '.docguardignore', line: entry.line } }, location);
    if (findings.length === before) passed++;
  }
  for (const e of others) {
    const location = where(e);
    const before = findings.length;
    const owner = e.owner ? `, owner ${e.owner}` : '';
    if (e.metadataProblem) {
      findings.push(mkFinding({
        code: 'IGN003', validator: VALIDATOR, severity: 'warn', confidence: 'high', disposition: 'act',
        message: `${location} — ${KIND_LABEL[e.kind]} ${what(e)} has unreadable waiver metadata (${e.metadataProblem}), so it suppresses nothing.`,
        location,
        suggestion: { kind: 'fix', text: 'Write owner:@handle and expires:YYYY-MM-DD at the end of the reason, each at most once.' },
      }));
    } else if (e.expires && e.expires < today) {
      findings.push(mkFinding({
        code: 'IGN001', validator: VALIDATOR, severity: 'warn', confidence: 'high', disposition: 'escalate',
        message: `${location} — ${KIND_LABEL[e.kind]} ${what(e)} expired on ${e.expires}${owner} and no longer suppresses anything${e.reason ? ` (reason: ${e.reason})` : ''}.`,
        location,
        suggestion: { kind: 'review', text: 'Decide whether the reason still holds: set a new expires: date if it does, delete the waiver if it does not.' },
      }));
    } else if (e.state !== 'invalid') {
      policy(e, location);
    }
    if (findings.length === before) passed++;
  }
  return resultFromFindings(findings, { passed, total: entries.length + others.length, applicable: true });
}
