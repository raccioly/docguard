import { mkFinding, resultFromFindings } from '../findings.mjs';
import { projectSpecRegistry, SPEC_REGISTRY_PATH } from '../scanners/spec-registry.mjs';

export function validateSpecRegistry(projectDir, config = {}) {
  const projection = projectSpecRegistry(projectDir, config);
  if (projection.detected === 0 && !projection.exists) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }
  const findings = projection.issues.map(issue => mkFinding({
    code: issue.code,
    validator: 'specRegistry',
    severity: 'warn',
    confidence: 'high',
    message: issue.message,
    location: issue.path,
    suggestion: issue.code === 'SPR002'
      ? {
          kind: 'review',
          text: 'Add a unique immutable Spec ID to the authoritative spec using the `**Spec ID**: <unique-id>` or `<!-- docguard:spec-id <unique-id> -->` form; then run `docguard specs --write`.',
        }
      : {
          kind: 'review',
          text: 'Resolve the lifecycle or registry integrity conflict, then refresh the registry.',
          command: 'docguard specs --write',
        },
  }));
  if (!projection.current && projection.issues.length === 0) {
    const detail = projection.differences.slice(0, 3)
      .map(difference => `${difference.path}: ${difference.message}`)
      .join(' ');
    findings.push(mkFinding({
      code: 'SPR001',
      validator: 'specRegistry',
      severity: 'warn',
      confidence: 'high',
      message: projection.exists
        ? `${SPEC_REGISTRY_PATH} does not match the current deterministic spec evidence projection.${detail ? ` ${detail}` : ''}`
        : `${SPEC_REGISTRY_PATH} is missing while active specifications exist.`,
      location: SPEC_REGISTRY_PATH,
      suggestion: {
        kind: 'fix',
        text: 'Refresh derived evidence without changing reviewed lifecycle fields.',
        command: 'docguard specs --write',
      },
    }));
  }
  const checks = Math.max(1, projection.registry.specs.length + projection.registry.tombstones.length);
  return resultFromFindings(findings, {
    passed: Math.max(0, checks - findings.length),
    total: checks,
    applicable: true,
  });
}
