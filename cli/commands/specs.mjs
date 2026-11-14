/**
 * Manage and preflight the deterministic spec lifecycle registry.
 * @implements docguard.document-lifecycle#FR-016
 * @implements docguard.document-lifecycle#FR-017
 * @implements docguard.document-lifecycle#FR-020
 * @implements docguard.spec-first-gate#FR-006
 * @implements docguard.spec-first-gate#FR-007
 * @implements docguard.first-spec-preflight#FR-005
 * @implements docguard.first-spec-preflight#FR-006
 * @implements docguard.first-spec-preflight#FR-008
 * @implements docguard.first-spec-preflight#FR-009
 * @implements docguard.first-spec-preflight#FR-010
 * @implements docguard.completion-one-commit#FR-001
 * @implements docguard.completion-one-commit#FR-002
 * @implements docguard.completion-one-commit#FR-003
 * @implements docguard.completion-one-commit#FR-004
 * @implements docguard.completion-one-commit#FR-005
 * @implements docguard.completion-one-commit#FR-007
 * @implements docguard.completion-one-commit#FR-008
 * @implements docguard.completion-one-commit#FR-011
 * @implements docguard.completion-one-commit#FR-012
 * @implements docguard.completion-upkeep#FR-004
 * @implements docguard.completion-upkeep#FR-005
 * @implements docguard.completion-upkeep#FR-006
 * @implements docguard.completion-upkeep#FR-007
 * @implements docguard.completion-upkeep#FR-009
 * @implements docguard.completion-upkeep#FR-010
 * @implements docguard.completion-upkeep#FR-011
 * @implements docguard.completion-upkeep#FR-012
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { commitFileTransaction } from '../writers/file-transaction.mjs';
import { ensureStateDir } from '../writers/state-dir.mjs';
import { appendImplementationOutcome, markSpecActive, readOutcomeBlobs, readSpecStatus, rewriteOutcomeRevision, writeOutcomeBlobs } from '../writers/spec-outcomes.mjs';
import { staleCompletions } from '../scanners/stale-completions.mjs';
import { commitsBetween, contentAnchor, evidenceBlobsAt, evidenceBlobsInTree, evidenceDifferences, findAnchor, isAncestorOf, lastCommitTouching, nonLifecycleChanges, reachableFromDefaultBranch, resolveCommit, reviewedCommitOnHistory, strandedRevisions } from '../scanners/revision-anchor.mjs';
import { serializeLifecycleContext } from '../scanners/lifecycle-context.mjs';
import { buildReconciliationPlan } from '../scanners/reconciliation.mjs';
import { canonicalOutcome, PERSISTENCE_VALUES, preflightSpec, projectSpecRegistry, readSpecRegistry, sortedUnique, SPEC_REGISTRY_PATH, unrecordedCompletions, untrackedRequirementEvidence } from '../scanners/spec-registry.mjs';
import { runGuardInternal } from './guard.mjs';
import { anchorsActivated, computeAnchorStatus, failOnPolicy, isFailingProblem } from '../scanners/anchors.mjs';
import { checkSpecFirst } from '../scanners/spec-first.mjs';

const CONTEXT_PATH = '.docguard/current-context.json';
const digest = content => `sha256:${createHash('sha256').update(content).digest('hex')}`;

export function normalizeExternalDeliveryStatus(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[ -]+/g, '_');
  return new Map([
    ['planned', 'planned'], ['in_progress', 'in_progress'], ['started', 'in_progress'],
    ['implemented', 'implemented'], ['complete', 'implemented'], ['completed', 'implemented'], ['done', 'implemented'],
    ['verified', 'verified'], ['validated', 'verified'], ['released', 'released'], ['shipped', 'released'],
  ]).get(normalized) || null;
}

function headRevision(projectDir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

// Completion may run several times against one revision before a single
// commit: the registry, the active context and outcome blocks it writes do
// not count as changes (docguard.completion-revision-anchoring#FR-001).
function blockingChanges(projectDir, registry, ownTaskLists = [], tagSpecId = null) {
  return nonLifecycleChanges(projectDir, {
    registryPath: SPEC_REGISTRY_PATH,
    contextPath: CONTEXT_PATH,
    specPaths: (registry?.specs || []).map(spec => spec.path),
    tickOnlyPaths: ownTaskLists,
    tagSpecId,
  });
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/**
 * "Unknown spec ID", with the closest recorded IDs when there are any.
 * @implements docguard.completion-upkeep#FR-012
 */
function unknownSpecMessage(id, specs) {
  const base = `Unknown spec ID: ${id || '<missing>'}.`;
  if (!id) return base;
  const wanted = String(id).toLowerCase();
  const near = (specs || []).map(entry => entry.specId)
    .map(candidate => ({ candidate, distance: editDistance(wanted, candidate.toLowerCase()), contains: candidate.toLowerCase().includes(wanted) || wanted.includes(candidate.toLowerCase()) }))
    .filter(item => item.contains || item.distance <= Math.max(3, Math.floor(wanted.length / 4)))
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, 3).map(item => `\`${item.candidate}\``);
  return near.length ? `${base} Did you mean ${near.join(', ')}?` : base;
}

/** The completing spec's own task list: ticking it is part of closing the spec (docguard.completion-one-commit#FR-001). */
function ownTaskLists(spec) {
  return (spec?.observed?.artifacts || []).map(artifact => artifact.path).filter(path => /(?:^|\/)tasks\.md$/i.test(path));
}

const SAFE_DOC = path => !path.startsWith('/') && !/^[a-zA-Z]:/.test(path) && !path.split(/[\\/]/).some(part => part === '..' || part === '.local' || part === '');

/**
 * Apply `--canonical-doc` and `--persistence` to a projected spec entry, in
 * memory, and say what is wrong with them. The registry is written only by the
 * caller, after the whole command is known to be allowed.
 * @implements docguard.completion-one-commit#FR-002
 * @implements docguard.completion-one-commit#FR-003
 */
