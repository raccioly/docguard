/**
 * Build a deterministic review graph for code/spec changes since a Git ref.
 * @implements docguard.document-lifecycle#FR-010
 * @implements docguard.document-lifecycle#FR-011
 * @implements docguard.document-lifecycle#FR-012
 */

import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';
import { getDiffSnapshot, getHeadInfo } from '../shared-git.mjs';
import { parseUnifiedDiff } from '../shared-diff.mjs';
import { mechanicalSectionsForChanges } from '../shared-sync-scope.mjs';
import { projectSpecRegistry } from './spec-registry.mjs';

const CODE = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.sh', '.cs', '.swift']);
const TEST = /(?:^|\/)(?:__tests__|tests?|specs?)\/|\.(?:test|spec)\./;
const DECISION = /(?:^|\/)(?:adr|adrs|decisions?|rfcs?)(?:\/|$)/i;

function resolveRevision(projectDir, ref) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
      cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch { return null; }
}

function fileKind(path, registry) {
  if (registry.specs.some(spec => spec.observed.artifacts.some(artifact => artifact.path === path))) return 'spec_artifact';
  if (path.startsWith('docs-canonical/')) return 'canonical_doc';
  if (DECISION.test(path) && /\.md$/i.test(path)) return 'decision';
  if (TEST.test(path) && CODE.has(extname(path).toLowerCase())) return 'test';
  if (CODE.has(extname(path).toLowerCase())) return 'source';
  return 'other';
}

function directSpecLinks(path, text, registry) {
  const links = [];
  for (const spec of registry.specs) {
    const evidencePaths = [
      ...spec.observed.artifacts.map(item => item.path),
      ...spec.observed.implementationEvidence.map(item => item.file),
      ...spec.observed.testEvidence.map(item => item.file),
      ...spec.reviewed.scope.canonicalDocs,
    ];
    const explicit = (spec.intent.requirements || []).some(identity => text.includes(identity));
    if (evidencePaths.includes(path) || explicit) links.push(spec.specId);
  }
  return [...new Set(links)].sort();
}

function disposition(kind, linked, companionKinds, currentSpecs) {
  if (kind === 'decision') return { evidenceClass: 'decision', disposition: 'superseded_decision_review', confidence: 'medium' };
  if (kind === 'spec_artifact' || kind === 'canonical_doc') {
    return { evidenceClass: 'approved_intent', disposition: 'intent_change_review', confidence: 'high' };
  }
  if (kind === 'source' || kind === 'test') {
    if (linked.length === 0) return { evidenceClass: 'unsupported', disposition: 'unsupported_or_ambiguous', confidence: 'low' };
    const governingChanged = companionKinds.has('spec_artifact') || companionKinds.has('canonical_doc') || companionKinds.has('decision');
    if (governingChanged) return { evidenceClass: 'approved_intent', disposition: 'intentional_behavior_change_review', confidence: 'medium' };
    const governs = linked.some(id => currentSpecs.has(id));
    if (governs) return { evidenceClass: 'approved_intent', disposition: 'possible_implementation_regression', confidence: 'medium' };
    return { evidenceClass: 'decision', disposition: 'superseded_decision_review', confidence: 'medium' };
  }
  return { evidenceClass: 'unrelated', disposition: 'unrelated_change', confidence: 'high' };
}

