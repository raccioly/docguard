/**
 * Enforcement mode (specs/097-strict-by-default, `docguard.strict-by-default`).
 *
 * `strict` makes every validator that applies examine something, or the run
 * exits 4; `standard` is the pre-0.48 behavior. This module is a leaf: it
 * reads validator RESULTS after the run and never imports a validator
 * (Constitution IV), the same way `required-checks.mjs` composes them.
 *
 * Stage A (this file as shipped): the mode is selectable, but an absent
 * `enforcement` key still resolves to `standard`. Stage B changes
 * `DEFAULT_MODE` to `strict`; nothing else in this module changes with it.
 *
 * @implements docguard.strict-by-default#FR-001
 * @implements docguard.strict-by-default#FR-007
 * @implements docguard.strict-by-default#FR-014
 * @implements docguard.strict-by-default#FR-015
 * @implements docguard.strict-by-default#FR-016
 */
import { EMPTY_CAUSES } from './validator-coverage.mjs';

export const ENFORCEMENT_MODES = Object.freeze(['strict', 'standard']);

/** What a project that has not chosen gets. Stage B flips this one constant. */
export const DEFAULT_MODE = 'standard';

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
    : 'the default: no "enforcement" key (strict becomes the default in a later release)';
  return `Enforcement: ${mode}${asOf ? ` (as of ${asOf})` : ''} — ${origin}`;
}

/**
 * What strict mode reports for one run, from the validator results after
 * verdicts, the baseline and finding severities are final.
 *
 * `unexamined` lists every validator that applies and did not examine
 * anything: verdict `empty`, `inconclusive` or `blocked`. Only an entry with
 * `blocking: true` makes the run exit 4:
 *   - `inconclusive` and `blocked` always block (today's `--fail-on-inconclusive`);
 *   - `empty` blocks only when the validator has been migrated to the result
 *     contract (it returned a cause, and the cause says it applies). A not yet
 *     migrated validator that is `empty` is listed as `not-yet-classified` and
 *     does NOT block: Stage A must not fail a project on a guess about
 *     applicability.
 *
 * `gating` is the findings that fail the build, by code (Stage A: exactly the
 * findings that resolve to error today; FR-008/FR-009 narrow it in Stage B).
 * `pending` stays empty until `asOf` is honored (FR-013, Stage B), and `newIn`
 * stays null until the strict-additions table exists (FR-012, Stage B).
 *
 * @param {object[]} results validator results carrying `verdict`
 * @param {{ baselineSuppressed?: number, lite?: boolean }} [extra]
 */
export function buildStrictReport(results, { baselineSuppressed = 0, lite = false } = {}) {
  const unexamined = [];
  const waived = [];
  const gatingByCode = new Map();
  for (const r of results) {
    if (typeof r.note === 'string' && r.note.startsWith('declared N/A')) {
      waived.push({ validator: r.key, reason: r.note.replace(/^declared N\/A:?\s*/, '') || null });
    }
    for (const f of r.findings || []) {
      if (f.effectiveSeverity === 'error') gatingByCode.set(f.code, (gatingByCode.get(f.code) || 0) + 1);
    }
    if (r.key === 'requiredChecks') continue;
    if (r.verdict !== 'empty' && r.verdict !== 'inconclusive' && r.verdict !== 'blocked') continue;
    const classified = r.verdict === 'empty' ? EMPTY_CAUSES.includes(r.emptyCause) && r.applies?.applies === true : true;
    unexamined.push({
      validator: r.key,
      name: r.name || r.key,
      verdict: r.verdict,
      cause: EMPTY_CAUSES.includes(r.emptyCause) ? r.emptyCause : (r.verdict === 'empty' ? 'not-yet-classified' : null),
      reason: r.applicability?.reason || null,
      howToConfigure: typeof r.howToConfigure === 'string' && r.howToConfigure ? r.howToConfigure : null,
      newIn: null,
      blocking: !lite && classified,
    });
  }
  return {
    evaluated: !lite,
    unexamined,
    blocking: unexamined.filter(u => u.blocking).map(u => u.validator),
    gating: [...gatingByCode].map(([code, count]) => ({ code, count })).sort((a, b) => a.code.localeCompare(b.code)),
    pending: [],
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
  const shown = strict.unexamined.filter(u => u.blocking || u.cause === 'not-yet-classified');
  for (const u of shown) {
    if (u.cause === 'not-yet-classified') {
      lines.push(`  • ${u.name} applies here and examined nothing — cause not yet classified (does not fail this run). ${u.reason || ''}`.trimEnd());
    } else {
      const head = `  • ${u.name} is ${u.verdict}${u.cause ? ` (${u.cause})` : ''}${u.newIn ? ` — new in v${u.newIn}` : ''}`;
      lines.push(head);
      const fix = u.howToConfigure || u.reason;
      if (fix) lines.push(`      ${fix}`);
    }
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

/** True when this run's exit code is decided by strict (an unexamined blocking validator). */
export function strictBlocks(data) {
  return (data?.strict?.blocking?.length || 0) > 0;
}
