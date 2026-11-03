/**
 * Required checks (specs/083-enforcement-ladder): validators a project depends
 * on must reach a decision in every gating run. A required check that found
 * nothing to judge (`empty`), could not decide (`inconclusive`) or could not
 * run (`blocked`) holds the gate, as a blocking AI-DLC sensor does; only a
 * reasoned in-repo N/A marker bypasses it. Read by guard and ci alike.
 *
 * Composes validator results after the loop (like Canonical-Sync), so it never
 * imports a validator (Constitution IV).
 *
 * @implements docguard.enforcement-ladder#FR-001
 * @implements docguard.enforcement-ladder#FR-002
 * @implements docguard.enforcement-ladder#FR-003
 */
import { mkFinding } from './findings.mjs';

const DECIDED = new Set(['pass', 'fail', 'skipped']);

/**
 * @param {object} config
 * @param {object[]} results validator results carrying `verdict` (spec 081)
 * @returns {{ undecided: object[], findings: object[], required: string[] }|null} null when nothing is required
 */
export function requiredCheckStatus(config, results) {
  const required = Array.isArray(config?.requiredChecks) ? [...new Set(config.requiredChecks.filter(k => typeof k === 'string'))] : [];
  if (required.length === 0) return null;
  const byKey = new Map(results.filter(r => r.key !== 'requiredChecks').map(r => [r.key, r]));
  const undecided = [];
  const findings = [];
  for (const key of required) {
    const r = byKey.get(key);
    if (!r) {
      findings.push(mkFinding({
        code: 'REQ002', validator: 'requiredChecks', severity: 'warn', confidence: 'high', disposition: 'act',
        message: `requiredChecks names "${key}", which is not a validator. Valid keys: ${[...byKey.keys()].join(', ')}`,
        location: '.docguard.json',
        suggestion: { kind: 'fix', text: `Correct or remove "${key}" in requiredChecks` },
      }));
      continue;
    }
    // A config switch is not a declaration that the check does not apply:
    // the configuration both requires and disables it.
    if (r.verdict === 'skipped' && r.applicability?.status === 'disabled') {
      findings.push(mkFinding({
        code: 'REQ001', validator: 'requiredChecks', severity: 'error', confidence: 'high', disposition: 'act',
        message: `${r.name || key} is required (requiredChecks) but disabled in config (validators.${key}: false)`,
        location: '.docguard.json',
        suggestion: { kind: 'fix', text: `Enable validators.${key}, or remove it from requiredChecks; to declare it does not apply, add a reasoned docguard:validator ${key} n/a marker instead` },
      }));
      continue;
    }
    if (!DECIDED.has(r.verdict)) {
      undecided.push({ key, name: r.name || key, verdict: r.verdict, reason: r.applicability?.reason || null });
    }
  }
  return { required, undecided, findings };
}
