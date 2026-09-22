/**
 * SARIF 2.1.0 writer — `docguard guard --format sarif`.
 *
 * Maps guard's structured findings (stable codes, locations, suggestions) onto
 * the OASIS SARIF schema so DocGuard results land natively in GitHub Code
 * Scanning, PR diff annotations, and enterprise SARIF dashboards. The mapping
 * is possible only because every validator emits findings with stable codes —
 * codes become reportingDescriptors (rules), findings become results.
 *
 * Zero npm dependencies — pure Node.js built-ins.
 * @implements docguard.calibrated-finding-channels#FR-007
 */

import { readFileSync } from 'node:fs';
import { CODES } from '../findings.mjs';

const SARIF_SCHEMA = 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Sarif/v2.1/os/sarif-schema-2.1.0.json';
const HELP_URI = 'https://github.com/raccioly/docguard#validators';

function pkgInfo() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));
    return { version: pkg.version || '0.0.0', homepage: pkg.homepage || HELP_URI };
  } catch {
    return { version: '0.0.0', homepage: HELP_URI };
  }
}

/** Effective severity → SARIF level. */
function toLevel(severity) {
  return severity === 'error' ? 'error' : severity === 'info' ? 'note' : 'warning';
}

/**
 * Disposition for a result. Every finding built by `mkFinding` carries one, so
 * this only matters for a finding shape that predates the field — but it must
 * apply the SAME rule the constructor does, or SARIF would report `escalate`
 * for a finding whose own suggestion says `fix`. Unknown stays `escalate`:
 * a result DocGuard cannot describe a correction for is one a human reads.
 */
function dispositionOf(f) {
  if (f.disposition === 'act' || f.disposition === 'escalate') return f.disposition;
  const kind = f.suggestion && f.suggestion.kind;
  return kind === 'fix' || kind === 'suppress' ? 'act' : 'escalate';
}

/**
 * Split a finding location ('path' or 'path:line') into {uri, line}.
 * A trailing :N is only a line number when N is all digits — Windows drive
 * letters and URLs with ports never reach here (locations are repo-relative).
 */
function parseLocation(location) {
  if (!location || typeof location !== 'string') return null;
  const m = location.match(/^(.*?):(\d+)$/);
  if (m) return { uri: m[1].replace(/\\/g, '/'), line: parseInt(m[2], 10) };
  return { uri: location.replace(/\\/g, '/'), line: null };
}

/**
 * Convert a runGuardInternal() result into a SARIF 2.1.0 log object.
 *
 * @param {object} guardData - the guard JSON contract ({findings, validators, ...})
 * @param {{projectDir?: string}} [opts]
 * @returns {object} SARIF log, ready for JSON.stringify
 */
export function toSarif(guardData, opts = {}) {
  const { version, homepage } = pkgInfo();
  const findings = Array.isArray(guardData.findings) ? guardData.findings : [];

  // Validators that crashed (or legacy strings without findings) still need
  // representation — a SARIF consumer must not read "no results" as "clean"
  // when a validator errored. Synthesize one result per crash-path string on
  // validators that emitted NO structured findings.
  const synthetic = [];
  for (const v of guardData.validators || []) {
    if (v.status === 'skipped' || v.status === 'na') continue;
    if (Array.isArray(v.findings) && v.findings.length > 0) continue;
    for (const msg of v.errors || []) {
      // A crashed validator is an escalation by construction: DocGuard cannot
      // name a correction for a check it failed to run.
      synthetic.push({ code: `DOCGUARD-${String(v.key || v.name || 'unknown').toUpperCase()}`, severity: 'error', effectiveSeverity: 'error', message: msg, location: null, suggestion: null, confidence: 'high', disposition: 'escalate', evidence: { status: 'not-measured' }, parserTier: 'not-applicable', reportable: false });
    }
    for (const msg of v.warnings || []) {
      const effectiveSeverity = v.severity === 'high' ? 'error' : v.severity === 'low' ? 'info' : 'warn';
      synthetic.push({ code: `DOCGUARD-${String(v.key || v.name || 'unknown').toUpperCase()}`, severity: 'warn', effectiveSeverity, message: msg, location: null, suggestion: null, confidence: 'high', disposition: 'escalate', evidence: { status: 'not-measured' }, parserTier: 'not-applicable', reportable: false });
    }
  }
  const all = [...findings, ...synthetic];

  // rules[]: one descriptor per distinct code, in first-appearance order.
  const ruleIndexByCode = new Map();
  const rules = [];
  for (const f of all) {
    if (ruleIndexByCode.has(f.code)) continue;
    const meta = CODES[f.code];
    const rule = { id: f.code };
    if (meta) {
      rule.name = meta.title;
      rule.shortDescription = { text: meta.title };
      rule.fullDescription = { text: meta.help };
    }
    rule.helpUri = HELP_URI;
    rule.defaultConfiguration = { level: toLevel(f.effectiveSeverity || f.severity) };
    ruleIndexByCode.set(f.code, rules.length);
    rules.push(rule);
  }

  const results = all.map((f) => {
    const result = {
      ruleId: f.code,
      ruleIndex: ruleIndexByCode.get(f.code),
      level: toLevel(f.effectiveSeverity || f.severity),
      message: { text: f.suggestion && f.suggestion.text ? `${f.message}\n→ ${f.suggestion.text}` : f.message },
    };
    const loc = parseLocation(f.location);
    if (loc) {
      const physicalLocation = { artifactLocation: { uri: loc.uri, uriBaseId: 'SRCROOT' } };
      if (loc.line) physicalLocation.region = { startLine: loc.line };
      result.locations = [{ physicalLocation }];
    }
    // Every channel, on every result. Emitting `confidence` only when it was
    // 'low' left a consumer unable to tell a high-confidence finding from one
    // whose field was absent, and `disposition` was dropped entirely — so a
    // SARIF-only consumer (GitHub Code Scanning, enterprise dashboards) could
    // not tell "DocGuard says fix this" from "DocGuard says look at this".
    result.properties = {
      originalSeverity: f.severity,
      effectiveSeverity: f.effectiveSeverity || f.severity,
      ...(f.enforcement ? { enforcement: f.enforcement } : {}),
      confidence: f.confidence === 'low' ? 'low' : 'high',
      disposition: dispositionOf(f),
      evidence: f.evidence && f.evidence.status === 'measured' ? 'measured' : 'not-measured',
      parserTier: typeof f.parserTier === 'string' ? f.parserTier : 'not-applicable',
      reportable: !!f.reportable,
      ...(f.suggestion && f.suggestion.kind ? { suggestionKind: f.suggestion.kind } : {}),
    };
    return result;
  });

  const run = {
    tool: {
      driver: {
        name: 'DocGuard',
        informationUri: homepage,
        version,
        rules,
      },
    },
    results,
  };

  if (opts.projectDir) {
    // file:// URIs require a trailing slash on directory bases (SARIF §3.14.14).
    const dir = String(opts.projectDir).replace(/\\/g, '/').replace(/\/$/, '');
    run.originalUriBaseIds = { SRCROOT: { uri: `file://${dir}/` } };
  }

  return { $schema: SARIF_SCHEMA, version: '2.1.0', runs: [run] };
}
