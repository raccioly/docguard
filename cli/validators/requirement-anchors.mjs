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
import { getRequirementDocPaths } from '../scanners/requirement-docs.mjs';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { contractFields } from '../shared-result-contract.mjs';
import { classifyRequirements, hasPlaceholderText } from '../shared-requirement-definition.mjs';
import { explainPaddedEmpty, firstProductSource, sample } from '../shared-project-evidence.mjs';

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

// A declaration-shaped line that opens with an ID the default patterns do not read (FR-1: one digit, R-12: one letter).
const LOOSE_ID = /^\s{0,3}(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|\|\s*)?[\s*`_]*([A-Z]{1,6}-\d{1,5})\b/;

/** Requirement-like IDs in the requirement documents that the active patterns do not read, with the first document that has them. */
function unreadIds(projectDir, config, patterns) {
  const found = new Map();
  for (const doc of getRequirementDocPaths(projectDir, config)) {
    let text;
    try { text = readFileSync(doc, 'utf-8'); } catch { continue; }
    let fence = false;
    for (const line of text.split('\n')) {
      if (/^\s{0,3}(`{3,}|~{3,})/.test(line)) { fence = !fence; continue; }
      if (fence) continue;
      const m = line.match(LOOSE_ID);
      if (!m || hasPlaceholderText(line)) continue;
      if (patterns.some(p => { p.lastIndex = 0; return p.test(m[1]); })) continue;
      if (!found.has(m[1])) found.set(m[1], relative(projectDir, doc).replace(/\\/g, '/'));
    }
  }
  return found;
}

