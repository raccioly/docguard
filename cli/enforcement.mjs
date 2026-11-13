/**
 * Enforcement mode (specs/097-strict-by-default, `docguard.strict-by-default`).
 *
 * `strict` makes every validator that applies examine something, or the run
 * exits 4; `standard` is the pre-0.48 behavior. This module is a leaf: it
 * reads validator RESULTS after the run and never imports a validator
 * (Constitution IV), the same way `required-checks.mjs` composes them.
 *
 * An absent `enforcement` key resolves to `strict` (Stage B, FR-001); a project
 * that wants the lower mode writes `"enforcement": "standard"`.
 *
 * @implements docguard.strict-by-default#FR-001
 * @implements docguard.strict-by-default#FR-007
 * @implements docguard.strict-by-default#FR-003
 * @implements docguard.strict-by-default#FR-008
 * @implements docguard.strict-by-default#FR-011
 * @implements docguard.strict-by-default#FR-012
 * @implements docguard.strict-by-default#FR-013
 * @implements docguard.strict-by-default#FR-014
 * @implements docguard.strict-by-default#FR-015
 * @implements docguard.strict-by-default#FR-016
 */
import { EMPTY_CAUSES, performedChecks } from './validator-coverage.mjs';
import { STRICT_ADDITIONS, codeAddedIn, compareLines, isNewIn, validatorAddedIn } from './strict-additions.mjs';

export const ENFORCEMENT_MODES = Object.freeze(['strict', 'standard']);

/** What a project that has not chosen gets (FR-001). */
export const DEFAULT_MODE = 'strict';

/** `asOf` names a release line, `<major>.<minor>`. */
const AS_OF_RE = /^\d+\.\d+$/;

/**
 * The mode a run uses and where it came from. Pure; throws on a malformed
 * value so the config loader reports it the way it reports `findingSeverity`.
 * `profile` never selects the mode (FR-001): the stored value
 * `profile: "standard"` is a project shape, not a choice of strictness.
 *
 * @param {object} config merged configuration (or the raw one)
 * @returns {{ mode: 'strict'|'standard', asOf: string|null, source: 'default'|'config' }}
 */
export function resolveEnforcement(config) {
  const raw = config?.enforcement;
  if (raw === undefined) return { mode: DEFAULT_MODE, asOf: null, source: 'default' };
  if (typeof raw === 'string') {
    if (!ENFORCEMENT_MODES.includes(raw)) throw new Error(`enforcement must be "strict" or "standard", got ${JSON.stringify(raw)}`);
    return { mode: raw, asOf: null, source: 'config' };
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (!ENFORCEMENT_MODES.includes(raw.mode)) throw new Error(`enforcement.mode must be "strict" or "standard", got ${JSON.stringify(raw.mode)}`);
    if (raw.asOf !== undefined && (typeof raw.asOf !== 'string' || !AS_OF_RE.test(raw.asOf))) {
      throw new Error(`enforcement.asOf must be "<major>.<minor>" (for example "0.49"), got ${JSON.stringify(raw.asOf)}`);
    }
    return { mode: raw.mode, asOf: raw.asOf ?? null, source: 'config' };
  }
  throw new Error('enforcement must be "strict", "standard", or { "mode": ..., "asOf": ... }');
}

/** One line for the first line of the summary (FR-016). */
export function modeLine(enforcement) {
  const { mode, asOf, source } = enforcement;
  const origin = source === 'config'
    ? 'set by "enforcement" in .docguard.json'
    : 'the default: no "enforcement" key ("enforcement": "standard" selects the lower mode)';
  return `Enforcement: ${mode}${asOf ? ` (as of ${asOf})` : ''} — ${origin}`;
}

/**
 * Codes that could exit 1 under the 0.47.0 default configuration (FR-008, the plan's
 * closed list; `tests/strict-by-default.test.mjs` derives it from the v0.47.0 tag).
 * Under strict an intrinsic error of one of these stays an error, so strict is never
 * weaker than the old default. ANC001 and ANC003 fail only for a link accepted as
 * `reviewed-exact`; the source decides that per link.
 */
export const V047_ERROR_CODES = Object.freeze(['ANC001', 'ANC003', 'ANC005', 'API004', 'DLK005', 'DRF001', 'DRF002', 'EVD001', 'EVD002', 'OWN007', 'REQ001', 'STR001', 'STR002']);

/** Validators the 0.47.0 defaults left off: strict turns them on, and their intrinsic errors start as warnings. */
export const OFF_BY_DEFAULT_VALIDATORS = Object.freeze(['security', 'architecture']);

