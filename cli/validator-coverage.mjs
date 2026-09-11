/** Coverage describes what ran; a successful gate is not exhaustive assurance. */
import { existsSync } from 'node:fs';
import { resolveDocRole, docRolePath } from './shared-doc-roles.mjs';
const PREREQUISITES = { testSpec: 'testSpec', environment: 'environment', apiSurface: 'apiReference', architecture: 'architecture' };
const STATES = new Set(['checked', 'partial', 'disabled', 'not-applicable', 'missing-prerequisite', 'unsupported', 'no-matches', 'error']);
export function describeCheckCoverage(projectDir, config, result) {
  if (result.status === 'skipped') return { status: 'disabled', reason: 'Disabled by the effective configuration or selected command scope.' };
  if (result.note?.startsWith('declared N/A')) return { status: 'not-applicable', reason: result.note };
  if (STATES.has(result.applicability?.status) && typeof result.applicability.reason === 'string') return result.applicability;
  if (result.total > 0) return { status: 'checked', reason: 'Completed the declared checks; this does not establish exhaustive language, framework, or semantic coverage.' };
  const role = PREREQUISITES[result.key];
  if (role && !existsSync(resolveDocRole(projectDir, config, role))) return { status: 'missing-prerequisite', reason: 'No document available for role ' + role + ': ' + docRolePath(config, role) };
  return { status: 'no-matches', reason: result.note || 'No checkable inputs matched this detector. This does not establish that the project has no relevant behavior.' };
}
export function summarizeCheckCoverage(results) {
  const counts = Object.fromEntries([...STATES].map(status => [status, 0]));
  for (const result of results) counts[result.applicability.status]++;
  return { counts, limitations: results.filter(r => r.applicability.status !== 'checked').map(r => ({ key: r.key, name: r.name, ...r.applicability })),
    limitation: 'Check coverage is distinct from document inventory and factual accuracy. Unsupported or unmatched inputs remain unverified.' };
}
