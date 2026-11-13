/**
 * What `docguard init` and the setup wizard say and write about the enforcement mode
 * (specs/097-strict-by-default FR-017). Strict is the default, so a project that makes
 * no choice gets no `enforcement` key: the key is written only for an explicit
 * `--enforcement <mode>`, or for a wizard answer that is not the default.
 *
 * @implements docguard.strict-by-default#FR-017
 */
import { DEFAULT_MODE, ENFORCEMENT_MODES } from './enforcement.mjs';

/** The validated value of `--enforcement`; throws a message fit for the user on anything else. */
export function parseEnforcementFlag(value) {
  if (!ENFORCEMENT_MODES.includes(value)) {
    throw new Error(`--enforcement must be "strict" or "standard", got ${JSON.stringify(value)}`);
  }
  return value;
}

/** The wizard's question, in plain words: what strict adds, and that it is the default. */
export const WIZARD_QUESTION = [
  'How strict should `docguard guard` be?',
  '  strict (the default): fails the run (exit 4) when a check that applies to your project',
  '    examined nothing, for example no API reference although you have routes, and tells you what to add.',
  '  standard: reports such a check and lets the run pass.',
];

/** `strict` for Enter, y, yes or strict; `standard` for n, no or standard; null for anything else (ask again). */
export function parseWizardAnswer(answer) {
  const a = String(answer).trim().toLowerCase();
  if (['', 'y', 'yes', 'strict'].includes(a)) return 'strict';
  if (['n', 'no', 'standard'].includes(a)) return 'standard';
  return null;
}

/**
 * The mode to write into `.docguard.json`, or null to write no key. An explicit flag is always written;
 * a wizard answer only when it is not the default, so a project that chose what it would get anyway
 * keeps a configuration that stays on the default when the default grows.
 */
export function enforcementToWrite({ flagMode = null, wizardMode = null } = {}) {
  if (flagMode) return flagMode;
  if (wizardMode && wizardMode !== DEFAULT_MODE) return wizardMode;
  return null;
}

/** The closing lines that state the mode this project now has and how to change it. */
export function enforcementClosingLines(mode, { written }) {
  const source = written ? 'set by "enforcement" in .docguard.json' : 'the default, no "enforcement" key written';
  if (mode === 'strict') {
    return [
      `Enforcement: strict (${source}).`,
      '  guard exits 4 when a check that applies to this project examined nothing, and says what to add.',
      '  To report such a check without failing the run, set "enforcement": "standard" in .docguard.json.',
    ];
  }
  return [
    `Enforcement: standard (${source}).`,
    '  guard reports a check that examined nothing but does not fail the run for it.',
    '  Strict, which fails the run, is the default: remove the key, or set "enforcement": "strict".',
  ];
}

/** The mode a project initialized with `written` (a mode or null) will run under. */
export function modeAfterInit(written) {
  return written || DEFAULT_MODE;
}