/**
 * What `resolveFindingEnforcement` needs under strict (FR-008): the closed list, the
 * validators whose errors are demoted, and the gating codes. With `enforcement.asOf`
 * set, a gating code the table lists under a later release is not gating yet; it is
 * returned in `pendingCodes` so the report can say so (FR-013).
 *
 * @param {{ gating?: Iterable<string>, additions?: object, enforcement?: object, runningVersion?: string }} [input]
 */
export function strictFindingContext({ gating = [], additions = STRICT_ADDITIONS, enforcement = null, runningVersion = null } = {}) {
  const asOf = enforcement?.asOf ?? null;
  const active = new Set();
  const pendingCodes = [];
  for (const code of gating) {
    const line = codeAddedIn(code, additions);
    if (asOf && line && compareLines(line, asOf) > 0) pendingCodes.push(code);
    else active.add(code);
  }
  return { closed: new Set(V047_ERROR_CODES), offByDefault: new Set(OFF_BY_DEFAULT_VALIDATORS), gating: active, pendingCodes: pendingCodes.sort(), runningVersion };
}

/**
 * What strict mode reports for one run, from the validator results after
 * verdicts, the baseline and finding severities are final.
 *
 * A validator that applies and did not examine everything is sorted by what the
 * project can do about it (FR-007 as amended):
 *   - `unexamined`, which makes the run exit 4: it performed zero checks and its
 *     cause is `needs-declaration` or `needs-content` (a declaration or a document
 *     the project can write), or it could not observe at all (`blocked`, or
 *     `inconclusive` with zero checks).
 *   - `couldNotRead`, which never changes the exit code: it performed at least one
 *     check and could not observe the rest (a partial `inconclusive`: unreadable
 *     routes, an optional parser that is absent), or its cause is
 *     `layout-not-recognized`, a limit of DocGuard and not a gap in the project.
 *     `--fail-on-inconclusive` and `requiredChecks` keep their own rules.
 *
 * `gating` is the findings that fail the build, by code (Stage A: exactly the
 * findings that resolve to error today; FR-008/FR-009 narrow it in Stage B).
 * `pending` stays empty until `asOf` is honored (FR-013, Stage B), and `newIn`
 * stays null until the strict-additions table exists (FR-012, Stage B).
 *
 * @param {object[]} results validator results carrying `verdict`
 * @param {{ baselineSuppressed?: number, lite?: boolean }} [extra]
 */
export function buildStrictReport(results, {
  baselineSuppressed = 0, lite = false, markers = [], enforcement = null, additions = STRICT_ADDITIONS,
  runningVersion = null, pendingCodes = [], disabled = [],
} = {}) {
  const asOf = enforcement?.asOf ?? null;
  const pending = [];
  // The N/A marker reader already parses owner and expires (spec 084); an expired or
  // unreadable marker declares nothing, so it never made a result `declared N/A`.
  const markerFor = key => markers.find(m => m.key === key && m.known && !m.metadataProblem && !(m.expires && m.expires < new Date().toISOString().slice(0, 10)));
  const unexamined = [];
  const couldNotRead = [];
  const waived = [];
  const gatingByCode = new Map();
  for (const r of results) {
    if (typeof r.note === 'string' && r.note.startsWith('declared N/A')) {
      // The result carries only the note string; owner and expires come from the marker reader.
      const m = markerFor(r.key);
      waived.push({ validator: r.key, reason: r.note.replace(/^declared N\/A:?\s*/, '') || null, owner: m?.owner ?? null, expires: m?.expires ?? null });
    }
    for (const f of r.findings || []) {
      if (f.effectiveSeverity === 'error') gatingByCode.set(f.code, (gatingByCode.get(f.code) || 0) + 1);
    }
    if (r.key === 'requiredChecks') continue;
    if (r.verdict !== 'empty' && r.verdict !== 'inconclusive' && r.verdict !== 'blocked') continue;
    const cause = EMPTY_CAUSES.includes(r.emptyCause) ? r.emptyCause : null;
    const reason = r.applicability?.reason || null;
    // What a project can resolve blocks; what only DocGuard can resolve (a layout it does not read) and what
    // was partly examined (at least one check ran) is reported and leaves the exit code alone.
    const partial = r.verdict === 'inconclusive' && performedChecks(r) >= 1;
    const unreadLayout = r.verdict === 'empty' && cause === 'layout-not-recognized';
    const unclassified = r.verdict === 'empty' && cause !== 'needs-declaration' && cause !== 'needs-content';
    if (partial || unreadLayout || unclassified) {
      couldNotRead.push({
        validator: r.key, name: r.name || r.key, verdict: r.verdict, cause, reason,
        ...(Array.isArray(r.layouts) && r.layouts.length ? { layouts: r.layouts } : {}),
      });
      continue;
    }
    // FR-012/FR-013: when the table lists this validator, say when it joined; with `asOf` set, one that
    // joined after it is reported as pending and does not count.
    const line = validatorAddedIn(r.key, additions);
    if (asOf && line && compareLines(line, asOf) > 0) {
      pending.push({ kind: 'validator', validator: r.key, name: r.name || r.key, since: line, verdict: r.verdict, cause, reason });
      continue;
    }
    unexamined.push({
      validator: r.key,
      name: r.name || r.key,
      verdict: r.verdict,
      cause,
      reason,
      howToConfigure: typeof r.howToConfigure === 'string' && r.howToConfigure ? r.howToConfigure : null,
      newIn: line && isNewIn(line, runningVersion) ? line : null,
      blocking: !lite,
    });
  }
  for (const code of pendingCodes) {
    const count = results.reduce((n, r) => n + (r.findings || []).filter(f => f.code === code).length, 0);
    if (count > 0) pending.push({ kind: 'code', code, since: codeAddedIn(code, additions), count });
  }
  return {
    evaluated: !lite,
    unexamined,
    couldNotRead,
    blocking: unexamined.filter(u => u.blocking).map(u => u.validator),
    gating: [...gatingByCode].map(([code, count]) => {
      const line = codeAddedIn(code, additions);
      return { code, count, ...(line && isNewIn(line, runningVersion) ? { newIn: line } : {}) };
    }).sort((a, b) => a.code.localeCompare(b.code)),
    pending,
    disabled,
    waived,
    baselined: baselineSuppressed,
  };
}

