/**
 * Requirement-Anchors validator: reviewed code→requirement links whose code or
 * requirement changed, links whose code is gone, tags that cite nothing, and
 * anchors read below their exact tier.
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
 * @implements docguard.requirement-anchors#FR-028
 */

import { mkFinding, resultFromFindings } from '../findings.mjs';
import { revisionResolves } from '../scanners/doc-deps.mjs';
import { ANCHOR_LOCK_PATH, anchorsActivated, computeAnchorStatus, failOnPolicy, isFailingProblem } from '../scanners/anchors.mjs';

const MAX_FINDINGS = 25;

/** Anchor tier → the finding's closed parser-tier vocabulary. */
export function parserTierOf(tier) {
  if (!tier) return 'not-applicable';
  if (tier.startsWith('babel@')) return 'js-ast';
  if (tier.startsWith('python-ast@')) return 'py-ast';
  if (tier.startsWith('pattern@') || tier.startsWith('treesitter@')) return 'fallback-language';
  return 'not-applicable';
}

export const acceptCommand = key => `docguard anchors accept --link '${key}' --reason "<what you checked>"`;

/** The guard-reportable codes, with their fixed severity and disposition (FR-020). */
const CODES = {
  ANC001: { severity: 'warn', disposition: 'escalate' },
  ANC002: { severity: 'warn', disposition: 'escalate' },
  ANC003: { severity: 'warn', disposition: 'escalate' },
  ANC005: { severity: 'error', disposition: 'act' },
  ANC007: { severity: 'warn', disposition: 'act' },
  ANC008: { severity: 'warn', disposition: 'act' },
  ANC009: { severity: 'warn', disposition: 'act' },
  ANC010: { severity: 'warn', disposition: 'escalate' },
};

function suggestionFor(projectDir, p) {
  switch (p.code) {
    case 'ANC001': {
      const diff = p.revision && revisionResolves(projectDir, p.revision) ? `git diff ${p.revision.slice(0, 12)} -- ${p.file}` : `open ${p.file}`;
      return { kind: 'review', text: `Review the change (${diff}); if the code still meets the requirement, run \`${acceptCommand(p.key)}\``, command: diff };
    }
    case 'ANC002': return { kind: 'review', text: `Read the new requirement text against the code, then run \`${acceptCommand(p.key)}\`` };
    case 'ANC003': return { kind: 'review', text: 'Restore the tag where the requirement is now implemented, or remove the link with `docguard anchors accept --remove <key> --reason "…"`' };
    case 'ANC005': return { kind: 'review', text: `Restore ${ANCHOR_LOCK_PATH} from git, or delete it and baseline again with \`docguard anchors accept --baseline --bulk --reason "…"\`` };
    case 'ANC007': return { kind: 'review', text: 'Qualify the tag with the Spec ID that declares the requirement, fix the ID, or remove the tag' };
    case 'ANC008': return { kind: 'review', text: 'Point the tag at the requirement that replaced the retired one, or remove it' };
    case 'ANC009': return { kind: 'review', text: 'Review the link, then accept it again; that rewrites one entry and resolves the conflict' };
    default: return { kind: 'review', text: 'Install the missing parser or fix the file; untrack a committed .docguard/ with `git rm --cached -r .docguard`' };
  }
}

export function validateRequirementAnchors(projectDir, config = {}, { status = null } = {}) {
  // Decide applicability BEFORE reading any source: a project that has not
  // opted in pays nothing for this validator (FR-026, FR-041).
  if (!status && !anchorsActivated(projectDir, config)) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }
  const computed = status || computeAnchorStatus(projectDir, config);
  const policy = failOnPolicy(config);
  const findings = [];
  for (const p of computed.problems) {
    const rule = CODES[p.code];
    if (!rule) continue; // ANC004 and ANC006 are listed by `docguard anchors` only
    // FR-028: only reviewed, exact-tier, precisely scoped links fail, and only under failOn.
    const severity = isFailingProblem(p, policy) ? 'error' : rule.severity;
    findings.push(mkFinding({
      code: p.code, validator: 'requirementAnchors', severity, confidence: p.confidence === 'low' ? 'low' : 'high',
      disposition: rule.disposition, parserTier: parserTierOf(p.tier), message: p.message,
      location: p.line ? { file: p.file, line: p.line } : p.file,
      suggestion: suggestionFor(projectDir, p),
    }));
  }
  const counted = computed.links.filter(l => l.state === 'reviewed' || l.state === 'baselined' || l.state === 'unreviewed').length;
  // Every error is shown (an error count must equal what `specs complete`
  // exempts, FR-029); warnings are capped to keep the report readable.
  const shown = [...findings.filter(f => f.severity === 'error'), ...findings.filter(f => f.severity !== 'error').slice(0, MAX_FINDINGS)];
  const result = resultFromFindings(shown, { passed: counted, total: Math.max(1, computed.links.length + (computed.lost?.length || 0)), applicable: true });
  const degraded = computed.files.filter(f => f.degraded).length;
  return degraded
    ? { ...result, applicability: { status: 'partial', reason: `${degraded} tagged file(s) were anchored below their exact tier` } }
    : result;
}
