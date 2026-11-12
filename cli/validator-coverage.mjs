/** Coverage describes what ran; a successful gate is not exhaustive assurance. */
import { existsSync } from 'node:fs';
import { resolveDocRole, docRolePath } from './shared-doc-roles.mjs';
const PREREQUISITES = { testSpec: 'testSpec', environment: 'environment', apiSurface: 'apiReference', architecture: 'architecture' };
const STATES = new Set(['checked', 'partial', 'disabled', 'not-applicable', 'missing-prerequisite', 'unsupported', 'no-matches', 'error']);
/**
 * The reason a status carries when nothing more specific is known; the compact
 * guard form states each once.
 *
 * @implements docguard.compact-guard-response#FR-007
 */
export const STANDARD_APPLICABILITY_REASONS = Object.freeze({
  checked: 'Completed the declared checks; this does not establish exhaustive language, framework, or semantic coverage.',
  disabled: 'Disabled by the effective configuration or selected command scope.',
  'no-matches': 'No checkable inputs matched this detector. This does not establish that the project has no relevant behavior.',
});
/**
 * The coarse axis that decides whether a skip is legitimate: only a check the
 * project disabled or declared N/A is `not-applicable`. Finding no inputs is
 * `unknown`, never proof that the check does not apply.
 * @implements docguard.verdict-contract#FR-002
 */
export const APPLICABILITY_CLASS = Object.freeze({
  checked: 'applicable', partial: 'applicable',
  disabled: 'not-applicable', 'not-applicable': 'not-applicable',
  'no-matches': 'unknown', 'missing-prerequisite': 'unknown', unsupported: 'unknown', error: 'unknown',
});

export const VERDICTS = Object.freeze(['pass', 'fail', 'empty', 'inconclusive', 'blocked', 'skipped']);

/** One reason naming each gap's operation, cause and scope. */
function gapReason(gaps) {
  const withheld = gaps.reduce((n, g) => n + (g.withheld || 0), 0);
  return 'Could not observe: ' + gaps.map(g => `${g.operation} (${g.cause}; ${g.scope?.count ?? 1} affected)`).join('; ')
    + (withheld ? `; ${withheld} absence finding${withheld === 1 ? '' : 's'} withheld` : '');
}

/**
 * What it takes for each validator to select something, shown next to a
 * validator that selected nothing (docguard.staleness-visibility#FR-001).
 * Every registered validator has an entry; `null` means it always selects
 * something in a DocGuard project, so emptiness needs no hint.
 */
export const CONFIGURE_HINTS = Object.freeze({
  __proto__: null,
  structure: null,
  docSections: 'Add the canonical documents (docguard init); their required sections are checked once they exist.',
  docsSync: 'Applies to projects with route or service directories (src/routes, src/services, src/lib, app/api); nothing to configure otherwise.',
  drift: 'Write `// DRIFT: <reason>` where code deliberately departs from the docs; each one is then checked against DRIFT-LOG.md.',
  changelog: 'Add a CHANGELOG.md (or set requiredFiles.changelog).',
  testSpec: 'Add docs-canonical/TEST-SPEC.md with its Source-to-Test Map.',
  environment: 'Add docs-canonical/ENVIRONMENT.md listing the environment variables the code reads.',
  security: 'Applies to code with secrets, auth or input handling; add docs-canonical/SECURITY.md.',
  architecture: 'Add docs-canonical/ARCHITECTURE.md with its layer rules.',
  freshness: 'Needs git history with at least 3 commits.',
  traceability: 'Give requirements IDs (FR-001) in REQUIREMENTS.md or specs/, and tag tests with them.',
  docsDiff: 'Add the canonical documents that list routes, entities, environment variables and tests.',
  apiSurface: 'Create docs-canonical/API-REFERENCE.md, or map docs.roles.apiReference to the document that lists the API.',
  metadataSync: 'Applies to a package that publishes versioned artifacts (extension.yml, versioned install URLs).',
  docsCoverage: null,
  docQuality: null,
  todoTracking: null,
  schemaSync: 'Applies when the project has schema files (Prisma, SQL migrations, ORM models) and a DATA-MODEL.md.',
  specKit: 'Initialize Spec Kit (specify init).',
  documentLifecycle: null,
  specRegistry: 'Run `docguard specs --write` in a Spec Kit project to create .docguard-specs.json.',
  docDependency: 'Add covers="path#symbol" to a docguard:section marker, then `docguard review --accept <doc>#<id> --reason "…"`.',
  requirementAnchors: 'Tag code with `@implements <spec>#FR-NNN`, then `docguard anchors accept --baseline --bulk --reason "…"` (or set anchors.enabled).',
  pathScopedRules: 'Applies when the project has agent instruction files (AGENTS.md, CLAUDE.md, rules, skills).',
  docOwnership: 'Add an ownership block to .docguard.json; `docguard trace --owners --suggest` drafts one.',
  evidence: 'Declare typed source-to-statement predicates in .docguard-evidence.json.',
  crossReference: null,
  generatedStaleness: 'Mark code-truth sections with `<!-- docguard:section … source=code -->`; `docguard sync` writes them.',
  surfaceSync: 'Set surfaceSync.surfaces in .docguard.json: a glob of code items and the document section that must list each one.',
  suppressions: null,
  diffSuspicion: 'Runs on a change: `docguard guard --changed-only`, or set diffSuspicion.since.',
  referenceExistence: null,
  apiDocSmells: 'Applies when the project has canonical documents with API sections.',
  decisionRecords: 'Applies when the project keeps decision records (docs/adr or docs/decisions).',
  aidlc: 'Applies to AWS AI-DLC projects (aidlc-docs/).',
  canonicalSync: null,
  metricsConsistency: null,
  requiredChecks: null,
});