/** The waiver form every strict failure points at (spec 084). */
export const WAIVER_FORM = '<!-- docguard:validator <key> n/a — <reason> owner:<@handle> expires:<YYYY-MM-DD> -->';

/**
 * The "Adopt" block of FR-014, as lines of text without color: the fix per
 * unexamined validator, the command that records existing findings, the
 * waiver form, and the key that selects the lower mode, in that order.
 */
export function adoptLines(strict) {
  const lines = ['Adopt — what strict found and how to resolve each item:'];
  for (const u of strict.unexamined.filter(u => u.blocking)) {
    lines.push(`  • ${u.name} is ${u.verdict}${u.cause ? ` (${u.cause})` : ''}${u.newIn ? ` — new in v${u.newIn}` : ''}`);
    const fix = u.howToConfigure || u.reason;
    if (fix) lines.push(`      ${fix}`);
  }
  const gatingTotal = strict.gating.reduce((n, g) => n + g.count, 0);
  if (gatingTotal > 0) {
    lines.push(`  Record the ${gatingTotal} existing finding(s) that fail the build (new ones of the same code still fail):`);
    lines.push('      docguard guard --update-baseline');
  }
  lines.push('  Waive a validator that does not apply, with a reason, an owner and an expiry:');
  lines.push(`      ${WAIVER_FORM}`);
  lines.push('  Choose the lower mode on purpose:');
  lines.push('      "enforcement": "standard"   (in .docguard.json)');
  return lines;
}

/**
 * The "could not read" block that follows the Adopt block: each validator that
 * applies and could not look at everything, with what it missed and, for an
 * unread layout, the layouts it does read. Empty when there is nothing to say.
 */
export function couldNotReadLines(strict) {
  const items = strict?.couldNotRead || [];
  if (items.length === 0) return [];
  const lines = ['DocGuard could not read: (reported only; this does not change the exit code)'];
  for (const u of items) {
    lines.push(`  • ${u.name} is ${u.verdict}${u.cause ? ` (${u.cause})` : ''}`);
    if (u.reason) lines.push(`      ${u.reason}`);
    if (u.layouts?.length) lines.push(`      It reads: ${u.layouts.join('; ')}`);
  }
  return lines;
}

/**
 * The summary lines strict adds after the verdict counts: validators the project's own
 * file disabled (FR-003, on every run) and items held back by `asOf` (FR-013).
 */
export function strictSummaryLines(strict) {
  const lines = [];
  const disabled = strict?.disabled || [];
  if (disabled.length > 0) lines.push(`Disabled by configuration: ${disabled.map(d => d.validator).join(', ')} (validators.<key>: false in .docguard.json)`);
  const pending = strict?.pending || [];
  if (pending.length > 0) {
    lines.push('Pending (strict since a later release; reported only, this does not change the exit code):');
    for (const p of pending) lines.push(`  • ${p.kind === 'code' ? `${p.code} (${p.count} finding(s))` : p.name || p.validator} — strict since v${p.since}`);
  }
  return lines;
}

/** True when this run's exit code is decided by strict (an unexamined blocking validator). */
export function strictBlocks(data) {
  return (data?.strict?.blocking?.length || 0) > 0;
}
