/**
 * Requirement-Anchors validator: code→requirement tags whose requirement does
 * not exist, and anchors read below their exact tier.
 *
 * Spec: specs/070-requirement-anchors (docguard.requirement-anchors).
 *
 * Opt-in (FR-026): a project without `.docguard-anchor-lock.jsonl` and without
 * `anchors.enabled` is not applicable, so its guard output is unchanged.
 * Guard reports only `warn` and `error`; the informational codes (ANC004
 * unreviewed, ANC006 ambiguous scope) are listed by `docguard anchors`.
 *
 * @implements docguard.requirement-anchors#FR-020
 * @implements docguard.requirement-anchors#FR-026
 */

import { mkFinding, resultFromFindings } from '../findings.mjs';
import { anchorsActivated, computeLinks } from '../scanners/anchors.mjs';

const MAX_FINDINGS = 25;

/** Anchor tier → the finding's closed parser-tier vocabulary. */
export function parserTierOf(tier) {
  if (!tier) return 'not-applicable';
  if (tier.startsWith('babel@')) return 'js-ast';
  if (tier.startsWith('python-ast@')) return 'py-ast';
  if (tier.startsWith('pattern@') || tier.startsWith('treesitter@')) return 'fallback-language';
  return 'not-applicable';
}

export function validateRequirementAnchors(projectDir, config = {}, { links = null } = {}) {
  // Decide applicability BEFORE reading any source: a project that has not
  // opted in pays nothing for this validator (FR-026, FR-041).
  if (!links && !anchorsActivated(projectDir, config)) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }
  const computed = links || computeLinks(projectDir, config);
  const findings = [];
  for (const p of computed.problems) {
    if (p.code === 'ANC007') {
      findings.push(mkFinding({
        code: 'ANC007', validator: 'requirementAnchors', severity: 'warn', confidence: 'high', disposition: 'act',
        parserTier: parserTierOf(p.tier), message: p.message,
        location: p.line ? { file: p.file, line: p.line } : p.file,
        suggestion: { kind: 'review', text: 'Qualify the tag with the Spec ID that declares the requirement, fix the ID, or remove the tag' },
      }));
    } else if (p.code === 'ANC010') {
      findings.push(mkFinding({
        code: 'ANC010', validator: 'requirementAnchors', severity: 'warn', confidence: p.confidence === 'low' ? 'low' : 'high', disposition: 'escalate',
        parserTier: parserTierOf(p.tier), message: p.message, location: p.file,
        suggestion: { kind: 'review', text: 'Install the missing parser or fix the file; untrack a committed .docguard/ with `git rm --cached -r .docguard`' },
      }));
    }
  }
  const total = computed.links.length + findings.filter(f => f.code === 'ANC007').length;
  const shown = findings.slice(0, MAX_FINDINGS);
  const result = resultFromFindings(shown, { passed: computed.links.length, total: Math.max(1, total), applicable: true });
  const degraded = computed.files.filter(f => f.degraded).length;
  return degraded
    ? { ...result, applicability: { status: 'partial', reason: `${degraded} tagged file(s) were anchored below their exact tier` } }
    : result;
}