/**
 * Does this kind of check belong to the project? It does when the project
 * declares requirement IDs and has product source code to tag.
 *
 * A requirement ID is an FR, NFR, SC or REQ identifier declared in a spec or
 * requirement document (specs/<feature>/spec.md, docs-canonical/, REQUIREMENTS.md,
 * the documents named by traceability.requirementDocs), and not in a decision
 * record, an open-item or question list or a task list. Task IDs (T001),
 * design-element IDs (ARCH, MOD, SYS) and story, use-case and acceptance IDs (US,
 * STORY, UC, AC) are not counted. When the project configures its own
 * `traceability.requirementPattern`, that pattern is the definition and every ID it
 * reads counts. A template row such as "System MUST [capability]" declares none,
 * and a lint, test-runner or ORM configuration file is not product source.
 * Requirement-like IDs in a form the scanner does not read are a layout it does
 * not recognize. Writing the tags, and opting in, is the declaration the validator
 * then asks for (specs/097-strict-by-default FR-006).
 *
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}) {
  const { patterns, custom, real, placeholders, skipped, skippedText } = classifyRequirements(projectDir, config);
  const source = firstProductSource(projectDir, config);
  if (real.length === 0) {
    const loose = source ? unreadIds(projectDir, config, patterns) : new Map();
    if (loose.size >= 2) {
      const [first, file] = [...loose.entries()][0];
      return { applies: true, kind: 'unrecognized', ids: [...loose.keys()], file, evidence: `${loose.size} requirement-like ID(s) in a form the scanner does not read (${sample([...loose.keys()])}, first in ${file}) and source code (${source})` };
    }
    return { applies: false, evidence: placeholders
      ? `${placeholders} requirement line(s) are template placeholders (such as "System MUST [capability]"), so no requirement is declared yet`
      : skipped.size
        ? `the IDs found are not requirements (${skippedText} identifier(s): decision records, open-item lists, task lists, design elements, stories and acceptance checks); a requirement is an FR, NFR, SC or REQ ID in a spec or requirement document, or an ID read by traceability.requirementPattern`
        : 'no spec or requirement document declares a requirement ID, so there is nothing for a source tag to cite' };
  }
  const ids = sample(real.map(d => d.specId ? `${d.specId}#${d.id}` : d.id));
  const counted = custom ? 'ID(s) read by traceability.requirementPattern' : 'FR/NFR/SC/REQ requirement ID(s)';
  if (!source) return { applies: false, evidence: `${real.length} ${counted} are declared (${ids}) but the project has no product source file to tag (configuration files do not count)` };
  const withSpec = real.find(d => d.specId);
  return { applies: true, kind: 'recognized', example: withSpec ? `${withSpec.specId}#${withSpec.id}` : null, evidence: `${real.length} ${counted} are declared (${ids}${skipped.size ? `; not counted: ${skippedText} identifier(s)` : ''}) and the project has source code (${source}), so code can cite them` };
}

const SPEC_ID_HOW = d => `Qualify each tag with the Spec ID of the spec that declares the requirement${d.example ? `, such as \`// @implements ${d.example}\`` : ', such as `// @implements <spec-id>#FR-001`'}. A Spec ID is declared in the spec itself: a \`**Spec ID**: <unique-id>\` line under the title of specs/<feature>/spec.md (or \`<!-- docguard:spec-id <unique-id> -->\`), and \`docguard specs --write\` records it; a spec that has none needs one added, because a bare FR-001 collides (ANC007) as soon as two specs declare it.`;
const ENABLE_HOW = d => `Set "anchors": { "enabled": true } in .docguard.json, then tag the code that implements a requirement with a comment, and record the review with \`docguard anchors accept --baseline --bulk --reason "<what you checked>"\`. ${SPEC_ID_HOW(d)} Anchors are links a person reviews: DocGuard does not tag your code.`;
const TAG_HOW = d => `Anchors are enabled but no source file carries a tag that cites a requirement. Tag the code that implements one with a comment. ${SPEC_ID_HOW(d)} \`docguard anchors\` lists the requirements still untagged; record the review with \`docguard anchors accept --baseline --bulk --reason "<what you checked>"\`.`;
const UNREAD_HOW = d => `Requirement-Anchors reads requirement IDs shaped REQ, FR, NFR, US, STORY, AC, UC, SYS, ARCH, MOD or SC followed by two to four digits, at the start of a list item, heading or table row. ${d.file} declares ${sample(d.ids)}, which that reading does not match. Set "traceability": { "requirementPattern": "<regex>" } in .docguard.json to read your form (a pattern with a prefix and digits, such as \`\\\\b(FR)-(\\\\d{1,4})\\\\b\`); this is a limit of the default reading, and nothing in your documents needs to change.`;
const NOTHING_HOW = 'Nothing to configure unless the project declares requirement IDs (for example `- **FR-001**: …` in specs/<feature>/spec.md, with real text rather than a template placeholder) and has product source code that implements them.';

export function validateRequirementAnchors(projectDir, config = {}, { status = null } = {}) {
  // Decide applicability BEFORE reading any source: a project that has not
  // opted in pays nothing for this validator (FR-026, FR-041).
  if (!status && !anchorsActivated(projectDir, config)) {
    return {
      ...resultFromFindings([], { passed: 0, total: 0, applicable: false }),
      ...contractFields({
        performed: 0,
        decide: () => applies(projectDir, config),
        empty: d => (d.kind === 'unrecognized'
          ? { emptyCause: 'layout-not-recognized', note: `Requirement-Anchors found requirement IDs it does not read: ${d.evidence}.`, howToConfigure: UNREAD_HOW(d) }
          : d.applies
            ? { emptyCause: 'needs-declaration', note: `Requirement-Anchors is not enabled: ${d.evidence}, but the project has no ${ANCHOR_LOCK_PATH} and sets no anchors.enabled.`, howToConfigure: ENABLE_HOW(d) }
            : { emptyCause: 'nothing-of-this-kind', note: `Requirement-Anchors found no requirement to anchor: ${d.evidence}.`, howToConfigure: NOTHING_HOW }),
      }),
    };
  }
  const computed = status || computeAnchorStatus(projectDir, config);
  const policy = failOnPolicy(config);
  const findings = [];
  for (const p of computed.problems) {
    const rule = CODES[p.code];
    if (!rule) continue; // ANC004, ANC006 and ANC011 are listed by `docguard anchors` only
    // FR-028: only reviewed, exact-tier, precisely scoped links fail, and only under failOn.
    const severity = isFailingProblem(p, policy) ? 'error' : rule.severity;
    findings.push(mkFinding({
      code: p.code, validator: 'requirementAnchors', severity, confidence: p.confidence === 'low' ? 'low' : 'high',
      disposition: rule.disposition, parserTier: parserTierOf(p.tier), message: p.message,
      location: p.line ? { file: p.file, line: p.line } : p.file,
      suggestion: suggestionFor(projectDir, p),
    }));
  }
  const counted = computed.links.filter(l => ['reviewed', 'baselined', 'unreviewed', 'moved'].includes(l.state)).length;
  // Every error is shown (an error count must equal what `specs complete`
  // exempts, FR-029); warnings are capped to keep the report readable.
  const shown = [...findings.filter(f => f.severity === 'error'), ...findings.filter(f => f.severity !== 'error').slice(0, MAX_FINDINGS)];
  // `total` is padded to 1 so an enabled validator prints 1 check, not 0/0; that
  // pad is not a check. `performed` is the links actually compared, so enabled
  // with zero anchors is `empty`, not `pass` (specs/097-strict-by-default FR-004).
  const result = { ...resultFromFindings(shown, { passed: counted, total: Math.max(1, computed.links.length + (computed.lost?.length || 0)), applicable: true }), performed: counted };
  const degraded = computed.files.filter(f => f.degraded).length;
  const decision = () => applies(projectDir, config);
  const contract = explainPaddedEmpty(contractFields({
    performed: counted,
    found: shown.length > 0,
    ran: `${counted} anchor link(s) compared with their requirement and code`,
    decide: decision,
    empty: d => (d.kind === 'unrecognized'
      ? { emptyCause: 'layout-not-recognized', note: `Requirement-Anchors is enabled but the requirement IDs are in a form it does not read: ${d.evidence}.`, howToConfigure: UNREAD_HOW(d) }
      : d.applies
        ? { emptyCause: 'needs-content', note: `Requirement-Anchors is enabled but no source file carries a requirement tag: ${d.evidence}.`, howToConfigure: TAG_HOW(d) }
        : { emptyCause: 'nothing-of-this-kind', note: `Requirement-Anchors is enabled but found no requirement to anchor: ${d.evidence}.`, howToConfigure: NOTHING_HOW }),
  }));
  return degraded
    ? { ...result, ...contract, applicability: { status: 'partial', reason: `${degraded} tagged file(s) were anchored below their exact tier` } }
    : { ...result, ...contract };
}
