import { mkFinding, resultFromFindings } from '../findings.mjs';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { assetPathCovers, projectSpecRegistry, SPEC_REGISTRY_PATH } from '../scanners/spec-registry.mjs';
import { checkAsBuiltSync, isPatternTier } from '../scanners/as-built.mjs';
import { danglingRevisions, isShallowRepository } from '../scanners/revision-anchor.mjs';
import { gitMetadataStatus, listTrackedFiles } from '../shared-git.mjs';

/**
 * @implements docguard.lifecycle-evidence-gaps#FR-001
 * @implements docguard.as-built-specs#FR-005
 * @implements docguard.completion-revision-anchoring#FR-002
 * @implements docguard.asset-path-attribution#FR-003
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
    const { unclaimed, vanished, tiers } = checkAsBuiltSync(projectDir, content, sourcePaths, config);
    // A route or entity read by the pattern fallback may be missing only
    // because the fallback cannot see it: the finding says which analyzer
    // read it and drops to low confidence (docguard.python-extraction#FR-013).
    const tierOf = (kind, factTier) => (kind === 'route' || kind === 'entity' ? factTier || tiers?.[kind]?.tier || 'not-applicable' : 'not-applicable');
    const items = [
      ...unclaimed.map(f => ({ tier: tierOf(f.kind, f.tier), text: `${f.kind} \`${f.key}\`${f.file ? ` (${f.file})` : ''} is in the code under ${sourcePaths.join(', ')} but the spec neither specifies it nor lists it under Out of Scope`, fix: `Add a requirement carrying <!-- docguard:fact ${f.kind} ${f.key} -->, or move that marker under ## Out of Scope with a reason` })),
      ...vanished.map(id => ({ tier: tierOf(id.split(' ')[0]), text: `${id.replace(' ', ' `')}\` is cited by the spec but no longer exists in the code`, fix: 'Update or remove the requirement: the code it described has changed' })),
    ];
    for (const item of items.slice(0, MAX_PER_SPEC)) {
      findings.push(mkFinding({
        code: 'SPR007',
        validator: 'specRegistry',
        parserTier: item.tier,
        severity: 'warn',
        confidence: isPatternTier(item.tier) ? 'low' : 'high',
        disposition: 'escalate',
        message: `${spec.specId} (as-built): ${item.text}`,
        location: spec.path,
        suggestion: { kind: 'review', text: item.fix },
      }));
    }
    if (items.length > MAX_PER_SPEC) {
      const rest = items.slice(MAX_PER_SPEC);
      const weak = rest.find(item => isPatternTier(item.tier));
      findings.push(mkFinding({
        code: 'SPR007', validator: 'specRegistry', severity: 'warn', disposition: 'escalate',
        parserTier: weak ? weak.tier : 'not-applicable', confidence: weak ? 'low' : 'high',
        message: `${spec.specId} (as-built): …and ${items.length - MAX_PER_SPEC} more drifted fact(s)`,
        location: spec.path,
        suggestion: { kind: 'review', text: 'Resolve the facts above and re-run guard to see the rest' },
      }));
    }
  }
  // SPR009 (docguard.asset-path-attribution#FR-003): a reviewed asset path
  // that covers no file grants nothing, and left in place it reads as an
  // ownership record for files that are gone.
  const withAssets = projection.registry.specs.filter(spec => (spec.reviewed?.scope?.assetPaths || []).length);
  if (withAssets.length) {
    const tracked = listTrackedFiles(projectDir);
    const covered = assetPath => (tracked
      ? tracked.some(file => assetPathCovers(assetPath, file))
      : hasFileOnDisk(resolve(projectDir, assetPath), assetPath.endsWith('/')));
    for (const spec of withAssets) {
      for (const assetPath of spec.reviewed.scope.assetPaths.filter(p => !covered(p))) {
        findings.push(mkFinding({
          code: 'SPR009',
          validator: 'specRegistry',
          severity: 'warn',
          confidence: 'high',
          disposition: 'act',
          message: `${spec.specId} lists asset path ${assetPath}, which covers no ${tracked ? 'tracked ' : ''}file`,
          location: SPEC_REGISTRY_PATH,
          suggestion: { kind: 'fix', text: `Remove ${assetPath} from ${spec.specId}.reviewed.scope.assetPaths, or correct it to the files the spec owns` },
        }));
      }
    }
  }
  // SPR008 (docguard.completion-revision-anchoring#FR-002): a recorded review
  // revision that a squash merge discarded cannot anchor the next
  // reconciliation. A shallow clone cannot tell, so it reports partial.
  let partial = null;
  const hasRecorded = projection.registry.specs.some(spec => spec.reviewed?.reconciliation?.lastReviewedRevision
    || (spec.reviewed?.reconciliation?.outcomes || []).length);
  if (hasRecorded && gitMetadataStatus(projectDir).status === 'ok') {
    if (isShallowRepository(projectDir)) {
      partial = 'This is a shallow clone, so whether recorded review revisions are on this history (SPR008) could not be checked.';
    } else {
      for (const { specId, revision, reason } of danglingRevisions(projectDir, projection.registry)) {
        const spec = projection.registry.specs.find(entry => entry.specId === specId);
        findings.push(mkFinding({
          code: 'SPR008',
          validator: 'specRegistry',
          severity: 'warn',
          confidence: 'high',
          disposition: 'escalate',
          message: `${specId}: recorded review revision ${revision.slice(0, 12)} ${reason === 'missing' ? 'does not resolve in this repository' : 'is not on this branch\'s history'}; the next maintenance completion cannot reconcile from it`,
          location: spec?.path || SPEC_REGISTRY_PATH,
          suggestion: {
            kind: 'review',
            text: reason === 'missing'
              ? `Run \`docguard specs reanchor --id ${specId} --to <revision> --write --reason "<why that revision carries the reviewed evidence>"\``
              : `Run \`docguard specs reanchor --id ${specId} --write\` to move it to the commit with byte-identical evidence`,
            command: `docguard specs reanchor --id ${specId}`,
          },
        }));
      }
    }
  }
  const checks = Math.max(1, projection.registry.specs.length + projection.registry.tombstones.length);
  const result = resultFromFindings(findings, {
    passed: Math.max(0, checks - findings.length),
    total: checks,
    applicable: true,
  });
  return partial ? { ...result, applicability: { status: 'partial', reason: partial } } : result;
}

/** Outside git: a file exists, or a directory holds at least one file. */
function hasFileOnDisk(abs, isDir) {
  try {
    if (!isDir) return existsSync(abs) && statSync(abs).isFile();
    return readdirSync(abs, { recursive: true, withFileTypes: true }).some(entry => entry.isFile());
  } catch { return false; }
}
