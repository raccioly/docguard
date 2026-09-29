import { mkFinding, resultFromFindings } from '../findings.mjs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectSpecRegistry, SPEC_REGISTRY_PATH } from '../scanners/spec-registry.mjs';
import { checkAsBuiltSync } from '../scanners/as-built.mjs';

/**
 * @implements docguard.lifecycle-evidence-gaps#FR-001
 * @implements docguard.as-built-specs#FR-005
 */

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
  // SPR006 (docguard.lifecycle-evidence-gaps#FR-001): work is claimed (a task
  // is checked) but no source file says which requirement it implements.
  // Without this, the gap surfaced only at `specs complete`, after the fact,
  // and reconcile meanwhile called the changed sources unsupported.
  for (const spec of projection.registry.specs) {
    if ((spec.observed?.taskCompletion?.checked || 0) === 0) continue;
    if ((spec.observed?.implementationEvidence || []).length > 0) continue;
    const firstReq = spec.intent?.requirements?.[0] || `${spec.specId}#FR-001`;
    findings.push(mkFinding({
      code: 'SPR006',
      validator: 'specRegistry',
      severity: 'warn',
      confidence: 'high',
      disposition: 'escalate',
      message: `${spec.specId}: ${spec.observed.taskCompletion.checked} task(s) checked but no source file carries an @implements annotation for any of its requirements`,
      location: spec.path,
      suggestion: {
        kind: 'review',
        text: `Annotate the implementing code, e.g. \`// @implements ${firstReq}\` (or \`# @implements …\` in Python/YAML), then run \`docguard specs --write\`. If nothing is implemented yet, uncheck the tasks.`,
      },
    }));
  }
  // SPR007 (docguard.as-built-specs#FR-005): an as-built spec must keep
  // describing its source paths — code nobody accounted for, and cited facts
  // that no longer exist, are both drift.
  const MAX_PER_SPEC = 10;
  for (const spec of projection.registry.specs) {
    if (spec.reviewed?.lifecycle?.origin !== 'as_built') continue;
    const sourcePaths = spec.reviewed?.scope?.sourcePaths || [];
    if (sourcePaths.length === 0) continue;
    let content;
    try { content = readFileSync(resolve(projectDir, spec.path), 'utf8'); } catch { continue; }
    const { unclaimed, vanished } = checkAsBuiltSync(projectDir, content, sourcePaths, config);
    const items = [
      ...unclaimed.map(f => ({ text: `${f.kind} \`${f.key}\`${f.file ? ` (${f.file})` : ''} is in the code under ${sourcePaths.join(', ')} but the spec neither specifies it nor lists it under Out of Scope`, fix: `Add a requirement carrying <!-- docguard:fact ${f.kind} ${f.key} -->, or move that marker under ## Out of Scope with a reason` })),
      ...vanished.map(id => ({ text: `${id.replace(' ', ' `')}\` is cited by the spec but no longer exists in the code`, fix: 'Update or remove the requirement: the code it described has changed' })),
    ];
    for (const item of items.slice(0, MAX_PER_SPEC)) {
      findings.push(mkFinding({
        code: 'SPR007',
        validator: 'specRegistry',
        severity: 'warn',
        confidence: 'high',
        disposition: 'escalate',
        message: `${spec.specId} (as-built): ${item.text}`,
        location: spec.path,
        suggestion: { kind: 'review', text: item.fix },
      }));
    }
    if (items.length > MAX_PER_SPEC) {
      findings.push(mkFinding({
        code: 'SPR007', validator: 'specRegistry', severity: 'warn', confidence: 'high', disposition: 'escalate',
        message: `${spec.specId} (as-built): …and ${items.length - MAX_PER_SPEC} more drifted fact(s)`,
        location: spec.path,
        suggestion: { kind: 'review', text: 'Resolve the facts above and re-run guard to see the rest' },
      }));
    }
  }
  const checks = Math.max(1, projection.registry.specs.length + projection.registry.tombstones.length);
  return resultFromFindings(findings, {
    passed: Math.max(0, checks - findings.length),
    total: checks,
    applicable: true,
  });
}