function applyReviewedScope(projectDir, spec, flags) {
  const problems = [];
  let changed = false;
  if (flags.canonicalDocs !== undefined) {
    const docs = [];
    for (const raw of flags.canonicalDocs) {
      const path = String(raw).replace(/\\/g, '/').replace(/^\.\//, '');
      if (!path || !SAFE_DOC(path)) problems.push({ code: 'SPC005', message: `--canonical-doc ${raw} must be a repository-relative path outside .local.` });
      else if (!existsSync(resolve(projectDir, path))) problems.push({ code: 'SPC005', message: `--canonical-doc ${path} does not exist.` });
      else docs.push(path);
    }
    if (!problems.length) {
      const next = sortedUnique(docs);
      if (JSON.stringify(next) !== JSON.stringify(spec.reviewed.scope.canonicalDocs)) changed = true;
      spec.reviewed.scope.canonicalDocs = next;
    }
  }
  if (flags.persistence !== undefined) {
    if (!PERSISTENCE_VALUES.includes(flags.persistence)) {
      problems.push({ code: 'SPC002', message: `--persistence must be one of ${PERSISTENCE_VALUES.join(', ')}; found ${flags.persistence}.` });
    } else {
      if (spec.reviewed.lifecycle.persistenceModel !== flags.persistence) changed = true;
      spec.reviewed.lifecycle.persistenceModel = flags.persistence;
    }
  }
  return { problems, changed };
}

function describeChanges(changed) {
  if (changed === null) return 'Git status could not be read.';
  const shown = changed.slice(0, 5).join(', ');
  return `${shown}${changed.length > 5 ? `, and ${changed.length - 5} more` : ''}`;
}

function archiveReadiness(spec, targetVerified = false) {
  if (!spec) return { status: 'BLOCKED', reason: 'Spec identity is unresolved.' };
  const model = spec.reviewed.lifecycle.persistenceModel;
  const delivery = targetVerified ? 'verified' : spec.reviewed.lifecycle.delivery;
  if (model === 'living') return { status: 'KEEP_CURRENT', reason: 'Living specs remain in active context after verification.' };
  if (!model) return { status: 'REVIEW', reason: 'Choose a persistence model before retiring the verified spec.' };
  if (delivery !== 'verified' && delivery !== 'released') return { status: 'BLOCKED', reason: 'Spec must be verified before retirement.' };
  if (model === 'flow_forward' && !spec.reviewed.relations.supersededBy.length) {
    return { status: 'BLOCKED', reason: 'Flow-forward retirement requires a reviewed successor.' };
  }
  return { status: 'READY', reason: 'Run the reviewed spec retirement flow after the verified state is committed and retained.' };
}

// The transition from the recorded delivery state, whether or not the
// completion is allowed; blockers say why it is not.
function completionTransition(spec) {
  if (!spec) return null;
  const delivery = spec.reviewed.lifecycle.delivery;
  if (delivery === 'released') return 'released→released';
  if (delivery === 'in_progress') return 'in_progress→implemented→verified';
  return `${delivery}→verified`;
}


/** The completing spec's anchor findings that fail guard under its policy (FR-029). */
function ownFailingAnchors(projectDir, config, specId, shared = null) {
  if (!anchorsActivated(projectDir, config)) return [];
  // docguard.completion-upkeep#FR-006: the anchor status is the same for every spec of a batch.
  const status = shared ? (shared.anchorStatus ||= computeAnchorStatus(projectDir, config)) : computeAnchorStatus(projectDir, config);
  const policy = failOnPolicy(config);
  return status.problems
    .filter(p => isFailingProblem(p, policy) && typeof p.requirement === 'string' && p.requirement.startsWith(`${specId}#`))
    .map(p => ({ code: p.code, requirement: p.requirement, file: p.file, key: p.key,
      acceptCommand: p.code === 'ANC003' ? `docguard anchors accept --remove '${p.key}' --reason "…"` : `docguard anchors accept --link '${p.key}' --reason "<what you checked>"` }));
}
/**
 * What to say after the list of unresolved files: the newest commit that touched any of
 * them, and what choosing it as the baseline skips.
 * @implements docguard.completion-upkeep#FR-009
 */
function resolvingRefHint(projectDir, since, paths, hasRecordedReview) {
  const culprit = lastCommitTouching(projectDir, since, paths);
  if (!culprit) return ' No commit after the baseline would leave them out: annotate them, or list them under `reviewed.scope.assetPaths`.';
  const skipped = commitsBetween(projectDir, since, culprit);
  const where = `The earliest ref after which none of them changes is ${culprit.slice(0, 12)}${skipped === null ? '' : ` (it skips ${skipped} commit(s) of the range)`}`;
  return hasRecordedReview
    ? ` ${where}; a newer --since is accepted only when the range is too large to read, so annotate them or list them under \`reviewed.scope.assetPaths\` instead.`
    : ` ${where}: \`--since ${culprit.slice(0, 12)}\` leaves none unresolved, or annotate them or list them under \`reviewed.scope.assetPaths\`.`;
}

/**
 * Whether `--since` may stand in for a spec's recorded review revision. The
 * same revision or an older one only widens the review. A newer one skips
 * commits, so it is accepted only when the recorded range cannot be read
 * within the diff budgets even in batches, and the skipped range is returned
 * as `narrowedFrom` for the outcome to record.
 * @implements docguard.completion-revision-anchoring#FR-009
 */
function reviewBaseline(projectDir, config, spec, ref, runtime, recordedOverride = null) {
  const recorded = recordedOverride || spec.reviewed.reconciliation.lastReviewedRevision;
  const blocked = message => ({ blocker: { code: 'SPC006', message } });
  const recordedCommit = resolveCommit(projectDir, recorded);
  if (!recordedCommit) {
    return blocked(`The recorded review revision ${recorded.slice(0, 12)} does not resolve, so --since cannot be checked against it; run \`docguard specs reanchor --id ${spec.specId}\` first.`);
  }
  const sinceCommit = resolveCommit(projectDir, ref);
  // An unknown ref is reported by reconciliation as unsupported coverage.
  if (!sinceCommit || sinceCommit === recordedCommit || isAncestorOf(projectDir, sinceCommit, recordedCommit)) return {};
  const short = recordedCommit.slice(0, 12);
  if (!isAncestorOf(projectDir, recordedCommit, sinceCommit) || !isAncestorOf(projectDir, sinceCommit, 'HEAD')) {
    return blocked(`--since ${ref} is neither an ancestor nor a descendant of the recorded review revision ${short} on HEAD's history; omit --since, or re-anchor a revision a squash merge discarded with \`docguard specs reanchor --id ${spec.specId}\`.`);
  }
  const skippedCommits = commitsBetween(projectDir, recordedCommit, sinceCommit);
  const full = buildReconciliationPlan(projectDir, config, recordedCommit, runtime);
  if (full.status !== 'BLOCKED' || !['too-large', 'timeout'].includes(full.range?.status) || skippedCommits === null) {
    return blocked(`--since ${ref} would skip ${skippedCommits ?? 'some'} commit(s) after the recorded review revision ${short}, whose range can be reconciled; omit --since.`);
  }
  return { narrowedFrom: { revision: recordedCommit, since: sinceCommit, skippedCommits, reason: full.coverage.reason } };
}

/**
 * Where a spec's recorded review revision stands on HEAD's history: an ancestor
 * (`commit` is null: use it as it is), anchored by content (`commit` is the
 * commit that landed the same evidence), or lost (an outcome that carries
 * blob ids, with no commit on this history that has them). A record without
 * blob ids is not described: it behaves as it always did.
 * @implements docguard.completion-one-commit#FR-007
 */
function recordedBase(projectDir, spec, revision) {
  if (resolveCommit(projectDir, revision) && isAncestorOf(projectDir, revision)) return null;
  const found = contentAnchor(projectDir, spec, revision, { registryPath: SPEC_REGISTRY_PATH });
  if (!found.hasBlobs) return null;
  if (found.anchored) return { commit: found.commit };
  // docguard.completion-upkeep#FR-004: a branch that merged main reaches main's squash commit only
  // through the merge's second parent, and that commit still has the reviewed files.
  try {
    const blobs = readOutcomeBlobs(readFileSync(resolve(projectDir, spec.path), 'utf8'), revision);
    const reached = blobs && reviewedCommitOnHistory(projectDir, revision, blobs, { registryPath: SPEC_REGISTRY_PATH });
    if (reached) return { commit: reached };
  } catch { /* the spec cannot be read: the record is lost, as before */ }
  return { lost: true, differing: found.differing };
}

export function planSpecCompletion(projectDir, config, flags, options = {}) {
  const projection = projectSpecRegistry(projectDir, config);
  const loaded = readSpecRegistry(projectDir);
  const revision = headRevision(projectDir);
  const spec = projection.registry.specs.find(entry => entry.specId === flags.id);
  const blockers = [...projection.issues];
  if (spec) blockers.push(...applyReviewedScope(projectDir, spec, flags).problems);
  if (!flags.id) blockers.push({ code: 'SPC001', message: 'Completion requires --id <spec-id>.' });
  if (!loaded.exists || loaded.error || !projection.current) blockers.push({ code: 'SPC001', message: 'Committed registry must be current before completion.' });
  if (!spec) blockers.push({ code: 'SPC001', message: unknownSpecMessage(flags.id, projection.registry.specs) });
  if (!revision) blockers.push({ code: 'SPC001', message: 'Completion requires a resolvable Git HEAD.' });
  const changed = blockingChanges(projectDir, projection.registry, ownTaskLists(spec), spec?.specId || null);
  if (changed === null || changed.length) {
    blockers.push({ code: 'SPC001', message: `Completion requires a clean tracked working tree at the recorded revision (lifecycle files written by earlier completions, ticked boxes in this spec's own task list, and added @implements/@req tags for this spec's own requirements are allowed); changed: ${describeChanges(changed)}.` });
  }

  let reconcile = null;
  let narrowedFrom = null;
  let since = null;
  if (spec) {
    const maintenance = ['verified', 'released'].includes(spec.reviewed.lifecycle.delivery)
      && spec.reviewed.lifecycle.persistenceModel === 'living';
    if (spec.reviewed.lifecycle.approval !== 'approved') {
      blockers.push({ code: 'SPC002', message: `Only an approved spec can become verified. Record the approval with \`docguard specs approve --id ${spec.specId} --write\`.` });
    }
    if (!['in_progress', 'implemented'].includes(spec.reviewed.lifecycle.delivery) && !maintenance) {
      const hint = spec.reviewed.lifecycle.delivery === 'planned'
        ? ` Record the delivery state with \`docguard specs approve --id ${spec.specId} --delivery implemented --write\`.`
        : '';
      blockers.push({ code: 'SPC002', message: `Expected delivery=in_progress, implemented, or verified with persistenceModel=living; found ${spec.reviewed.lifecycle.delivery}/${spec.reviewed.lifecycle.persistenceModel || 'unset'}.${hint}` });
    }
    const tasks = spec.observed.taskCompletion;
    const hasTaskLedger = spec.observed.artifacts.some(artifact => /(?:^|\/)tasks\.md$/i.test(artifact.path));
    if (hasTaskLedger && (!tasks.total || tasks.checked !== tasks.total)) {
      blockers.push({ code: 'SPC003', message: `All declared tasks must be checked (${tasks.checked}/${tasks.total}).` });
    } else if (!hasTaskLedger && spec.reviewed.lifecycle.persistenceModel !== 'living') {
      blockers.push({
        code: 'SPC003',
        message: 'Completion requires a task ledger unless the approved spec is a living verification contract with qualified evidence for every requirement.',
      });
    }
    if (spec.observed.implementationEvidence.length === 0) blockers.push({ code: 'SPC004', message: 'At least one qualified source implementation annotation is required.' });
    if (spec.observed.testEvidence.length === 0) blockers.push({ code: 'SPC004', message: 'At least one qualified test annotation is required.' });
    const covered = new Set([...spec.observed.implementationEvidence, ...spec.observed.testEvidence].map(item => item.requirementId));
    const missing = spec.intent.requirements
      .map(identity => identity.slice(identity.lastIndexOf('#') + 1))
      .filter(id => !covered.has(id));
    if (missing.length) blockers.push({ code: 'SPC004', message: `Qualified implementation or test evidence is missing for: ${missing.join(', ')}.` });
    if (spec.reviewed.scope.canonicalDocs.length === 0) blockers.push({ code: 'SPC005', message: 'Completion requires at least one reviewed affected canonical document; record it with `--canonical-doc <path>` (repeatable).' });
    for (const path of spec.reviewed.scope.canonicalDocs) {
      if (!existsSync(resolve(projectDir, path))) blockers.push({ code: 'SPC005', message: `Affected canonical document is missing: ${path}.` });
    }
    const recordedRevision = spec.reviewed.reconciliation.lastReviewedRevision;
    // docguard.completion-one-commit#FR-007: a recorded revision a squash merge or a
    // rebase discarded is replaced, as the diff base, by the commit that landed the
    // same evidence; with none, a person names the base.
    const anchor = recordedRevision ? recordedBase(projectDir, spec, recordedRevision) : null;
    const baseRevision = anchor?.commit || recordedRevision;
    since = flags.since || (anchor?.lost ? null : baseRevision);
    const runtime = { diffLimits: options.diffLimits };
    const baseline = since && recordedRevision && flags.since && !anchor?.lost
      ? reviewBaseline(projectDir, config, spec, flags.since, runtime, anchor?.commit || null) : {};
    narrowedFrom = baseline.narrowedFrom || null;
    if (!since && anchor?.lost) {
      blockers.push({ code: 'SPC006', message: `The recorded review revision ${recordedRevision.slice(0, 12)} is not on this history, and no commit on it carries the evidence that was reviewed${anchor.differing.length ? ` (differing: ${anchor.differing.join(', ')})` : ''}; pass --since <review-baseline>.` });
    } else if (!since) blockers.push({ code: 'SPC006', message: 'Completion requires --since <review-baseline> for the first reconciliation.' });
    else if (baseline.blocker) blockers.push(baseline.blocker);
    else {
      // docguard.completion-upkeep#FR-006: one reconciliation per distinct base, however many specs share it.
      const cache = options.shared?.reconcile;
      reconcile = cache?.get(since) || buildReconciliationPlan(projectDir, config, since, runtime);
      if (cache && !cache.has(since)) { cache.set(since, reconcile); options.shared.stats.reconciliations++; }
      if (reconcile.status === 'UNSUPPORTED' || reconcile.status === 'BLOCKED') blockers.push({ code: 'SPC006', message: 'Reconciliation coverage is unsupported or blocked.' });
      const unresolved = reconcile.classifications.filter(item => item.disposition === 'unsupported_or_ambiguous');
      if (unresolved.length) blockers.push({ code: 'SPC006', message: `Unresolved changed files: ${unresolved.map(item => item.path).join(', ')}.${resolvingRefHint(projectDir, since, unresolved.map(item => item.path), Boolean(recordedRevision))}` });
      if (maintenance) {
        const reviewable = reconcile.classifications.filter(item =>
          item.specs.includes(spec.specId)
          && ['source', 'test', 'canonical_doc', 'decision'].includes(item.kind));
        if (revision === spec.reviewed.reconciliation.lastReviewedRevision || reviewable.length === 0) {
          blockers.push({ code: 'SPC006', message: 'Living-spec maintenance requires a new linked source, test, canonical-document, or decision change since the last reviewed revision.' });
        }
      }
    }
  }
  const guard = options.guardResult || runGuardInternal(projectDir, config);
  if (options.shared && !options.guardResult) options.shared.stats.guardRuns++;
  // docguard.requirement-anchors#FR-029: a spec's own failing anchor findings
  // never block its completion; completing is how they get reviewed. They are
  // listed instead, with their accept commands. Another spec's still count.
  const anchorFindings = spec ? ownFailingAnchors(projectDir, config, spec.specId, options.shared) : [];
  const guardErrors = Math.max(0, (guard.errors || 0) - anchorFindings.length);
  if (guardErrors > 0) blockers.push({ code: 'SPC007', message: `Guard has ${guardErrors} error(s).` });
  return {
    status: blockers.length ? 'BLOCKED' : 'READY',
    specId: flags.id || null,
    revision,
    since,
    transition: completionTransition(spec),
    blockers,
    anchorFindings,
    reconciliation: reconcile,
    ...(narrowedFrom ? { narrowedFrom } : {}),
    evidence: spec ? sortedUnique([
      ...spec.observed.implementationEvidence.map(item => item.file),
      ...spec.observed.testEvidence.map(item => item.file),
      ...spec.reviewed.scope.canonicalDocs,
    ]) : [],
    context: CONTEXT_PATH,
    archiveReadiness: archiveReadiness(spec, true),
    guard: { status: guard.status, errors: guard.errors, warnings: guard.warnings },
  };
}

/**
 * Build one completion in memory: the spec's new text, its outcome and the registry entry's
 * new reviewed state. The registry is `projection.registry`, shared by every completion
 * of a batch; nothing is written here.
 * @implements docguard.completion-upkeep#FR-005
 * @implements docguard.completion-upkeep#FR-010
 */
function prepareCompletion(projectDir, projection, plan, { reason, successorId = null, deviations = [], scopeChanged = false }) {
  const spec = projection.registry.specs.find(entry => entry.specId === plan.specId);
  const specPath = resolve(projectDir, spec.path);
  const before = { delivery: spec.reviewed.lifecycle.delivery, status: readSpecStatus(readFileSync(specPath, 'utf8')) };
  // The outcome is built in the form the transaction's validation re-projects
  // (docguard.completion-revision-anchoring#FR-007): deviations are compared
  // after whitespace normalization, then deduplicated and sorted.
  const outcome = canonicalOutcome({
    revision: plan.revision,
    reason,
    evidence: plan.evidence,
    deviations: deviations.map(item => String(item).replace(/\s+/g, ' ').trim()).filter(Boolean),
    successor: successorId,
    ...(plan.narrowedFrom ? { narrowedFrom: plan.narrowedFrom } : {}),
  });
  if (outcome.deviations.length > 20 || outcome.deviations.some(item => item.length > 500)) {
    throw new Error('Completion accepts at most 20 deviations of 1-500 characters.');
  }
  // docguard.completion-one-commit#FR-005: the blob of every evidence file at the revision
  // reviewed, so the record is anchored by content, not only by a commit id a squash discards.
  // docguard.completion-upkeep#FR-007: a file whose uncommitted change only adds tags carries the
  // blob of the content the commit will hold.
  const evidenceBlobs = evidenceBlobsInTree(projectDir, plan.revision, outcome.evidence);
  const blobsComplete = outcome.evidence.length > 0 && outcome.evidence.every(path => evidenceBlobs[path]);
  const appended = appendImplementationOutcome(readFileSync(specPath, 'utf8'), { ...outcome, ...(blobsComplete ? { evidenceBlobs } : {}) });
  // docguard.completion-upkeep#FR-011: a closed spec is no longer a draft.
  const specContent = markSpecActive(appended);
  if (spec.reviewed.lifecycle.delivery !== 'released') spec.reviewed.lifecycle.delivery = 'verified';
  spec.reviewed.reconciliation.lastReviewedRevision = plan.revision;
  spec.reviewed.reconciliation.outcomes = [...spec.reviewed.reconciliation.outcomes, outcome].slice(-20);
  const artifact = spec.observed.artifacts.find(item => item.path === spec.path);
  if (artifact) artifact.digest = digest(specContent);
  const written = {
    specId: plan.specId,
    spec: spec.path,
    registryFields: [
      `reviewed.lifecycle.delivery ${before.delivery === spec.reviewed.lifecycle.delivery ? `stays ${before.delivery}` : `${before.delivery} -> ${spec.reviewed.lifecycle.delivery}`}`,
      `reviewed.reconciliation.lastReviewedRevision ${plan.revision.slice(0, 12)}`,
      `reviewed.reconciliation.outcomes (${spec.reviewed.reconciliation.outcomes.length} recorded)`,
      ...(scopeChanged ? ['reviewed.scope.canonicalDocs / reviewed.lifecycle.persistenceModel (from the flags)'] : []),
    ],
    outcomeLine: `- \`${plan.revision.slice(0, 12)}\`: ${outcome.evidence.length} evidence file(s)${outcome.deviations.length ? `, ${outcome.deviations.length} accepted deviation(s)` : ''}`,
    blobs: blobsComplete ? outcome.evidence.length : 0,
    status: before.status !== readSpecStatus(specContent) ? `${before.status} -> ${readSpecStatus(specContent)}` : null,
  };
  return { specPath, specContent, outcome, blobsComplete, written };
}

function commitCompletions(projectDir, config, projection, prepared, revision) {
  projection.registry.schemaVersion = 2;
  const registryContent = `${JSON.stringify(projection.registry, null, 2)}\n`;
  const contextContent = serializeLifecycleContext(projectDir, projection.registry, revision);
  ensureStateDir(projectDir);
  commitFileTransaction([
    ...prepared.map(item => ({ path: item.specPath, content: item.specContent })),
    { path: resolve(projectDir, SPEC_REGISTRY_PATH), content: registryContent },
    { path: resolve(projectDir, CONTEXT_PATH), content: contextContent },
  ], {
    validate: () => {
      const next = projectSpecRegistry(projectDir, config);
      if (next.issues.length || !next.current) throw new Error('completed registry does not match the resulting repository');
      const context = JSON.parse(readFileSync(resolve(projectDir, CONTEXT_PATH), 'utf8'));
      if (context.generatedFrom !== revision) throw new Error('active context revision mismatch');
    },
  });
}

/** A revision a squash merge will discard cannot anchor the next reconciliation (docguard.completion-revision-anchoring#FR-004). */
function squashWarnings(projectDir, plan, blobsComplete) {
  if (reachableFromDefaultBranch(projectDir) !== false) return [];
  return [blobsComplete
    ? `HEAD ${plan.revision.slice(0, 12)} is not on the remote default branch; a squash merge will discard it, but the record stays anchored by the evidence blobs it carries, so no second commit is needed unless the evidence changes before it lands.`
    : `HEAD ${plan.revision.slice(0, 12)} is not on the remote default branch; a squash merge will discard it, and this record carries no evidence blobs to anchor it by. Complete on a branch at the default branch's tip, or run \`docguard specs reanchor --id ${plan.specId} --write\` after merging.`];
}

export function completeSpec(projectDir, config, flags, options = {}) {
  if (flags.stale) return completeStale(projectDir, config, flags, options);
  const plan = planSpecCompletion(projectDir, config, flags, options);
  if (plan.status !== 'READY') return { command: 'complete', ...plan, applied: false };
  if (!flags.write) return { command: 'complete', ...plan, applied: false };
  const reason = String(flags.reason || '').replace(/\s+/g, ' ').trim();
  if (!reason || reason.length > 500) throw new Error('Completion --write requires --reason with 1-500 characters.');
  const projection = projectSpecRegistry(projectDir, config);
  const spec = projection.registry.specs.find(entry => entry.specId === flags.id);
  const scope = applyReviewedScope(projectDir, spec, flags);
  const successor = flags.successor
    ? projection.registry.specs.find(entry => entry.specId === flags.successor) : null;
  if (flags.successor && (!successor || successor.reviewed.lifecycle.context !== 'current'
    || successor.reviewed.lifecycle.approval !== 'approved')) {
    throw new Error('Completion successor must be an approved current spec ID.');
  }
  const prepared = prepareCompletion(projectDir, projection, plan, {
    reason, successorId: flags.successor || null, deviations: flags.deviations || [], scopeChanged: scope.changed,
  });
  commitCompletions(projectDir, config, projection, [prepared], plan.revision);
  return { command: 'complete', ...plan, status: 'VERIFIED', applied: true, outcome: prepared.outcome, written: [prepared.written], warnings: squashWarnings(projectDir, plan, prepared.blobsComplete) };
}

/**
 * Close again every spec SPR011 flags, in one transaction: each as a maintenance completion
 * that keeps the spec's canonical documents and persistence. Every spec is planned first,
 * against one guard run and one reconciliation per distinct base; when any is blocked,
 * nothing is written and every blocker is listed with its spec.
 * @implements docguard.completion-upkeep#FR-004
 * @implements docguard.completion-upkeep#FR-005
 * @implements docguard.completion-upkeep#FR-006
 */
export function completeStale(projectDir, config, flags, options = {}) {
  const named = ['id', 'since', 'persistence', 'successor'].filter(key => flags[key] !== undefined && flags[key] !== null)
    .concat(flags.canonicalDocs?.length ? ['canonical-doc'] : []);
  if (named.length) throw new Error(`--stale closes every spec that drifted and keeps each spec's recorded scope; it does not take ${named.map(key => `--${key}`).join(', ')}.`);
  const projection = projectSpecRegistry(projectDir, config);
  const stale = staleCompletions(projectDir, projection.registry);
  const stats = { specs: stale.length, guardRuns: 0, reconciliations: 0, bases: 0 };
  const base = { command: 'complete', mode: 'stale', revision: headRevision(projectDir), stats, applied: false };
  if (!stale.length) return { ...base, status: 'CURRENT', specs: [], blockers: [] };
  const guardResult = options.guardResult || runGuardInternal(projectDir, config);
  stats.guardRuns = options.guardResult ? 0 : 1;
  const shared = { reconcile: new Map(), anchorStatus: null, stats };
  const plans = stale.map(item => ({
    item,
    plan: planSpecCompletion(projectDir, config, { id: item.specId }, { ...options, guardResult, shared }),
  }));
  stats.bases = new Set(plans.map(({ plan }) => plan.since).filter(Boolean)).size;
  // A blocker that does not depend on the spec (guard has errors) is listed once.
  const seen = new Set();
  const blockers = plans.flatMap(({ plan }) => plan.blockers.map(blocker => ({ specId: plan.specId, ...blocker })))
    .filter(blocker => {
      if (blocker.code !== 'SPC007') return true;
      if (seen.has(blocker.message)) return false;
      seen.add(blocker.message);
      return true;
    });
  const specs = plans.map(({ item, plan }) => ({ specId: item.specId, files: item.files, removed: item.removed, transition: plan.transition, since: plan.since, status: plan.status }));
  const result = { ...base, specs, blockers, anchorFindings: plans.flatMap(({ plan }) => plan.anchorFindings || []), guard: plans[0].plan.guard };
  if (blockers.length) return { ...result, status: 'BLOCKED' };
  if (!flags.write) return { ...result, status: 'READY' };
  const reason = String(flags.reason || '').replace(/\s+/g, ' ').trim();
  if (!reason || reason.length > 500) throw new Error('Completion --write requires --reason with 1-500 characters.');
  const prepared = plans.map(({ plan }) => prepareCompletion(projectDir, projection, plan, { reason }));
  const revision = plans[0].plan.revision;
  commitCompletions(projectDir, config, projection, prepared, revision);
  return {
    ...result, status: 'VERIFIED', applied: true, written: prepared.map(item => item.written),
    warnings: squashWarnings(projectDir, plans[0].plan, prepared.every(item => item.blobsComplete)),
  };
}

/**
 * Move a spec's dangling recorded revisions to a commit on HEAD's history
 * whose evidence is byte-identical, or, when the old revision no longer
 * resolves, to a maintainer-attested revision.
 * @implements docguard.completion-revision-anchoring#FR-003
 */
export function reanchorSpec(projectDir, config, flags) {
  const projection = projectSpecRegistry(projectDir, config);
  const spec = projection.registry.specs.find(entry => entry.specId === flags.id);
  const blockers = [...projection.issues];
  if (!flags.id || !spec) blockers.push({ code: 'SPC001', message: unknownSpecMessage(flags.id, projection.registry.specs) });
  if (!projection.current) blockers.push({ code: 'SPC001', message: 'Committed registry must be current before re-anchoring.' });
  const changed = blockingChanges(projectDir, projection.registry);
  if (changed === null || changed.length) blockers.push({ code: 'SPC001', message: `Re-anchoring requires a clean tracked working tree; changed: ${describeChanges(changed)}.` });
  const moves = [];
  if (spec && !blockers.length) {
    // A revision whose evidence blobs are on this history is anchored by content (docguard.completion-one-commit#FR-006): nothing to move.
    let dangling = strandedRevisions(projectDir, { specs: [spec] }, { registryPath: SPEC_REGISTRY_PATH });
    // docguard.completion-revision-anchoring#FR-006: one spec's dangling
    // revisions can come from different merges, so an attested --to must be
    // scoped to the revision it attests.
    if (flags.from) {
      const matches = dangling.filter(d => d.revision.startsWith(String(flags.from)));
      if (String(flags.from).length < 7 || matches.length !== 1) {
        blockers.push({ code: 'SPC008', message: `--from ${flags.from} must name exactly one recorded revision that does not resolve on HEAD's history (at least 7 characters); dangling: ${dangling.map(d => d.revision.slice(0, 12)).join(', ') || 'none'}.` });
      }
      dangling = matches.length === 1 ? matches : [];
    }
    const outcomes = spec.reviewed.reconciliation.outcomes;
    // Any revision git resolves to a commit; the full SHA is what is recorded.
    const toCommit = flags.to ? resolveCommit(projectDir, flags.to) : null;
    for (const { revision, reason } of dangling) {
      const evidence = sortedUnique(outcomes.filter(o => o.revision === revision).flatMap(o => o.evidence)
        .concat(outcomes.some(o => o.revision === revision) ? [] : outcomes.flatMap(o => o.evidence)));
      if (flags.to) {
        if (!toCommit || !isAncestorOf(projectDir, toCommit)) {
          blockers.push({ code: 'SPC008', message: `--to ${flags.to} must name a commit on HEAD's history.` });
          continue;
        }
        if (reason === 'missing') {
          const attestation = String(flags.reason || '').replace(/\s+/g, ' ').trim();
          if (attestation.length < 8 || attestation.length > 500) {
            blockers.push({ code: 'SPC008', message: `${revision.slice(0, 12)} no longer resolves, so evidence cannot be compared: --reason (8-500 characters) must attest that ${toCommit.slice(0, 12)} carries the reviewed evidence.` });
            continue;
          }
          moves.push({ from: revision, to: toCommit, method: 'attested', reason: attestation });
          continue;
        }
        const differing = evidenceDifferences(projectDir, revision, toCommit, evidence);
        if (!differing.length) { moves.push({ from: revision, to: toCommit, method: 'blob-equal' }); continue; }
        // The reviewed bytes never reached this history (the PR kept changing
        // after completion). A maintainer may attest the target; the files
        // that differ are recorded, never hidden.
        const attestation = String(flags.reason || '').replace(/\s+/g, ' ').trim();
        if (attestation.length < 8 || attestation.length > 500) {
          blockers.push({ code: 'SPC008', message: `Evidence differs between ${revision.slice(0, 12)} and ${toCommit.slice(0, 12)}: ${differing.join(', ')}. Pass --reason (8-500 characters) to attest that ${toCommit.slice(0, 12)} is the reviewed state; the differing files are recorded.` });
          continue;
        }
        moves.push({ from: revision, to: toCommit, method: 'attested', reason: attestation, differing });
        continue;
      }
      if (reason === 'missing') {
        blockers.push({ code: 'SPC008', message: `${revision.slice(0, 12)} no longer resolves; pass --to <revision> and --reason to attest the anchor.` });
        continue;
      }
      const { target, differing } = findAnchor(projectDir, revision, evidence);
      if (target) moves.push({ from: revision, to: target, method: 'blob-equal' });
      else blockers.push({ code: 'SPC008', message: `No commit on HEAD's first-parent history carries ${revision.slice(0, 12)}'s evidence unchanged; differing: ${differing.join(', ') || 'unknown'}. Pass --to <the merge commit that carried this review> with --reason to attest it; the differing files are recorded.` });
    }
  }
  const result = { command: 'reanchor', specId: flags.id || null, status: blockers.length ? 'BLOCKED' : moves.length ? 'READY' : 'CURRENT', moves, blockers, applied: false };
  if (result.status !== 'READY' || !flags.write) return result;

  let specContent = readFileSync(resolve(projectDir, spec.path), 'utf8');
  const rec = spec.reviewed.reconciliation;
  for (const move of moves) {
    const hadBlobs = readOutcomeBlobs(specContent, move.from) !== null;
    if (rec.lastReviewedRevision === move.from) rec.lastReviewedRevision = move.to;
    rec.outcomes = rec.outcomes.map(outcome => (outcome.revision === move.from
      ? { ...outcome, revision: move.to, reanchoredFrom: { revision: move.from, method: move.method, ...(move.reason ? { reason: move.reason } : {}), ...(move.differing?.length ? { differing: move.differing } : {}) } }
      : outcome));
    specContent = rewriteOutcomeRevision(specContent, move.from, move.to);
    // docguard.completion-one-commit#FR-008: a record moved by blob equality gains the
    // evidence blobs for its latest outcome, so the next squash or rebase cannot strand it.
    const latest = rec.outcomes[rec.outcomes.length - 1];
    if (move.method === 'blob-equal' && !hadBlobs && latest?.revision === move.to) {
      const blobs = evidenceBlobsAt(projectDir, move.to, latest.evidence);
      if (latest.evidence.length && latest.evidence.every(path => blobs[path])) specContent = writeOutcomeBlobs(specContent, move.to, blobs);
    }
  }
  const artifact = spec.observed.artifacts.find(item => item.path === spec.path);
  if (artifact) artifact.digest = digest(specContent);
  projection.registry.schemaVersion = 2;
  const writes = [
    { path: resolve(projectDir, spec.path), content: specContent },
    { path: resolve(projectDir, SPEC_REGISTRY_PATH), content: `${JSON.stringify(projection.registry, null, 2)}\n` },
  ];
  const contextPath = resolve(projectDir, CONTEXT_PATH);
  let context = null;
  try { context = JSON.parse(readFileSync(contextPath, 'utf8')); } catch { /* no active context yet */ }
  const moved = moves.find(move => move.from === context?.generatedFrom);
  if (moved) {
    ensureStateDir(projectDir);
    writes.push({ path: contextPath, content: serializeLifecycleContext(projectDir, projection.registry, moved.to) });
  }
  commitFileTransaction(writes, {
    validate: () => {
      const next = projectSpecRegistry(projectDir, config);
      if (next.issues.length || !next.current) throw new Error('re-anchored registry does not match the resulting repository');
    },
  });
  return { ...result, status: 'REANCHORED', applied: true };
}

const APPROVABLE_DELIVERY = ['planned', 'in_progress', 'implemented'];

/**
 * Record a person's approval of a spec, and optionally its delivery state,
 * in the registry's reviewed lifecycle. Approval is never read from spec
 * prose: prose is generated and observed, while reviewed fields are attested
 * by whoever runs this and reviewed in the pull request that commits it.
 * Verification stays with `specs complete`, which checks evidence.
 * @implements docguard.first-spec-preflight#FR-005
 */
export function approveSpec(projectDir, config, flags = {}) {
  const projection = projectSpecRegistry(projectDir, config);
  const spec = projection.registry.specs.find(entry => entry.specId === flags.id);
  const blockers = [...projection.issues];
  if (!flags.id || !spec) blockers.push({ code: 'SPC001', message: unknownSpecMessage(flags.id, projection.registry.specs) });
  if (!projection.current) blockers.push({ code: 'SPC001', message: 'Committed registry must be current before approval; run `docguard specs --write` first.' });
  if (spec && spec.reviewed.lifecycle.context !== 'current') blockers.push({ code: 'SPC001', message: `Spec ${spec.specId} is retired; only a current spec can be approved.` });
  const scope = spec ? applyReviewedScope(projectDir, spec, flags) : { problems: [], changed: false };
  blockers.push(...scope.problems);
  const delivery = flags.delivery === undefined ? null : String(flags.delivery);
  if (delivery !== null && !APPROVABLE_DELIVERY.includes(delivery)) {
    blockers.push({ code: 'SPC002', message: `--delivery must be ${APPROVABLE_DELIVERY.join(', ')}; verified and released are recorded by \`docguard specs complete\`.` });
  }
  if (spec && delivery !== null && ['verified', 'released'].includes(spec.reviewed.lifecycle.delivery)
    && delivery !== spec.reviewed.lifecycle.delivery) {
    blockers.push({ code: 'SPC002', message: `Spec ${spec.specId} is ${spec.reviewed.lifecycle.delivery}; it cannot move back to ${delivery}. Record later work with \`docguard specs complete\`.` });
  }
  const from = spec ? { approval: spec.reviewed.lifecycle.approval, delivery: spec.reviewed.lifecycle.delivery } : null;
  const to = from ? { approval: 'approved', delivery: delivery && APPROVABLE_DELIVERY.includes(delivery) ? delivery : from.delivery } : null;
  const transition = from ? { approval: `${from.approval}→${to.approval}`, delivery: `${from.delivery}→${to.delivery}` } : null;
  const unchanged = from && from.approval === to.approval && from.delivery === to.delivery && !scope.changed;
  const result = {
    command: 'approve',
    specId: flags.id || null,
    status: blockers.length ? 'BLOCKED' : unchanged ? 'CURRENT' : 'READY',
    transition,
    blockers,
    applied: false,
  };
  if (result.status !== 'READY' || !flags.write) return result;

  spec.reviewed.lifecycle.approval = to.approval;
  spec.reviewed.lifecycle.delivery = to.delivery;
  commitFileTransaction([
    { path: resolve(projectDir, SPEC_REGISTRY_PATH), content: `${JSON.stringify(projection.registry, null, 2)}\n` },
  ], {
    validate: () => {
      const next = projectSpecRegistry(projectDir, config);
      if (next.issues.length || !next.current) throw new Error('approved registry does not match the resulting repository');
    },
  });
  return { ...result, status: 'APPROVED', applied: true };
}

function printIssues(issues) {
  for (const issue of issues) console.log(`  ${issue.code} ${issue.path}: ${issue.message}`);
}

function printResult(result) {
  if (result.command === 'complete') {
    console.log(`Spec completion${result.mode === 'stale' ? ' (--stale)' : ''}: ${result.status}`);
    if (result.mode === 'stale') {
      for (const item of result.specs || []) console.log(`${item.specId}: ${item.transition || 'no transition'}; changed since its review: ${item.files.join(', ')}`);
      if (result.status === 'CURRENT') console.log('No closed spec has an evidence file that differs from its last review.');
      if (result.blockers?.length) printIssues(result.blockers.map(issue => ({ path: issue.specId || SPEC_REGISTRY_PATH, ...issue })));
      if (result.status === 'BLOCKED') console.log('Nothing was written: close the blocked specs one by one, or fix the blockers above and run again.');
      if (result.status === 'READY') console.log('Run again with --write --reason <text> to close them in one transaction.');
    } else {
      console.log(`${result.specId || '<missing>'}: ${result.transition || 'no transition (unknown spec)'}`);
      if (result.blockers?.length) printIssues(result.blockers.map(issue => ({ path: result.specId || SPEC_REGISTRY_PATH, ...issue })));
    }
    if (result.applied && result.written?.length) {
      // docguard.completion-upkeep#FR-010: say what changed, so nobody needs `git diff` to find out.
      console.log(`Wrote ${SPEC_REGISTRY_PATH}, ${CONTEXT_PATH} and ${result.written.length} spec file(s):`);
      for (const item of result.written) {
        console.log(`  ${item.specId} (${item.spec})`);
        for (const field of item.registryFields) console.log(`    registry: ${field}`);
        console.log(`    outcome line ${item.outcomeLine}; ${item.blobs} evidence blobs recorded${item.blobs ? '' : ' (this record has none, so it is anchored by commit only)'}`);
        if (item.status) console.log(`    **Status**: ${item.status}`);
      }
    }
    for (const warning of result.warnings || []) console.log(`  ⚠ ${warning}`);
    if (result.narrowedFrom) {
      const n = result.narrowedFrom;
      console.log(`  ⚠ Not reconciled: ${n.revision.slice(0, 12)}..${n.since.slice(0, 12)} (${n.skippedCommits} commit(s)) — ${n.reason} The outcome records it as narrowedFrom.`);
    }
    if (result.anchorFindings?.length) {
      console.log(`  ${result.anchorFindings.length} of this spec's anchor finding(s) do not block completion; review them:`);
      for (const f of result.anchorFindings) console.log(`    ${f.code} ${f.requirement} (${f.file}): ${f.acceptCommand}`);
    }
    return;
  }
  if (result.command === 'approve') {
    console.log(`Spec approval: ${result.status}`);
    if (result.transition) console.log(`${result.specId}: approval ${result.transition.approval}; delivery ${result.transition.delivery}`);
    if (result.blockers?.length) printIssues(result.blockers.map(issue => ({ path: result.specId || SPEC_REGISTRY_PATH, ...issue })));
    if (result.status === 'READY') console.log('Run again with --write to record it.');
    return;
  }
  if (result.command === 'reanchor') {
    console.log(`Spec re-anchor: ${result.status}`);
    for (const move of result.moves) console.log(`  ${result.specId}: ${move.from.slice(0, 12)} → ${move.to.slice(0, 12)} (${move.method})`);
    if (result.blockers?.length) printIssues(result.blockers.map(issue => ({ path: result.specId || SPEC_REGISTRY_PATH, ...issue })));
    return;
  }
  if (result.command === 'preflight') {
    console.log(`Spec preflight: ${result.status}`);
    console.log(`Current specs: ${result.briefing.length}`);
    for (const spec of result.briefing) {
      console.log(`  ${spec.specId} — ${spec.approval}/${spec.delivery}; tasks ${spec.taskCompletion.checked}/${spec.taskCompletion.total}; test evidence ${spec.testEvidence}`);
    }
    if (result.blockers.length) {
      console.log('Blockers:');
      printIssues(result.blockers);
    }
    if (result.overlaps.length) {
      console.log('Review-only semantic overlap:');
      for (const overlap of result.overlaps) console.log(`  ${(overlap.similarity * 100).toFixed(0)}% ${overlap.specId} (${overlap.path})`);
    }
    return;
  }
  console.log(`Spec registry: ${result.status}`);
  console.log(`Registry: ${SPEC_REGISTRY_PATH}`);
  console.log(`Specs: ${result.specs}; tombstones: ${result.tombstones}`);
  if (result.differences?.length) {
    // After --write the registry already matches; listing the pre-write diff
    // under "Differences" read as though the drift were still outstanding.
    console.log(result.status === 'WRITTEN' ? 'Resolved by this write:' : 'Differences:');
    for (const difference of result.differences) {
      console.log(`  ${difference.path}: ${difference.message}`);
    }
  }
  if (result.legacyForms?.length && result.status !== 'WRITTEN') {
    // Informational, never a finding: an older encoding is not drift, so it must
    // not flip the verdict -- but it must not be silent either, or it never gets
    // migrated.
    console.log(`Note: registry uses an older encoding (${result.legacyForms.join(', ')}); content is unchanged. `
      + 'Run `docguard specs --write` to migrate it.');
  }
  if (result.unrecordedCompletions?.length) {
    // docguard.completion-one-commit#FR-011: delivery is `verified` only because someone set it, or the spec predates outcomes.
    console.log(`Note: ${result.unrecordedCompletions.length} spec(s) are verified or released with no recorded outcome (SPR010); \`docguard specs complete\` records one:`);
    for (const id of result.unrecordedCompletions) console.log(`  ${id}: verified with no recorded outcome`);
  }
  if (result.untrackedEvidence?.length) {
    console.log(`Not counted: ${result.untrackedEvidence.length} untracked test file(s) carry requirement annotations. `
      + 'The registry reads tracked files only; `git add` them, then re-run `docguard specs --write`:');
    for (const path of result.untrackedEvidence) console.log(`  ${path}`);
  }
  if (result.issues.length) printIssues(result.issues);
}

const MESSAGE_FILE_MAX = 256 * 1024;
const SPEC_FIRST_EXIT = { covered: 0, exempt: 0, 'not-governed': 0, uncovered: 1, inconclusive: 2 };

function printSpecFirst(result) {
  const label = {
    covered: 'COVERED', exempt: 'EXEMPT', 'not-governed': 'NOT GOVERNED', uncovered: 'UNCOVERED', inconclusive: 'INCONCLUSIVE',
  }[result.status];
  console.log(`Spec-first: ${label}${result.base ? ` (since merge base ${result.base.slice(0, 12)} of ${result.since})` : ''}`);
  if (result.reason) console.log(`  ${result.reason}`);
  if (result.governed.length) {
    console.log(`Governed paths changed: ${result.governed.length}`);
    for (const path of result.governed.slice(0, 20)) console.log(`  ${path}`);
    if (result.governed.length > 20) console.log(`  … ${result.governed.length - 20} more`);
  }
  for (const ref of result.references) console.log(`Spec reference: ${ref.value} → ${ref.spec} (${ref.kind})`);
  if (result.exemption) console.log(`Exemption: ${result.exemption.kind} — ${result.exemption.reason}`);
  for (const value of result.unresolved) console.log(`Unresolved reference (no such spec): ${value}`);
  for (const bad of result.invalidExemptions) console.log(`Invalid exemption (${bad.problem}): Spec-Exempt: ${bad.kind} — ${bad.reason}`);
  if (result.status === 'uncovered') {
    console.log('To pass, add one line to the pull request description or a commit message:');
    console.log('  the governing spec:        specs/<###-feature>   or its Spec ID');
    console.log(`  or an exemption:          Spec-Exempt: <${result.allowedKinds.join('|')}> — <reason, 10+ characters>`);
  }
}

function runSpecFirst(projectDir, config, flags) {
  let messageText = '';
  if (flags.messageFile) {
    const buffer = readFileSync(resolve(projectDir, flags.messageFile));
    messageText = buffer.subarray(0, MESSAGE_FILE_MAX).toString('utf8');
  }
  const result = checkSpecFirst(projectDir, config, { since: flags.since, messageText });
  if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
  else printSpecFirst(result);
  process.exitCode = SPEC_FIRST_EXIT[result.status];
  return result;
}

export function runSpecs(projectDir, config, flags = {}) {
  try {
    const action = flags.args?.[0] || null;
    if (action && !['preflight', 'complete', 'require', 'reanchor', 'approve'].includes(action)) throw new Error(`Unknown specs action: ${action}`);
    if (action === 'require') return runSpecFirst(projectDir, config, flags);
    if (flags.check && flags.write) throw new Error('Use either --check or --write, not both.');

    if (action === 'preflight') {
      if (flags.write) throw new Error('Specs preflight is read-only.');
      const result = { command: 'preflight', ...preflightSpec(projectDir, config, flags.path || null) };
      if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
      else printResult(result);
      if (result.status === 'BLOCKED') process.exitCode = 2;
      return result;
    }

    if (action === 'approve') {
      const result = approveSpec(projectDir, config, flags);
      if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
      else printResult(result);
      if (result.status === 'BLOCKED') process.exitCode = 2;
      return result;
    }

    if (action === 'reanchor') {
      const result = reanchorSpec(projectDir, config, flags);
      if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
      else printResult(result);
      if (result.status === 'BLOCKED') process.exitCode = 2;
      return result;
    }

    if (action === 'complete') {
      const result = completeSpec(projectDir, config, flags);
      if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
      else printResult(result);
      if (result.status === 'BLOCKED') process.exitCode = 2;
      return result;
    }

    const projection = projectSpecRegistry(projectDir, config);
    if (flags.write && projection.issues.length > 0) {
      throw new Error(`Registry refresh refused: ${projection.issues.map(issue => issue.message).join(' ')}`);
    }
    let status = projection.current ? 'CURRENT' : projection.exists ? 'STALE' : 'MISSING';
    // A legacy-but-equivalent registry reports CURRENT (its content is provably
    // unchanged), so `--write` must still migrate it explicitly -- otherwise the
    // compatibility shim would be load-bearing forever and the next format
    // change would stack on top of it.
    if (flags.write && (!projection.current || projection.legacyForms.length > 0)) {
      // Deliberately not safeWrite: that keeps a .bak, and the registry is
      // generated and Git-tracked, so the backup is noise DocGuard then reports
      // as an undocumented config file.
      writeFileSync(resolve(projectDir, SPEC_REGISTRY_PATH), projection.serialized, 'utf-8');
      status = 'WRITTEN';
    }
    const untrackedEvidence = untrackedRequirementEvidence(projectDir);
    const result = {
      command: 'specs',
      status,
      untrackedEvidence,
      registry: SPEC_REGISTRY_PATH,
      specs: projection.registry.specs.length,
      tombstones: projection.registry.tombstones.length,
      issues: projection.issues,
      differences: projection.differences,
      legacyForms: projection.legacyForms,
      unrecordedCompletions: unrecordedCompletions(projection.registry),
    };
    if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
    else printResult(result);
    if (flags.check && (status !== 'CURRENT' || result.issues.length > 0)) process.exitCode = 2;
    return result;
  } catch (error) {
    const result = { command: 'specs', status: 'ERROR', error: error.message };
    if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
    else console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return result;
  }
}