/** The configuration hint for a validator key, or null. */
export function howToConfigure(key) {
  return CONFIGURE_HINTS[key] ?? null;
}

function baseCoverage(projectDir, config, result) {
  if (result.status === 'skipped') return { status: 'disabled', reason: STANDARD_APPLICABILITY_REASONS.disabled };
  if (result.note?.startsWith('declared N/A')) return { status: 'not-applicable', reason: result.note };
  if (STATES.has(result.applicability?.status) && typeof result.applicability.reason === 'string') return { status: result.applicability.status, reason: result.applicability.reason };
  if (result.total > 0) return { status: 'checked', reason: STANDARD_APPLICABILITY_REASONS.checked };
  const role = PREREQUISITES[result.key];
  if (role && !existsSync(resolveDocRole(projectDir, config, role))) return { status: 'missing-prerequisite', reason: 'No document available for role ' + role + ': ' + docRolePath(config, role) };
  return { status: 'no-matches', reason: result.note || STANDARD_APPLICABILITY_REASONS['no-matches'] };
}

/**
 * @implements docguard.verdict-contract#FR-002
 * @implements docguard.verdict-contract#FR-005
 */
export function describeCheckCoverage(projectDir, config, result) {
  const coverage = baseCoverage(projectDir, config, result);
  const gaps = Array.isArray(result.observations) ? result.observations : [];
  // A gap makes a complete-looking check partial; a more specific state stays.
  if (gaps.length && (coverage.status === 'checked' || coverage.status === 'no-matches')) {
    coverage.status = 'partial';
    coverage.reason = gapReason(gaps);
  }
  return { ...coverage, class: APPLICABILITY_CLASS[coverage.status] };
}

/**
 * The closed outcome of one validator in one run, from its own findings
 * (after baseline suppression), applicability and gaps. It describes the
 * check, not the gate: enforcement still decides the exit code.
 * @implements docguard.verdict-contract#FR-001
 * @implements docguard.verdict-contract#FR-003
 * @implements docguard.verdict-contract#FR-010
 */
export function deriveVerdict(result) {
  const state = result.applicability?.status;
  if (state === 'error') return 'blocked';
  if (APPLICABILITY_CLASS[state] === 'not-applicable') return 'skipped';
  const findings = Array.isArray(result.findings) ? result.findings.length : 0;
  if (findings > 0 || (result.errors?.length || 0) + (result.warnings?.length || 0) > 0) return 'fail';
  if ((result.observations?.length || 0) > 0 || state === 'partial' || state === 'missing-prerequisite' || state === 'unsupported') return 'inconclusive';
  if (state === 'no-matches') return 'empty';
  return 'pass';
}

/**
 * Run-level verdict counts and every gap with the validator it belongs to.
 * @implements docguard.verdict-contract#FR-012
 */
export function summarizeVerdicts(results) {
  const counts = Object.fromEntries(VERDICTS.map(v => [v, 0]));
  const gaps = [];
  for (const r of results) {
    counts[r.verdict]++;
    // A propagated entry only marks a validator that a gap elsewhere affected; it is not a gap itself.
    for (const g of r.observations || []) if (!g.propagated) gaps.push({ validator: r.key, ...g });
  }
  return { counts, gaps };
}
export function summarizeCheckCoverage(results) {
  const counts = Object.fromEntries([...STATES].map(status => [status, 0]));
  for (const result of results) counts[result.applicability.status]++;
  return { counts, limitations: results.filter(r => r.applicability.status !== 'checked').map(r => ({ key: r.key, name: r.name, ...r.applicability })),
    limitation: 'Check coverage is distinct from document inventory and factual accuracy. Unsupported or unmatched inputs remain unverified.' };
}