function summarize(classifications) {
  const count = key => Object.fromEntries([...classifications.reduce((map, item) => {
    const value = item[key] || 'unknown';
    map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map()).entries()].sort(([a], [b]) => a.localeCompare(b)));
  return {
    total: classifications.length,
    byKind: count('kind'),
    byDisposition: count('disposition'),
    byConfidence: count('confidence'),
  };
}

export function buildReconciliationPlan(projectDir, config = {}, since, runtime = {}) {
  if (!since) throw new Error('Reconcile requires --since <git-ref>.');
  const baseRevision = resolveRevision(projectDir, since);
  const head = getHeadInfo(projectDir);
  if (!baseRevision || !head?.commit) {
    return {
      schemaVersion: 1,
      status: 'UNSUPPORTED',
      since,
      baseRevision,
      revision: head?.commit || null,
      coverage: { status: 'unsupported', reason: 'Git ref or HEAD could not be resolved.' },
      nodes: [], edges: [], classifications: [], writes: [], issues: [],
    };
  }
  const projection = projectSpecRegistry(projectDir, config);
  const readDiff = runtime.getDiffSnapshot || getDiffSnapshot;
  // Use the already verified full commit ID for every subsequent Git call.
  // This removes revision-option ambiguity from user-supplied `--since` text.
  const snapshot = readDiff(projectDir, baseRevision);
  if (snapshot.status !== 'ok') {
    return {
      schemaVersion: 1,
      status: 'BLOCKED',
      since,
      baseRevision,
      revision: head.commit,
      dirty: head.dirty,
      range: {
        status: snapshot.status,
        commitCount: snapshot.commitCount,
        changedFileCount: snapshot.changedFiles.length,
        patchBytes: snapshot.patchBytes,
        limits: snapshot.limits,
      },
      coverage: { status: 'partial', reason: snapshot.reason },
      summary: { total: 0, byKind: {}, byDisposition: {}, byConfidence: {} },
      nodes: [], edges: [], classifications: [], writes: [], issues: projection.issues,
    };
  }
  const diff = parseUnifiedDiff(snapshot.patch)
    .filter(file => ![file.oldPath, file.newPath].some(path => path?.split('/').includes('.local')));
  const changed = snapshot.changedFiles
    .map(file => file.newPath || file.oldPath)
    .filter(path => path && !path.split('/').includes('.local'));
  const textByPath = new Map(diff.map(file => [
    file.newPath || file.oldPath,
    file.hunks.flatMap(hunk => hunk.lines.filter(line => line.op !== ' ').map(line => line.text)).join('\n'),
  ]));
  const preliminary = [...new Set(changed)].sort().map(path => ({
    path,
    kind: fileKind(path, projection.registry),
    specs: directSpecLinks(path, textByPath.get(path) || '', projection.registry),
  }));
  const currentSpecs = new Set(projection.registry.specs
    .filter(spec => spec.reviewed.lifecycle.context === 'current' && spec.reviewed.lifecycle.approval === 'approved')
    .map(spec => spec.specId));
  const classifications = preliminary.map(item => {
    const companionKinds = new Set(preliminary
      .filter(other => other.specs.some(id => item.specs.includes(id)))
      .map(other => other.kind));
    return { ...item, ...disposition(item.kind, item.specs, companionKinds, currentSpecs) };
  });
  const mechanicalSections = mechanicalSectionsForChanges(changed.filter(path => CODE.has(extname(path).toLowerCase()) || /(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|Gemfile)$/.test(path)));
  if (mechanicalSections.length > 0) {
    classifications.push({
      path: null,
      kind: 'generated_section_projection',
      specs: [],
      evidenceClass: 'mechanical_fact',
      disposition: 'mechanical_fact_refresh',
      confidence: 'high',
      sections: mechanicalSections,
    });
  }
  const nodes = [
    ...projection.registry.specs.map(spec => ({ id: `spec:${spec.specId}`, type: 'spec', path: spec.path, lifecycle: spec.reviewed.lifecycle })),
    ...preliminary.map(item => ({ id: `change:${item.path}`, type: 'change', path: item.path, kind: item.kind })),
  ];
  const edges = preliminary.flatMap(item => item.specs.map(specId => ({
    from: `change:${item.path}`,
    to: `spec:${specId}`,
    kind: 'direct_evidence',
    confidence: 'high',
  })));
  const review = classifications.some(item => !['mechanical_fact_refresh', 'unrelated_change'].includes(item.disposition));
  const summary = summarize(classifications);
  return {
    schemaVersion: 1,
    status: projection.issues.length ? 'BLOCKED' : review ? 'REVIEW' : 'READY',
    since,
    baseRevision,
    revision: head.commit,
    dirty: head.dirty,
    range: {
      status: 'ok',
      commitCount: snapshot.commitCount,
      changedFileCount: changed.length,
      patchBytes: snapshot.patchBytes,
      limits: snapshot.limits,
      aggregated: snapshot.commitCount > 50 || changed.length > 100,
    },
    coverage: { status: 'complete', reason: null },
    summary,
    nodes,
    edges,
    classifications,
    writes: mechanicalSections.length ? [{ command: `docguard sync --since ${baseRevision} --write`, scope: 'mechanical_fact' }] : [],
    issues: projection.issues,
  };
}
