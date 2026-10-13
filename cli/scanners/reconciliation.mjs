/**
 * Build a deterministic review graph for code/spec changes since a Git ref.
 * @implements docguard.document-lifecycle#FR-010
 * @implements docguard.document-lifecycle#FR-011
 * @implements docguard.document-lifecycle#FR-012
 * @implements docguard.canonical-requirement-links#FR-001
 * @implements docguard.canonical-requirement-links#FR-002
 * @implements docguard.asset-path-attribution#FR-002
 * @implements docguard.removed-file-attribution#FR-001
 * @implements docguard.removed-file-attribution#FR-002
 * @implements docguard.removed-file-attribution#FR-003
 * @implements docguard.completion-revision-anchoring#FR-008
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { getDiffSnapshot, getHeadInfo, readPatchBatches } from '../shared-git.mjs';
import { parseUnifiedDiff } from '../shared-diff.mjs';
import { mechanicalSectionsForChanges } from '../shared-sync-scope.mjs';
import { assetPathCovers, projectSpecRegistry } from './spec-registry.mjs';
import { collectRequirementIdsFromContent } from '../shared-requirements.mjs';

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

function directSpecLinks(path, mentions, registry) {
  const links = [];
  for (const spec of registry.specs) {
    const evidencePaths = [
      ...spec.observed.artifacts.map(item => item.path),
      ...spec.observed.implementationEvidence.map(item => item.file),
      ...spec.observed.testEvidence.map(item => item.file),
      ...spec.reviewed.scope.canonicalDocs,
    ];
    const explicit = mentions.includes(spec.specId);
    // docguard.asset-path-attribution#FR-002: a reviewed owner for files that
    // cannot name their spec (digest-pinned fixtures, recorded outputs).
    const asset = (spec.reviewed.scope.assetPaths || []).some(assetPath => assetPathCovers(assetPath, path));
    if (evidencePaths.includes(path) || explicit || asset) links.push(spec.specId);
  }
  return [...new Set(links)].sort();
}

// docguard.removed-file-attribution: a deleted file cannot carry an annotation,
// and an assetPaths entry for it would cover nothing (SPR009). Its reviewed
// owner is the current, approved spec whose own documents name the removal:
// the exact path, or a directory that is gone entirely. Only deletions use
// this; a file that still exists needs evidence.
const PATH_EDGE = String.raw`[\s\x60'"()\[\],;:]`;
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function namesWholePath(text, name) {
  return new RegExp(`(?:^|${PATH_EDGE})${escapeRegExp(name)}(?=$|${PATH_EDGE}|\\.(?:\\s|$))`, 'm').test(text);
}

function removalLinks(projectDir, path, registry, cache) {
  const parts = path.split('/');
  // A directory is gone when HEAD tracks nothing under it (Git keeps no
  // empty directories, so one left on disk does not count).
  const removedDirs = parts.slice(1).map((_, i) => `${parts.slice(0, i + 1).join('/')}/`)
    .filter(dir => {
      const key = `dir:${dir}`;
      if (!cache.has(key)) {
        let tracked = true;
        try {
          tracked = execFileSync('git', ['ls-files', '-z', '--', dir], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) !== '';
        } catch { /* unknown: treat as still present */ }
        cache.set(key, tracked);
      }
      return !cache.get(key);
    });
  const links = [];
  for (const spec of registry.specs) {
    const { approval, context } = spec.reviewed.lifecycle;
    if (approval !== 'approved' || context !== 'current') continue;
    const text = spec.observed.artifacts.map(({ path: artifact }) => {
      if (!cache.has(artifact)) {
        let body = '';
        try { body = readFileSync(resolve(projectDir, artifact), 'utf8'); } catch { /* unreadable: names nothing */ }
        cache.set(artifact, body);
      }
      return cache.get(artifact);
    }).join('\n');
    if ([path, ...removedDirs].some(name => namesWholePath(text, name))) links.push(spec.specId);
  }
  return links.sort();
}

// A change that cites a requirement declared in a canonical document
// (`docs-canonical/REQUIREMENTS.md#FR-024`) is traced to approved intent as
// exactly as a spec link. Only declared identities count: a citation of a
// missing file or an undeclared ID stays unsupported.
const CANONICAL_REF = /\b(docs-canonical\/[\w./-]+\.md)#([A-Z]{1,6}-\d{2,4})\b/g;

function canonicalRequirementLinks(projectDir, text, cache) {
  const links = new Set();
  for (const m of text.matchAll(CANONICAL_REF)) {
    const [, doc, id] = m;
    if (doc.split('/').includes('..')) continue;
    if (!cache.has(doc)) {
      const abs = resolve(projectDir, doc);
      let ids = new Map();
      try { if (existsSync(abs)) ids = collectRequirementIdsFromContent(readFileSync(abs, 'utf8'), doc); } catch { /* unreadable: no identities */ }
      cache.set(doc, ids);
    }
    if (cache.get(doc).has(`${doc}#${id}`)) links.add(`${doc}#${id}`);
  }
  return [...links].sort();
}

function disposition(kind, linked, companionKinds, currentSpecs, canonical = [], changedPaths = new Set()) {
  if (kind === 'decision') return { evidenceClass: 'decision', disposition: 'superseded_decision_review', confidence: 'medium' };
  if (kind === 'spec_artifact' || kind === 'canonical_doc') {
    return { evidenceClass: 'approved_intent', disposition: 'intent_change_review', confidence: 'high' };
  }
  if (kind === 'source' || kind === 'test') {
    if (linked.length === 0 && canonical.length > 0) {
      const docChanged = canonical.some(ref => changedPaths.has(ref.split('#')[0]));
      return docChanged
        ? { evidenceClass: 'approved_intent', disposition: 'intentional_behavior_change_review', confidence: 'medium' }
        : { evidenceClass: 'approved_intent', disposition: 'possible_implementation_regression', confidence: 'medium' };
    }
    if (linked.length === 0) return { evidenceClass: 'unsupported', disposition: 'unsupported_or_ambiguous', confidence: 'low' };
    const governingChanged = companionKinds.has('spec_artifact') || companionKinds.has('canonical_doc') || companionKinds.has('decision');
    if (governingChanged) return { evidenceClass: 'approved_intent', disposition: 'intentional_behavior_change_review', confidence: 'medium' };
    const governs = linked.some(id => currentSpecs.has(id));
    if (governs) return { evidenceClass: 'approved_intent', disposition: 'possible_implementation_regression', confidence: 'medium' };
    return { evidenceClass: 'decision', disposition: 'superseded_decision_review', confidence: 'medium' };
  }
  return { evidenceClass: 'unrelated', disposition: 'unrelated_change', confidence: 'high' };
}

const isLocal = path => path?.split('/').includes('.local');

// What reconciliation needs from a file's changed lines: the specs whose
// requirement identities they name and, for source and tests, the canonical
// requirements they cite. Keeping these instead of the text lets a range read
// in batches hold one batch's patch at a time (FR-008).
function collectChangeFacts(projectDir, patch, registry, canonicalCache, facts) {
  for (const file of parseUnifiedDiff(patch)) {
    const path = file.newPath || file.oldPath;
    if (!path || [file.oldPath, file.newPath].some(isLocal)) continue;
    const text = file.hunks.flatMap(hunk => hunk.lines.filter(line => line.op !== ' ').map(line => line.text)).join('\n');
    const mentions = registry.specs
      .filter(spec => (spec.intent.requirements || []).some(identity => text.includes(identity)))
      .map(spec => spec.specId);
    const kind = fileKind(path, registry);
    const canonical = kind === 'source' || kind === 'test' ? canonicalRequirementLinks(projectDir, text, canonicalCache) : [];
    facts.set(path, { mentions, canonical });
  }
}

function blockedRange(since, baseRevision, head, snapshot, issues, reading = {}) {
  return {
    schemaVersion: 1,
    status: 'BLOCKED',
    since,
    baseRevision,
    revision: head.commit,
    dirty: head.dirty,
    range: {
      status: reading.status || snapshot.status,
      commitCount: snapshot.commitCount,
      changedFileCount: snapshot.changedFiles.length,
      patchBytes: reading.patchBytes ?? snapshot.patchBytes,
      ...(reading.batches !== undefined ? { batches: reading.batches } : {}),
      limits: snapshot.limits,
    },
    coverage: { status: 'partial', reason: reading.reason || snapshot.reason },
    summary: { total: 0, byKind: {}, byDisposition: {}, byConfidence: {} },
    nodes: [], edges: [], classifications: [], writes: [], issues,
  };
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
  const limits = runtime.diffLimits || {};
  const readDiff = runtime.getDiffSnapshot || ((dir, ref) => getDiffSnapshot(dir, ref, limits));
  const readBatches = runtime.readPatchBatches || readPatchBatches;
  // Use the already verified full commit ID for every subsequent Git call.
  // This removes revision-option ambiguity from user-supplied `--since` text.
  const snapshot = readDiff(projectDir, baseRevision);
  const facts = new Map();
  const canonicalCache = new Map();
  let batches = 1;
  let patchBytes = snapshot.patchBytes;
  if (snapshot.status === 'ok') {
    collectChangeFacts(projectDir, snapshot.patch, projection.registry, canonicalCache, facts);
  } else if (Number.isSafeInteger(snapshot.commitCount) && ['too-large', 'timeout'].includes(snapshot.status)) {
    // The inventory is whole and only the single patch read failed: read the
    // patch again in bounded batches (FR-008).
    const reading = readBatches(projectDir, baseRevision, snapshot.changedFiles,
      patch => collectChangeFacts(projectDir, patch, projection.registry, canonicalCache, facts), limits);
    if (reading.status !== 'ok') return blockedRange(since, baseRevision, head, snapshot, projection.issues, reading);
    ({ batches, patchBytes } = reading);
  } else {
    return blockedRange(since, baseRevision, head, snapshot, projection.issues);
  }
  const changed = snapshot.changedFiles
    .map(file => file.newPath || file.oldPath)
    .filter(path => path && !isLocal(path));
  const preliminary = [...new Set(changed)].sort().map(path => {
    const kind = fileKind(path, projection.registry);
    const { mentions = [], canonical = [] } = facts.get(path) || {};
    const item = { path, kind, specs: directSpecLinks(path, mentions, projection.registry) };
    if (canonical.length) item.canonical = canonical;
    return item;
  });
  const deleted = new Set(snapshot.changedFiles.filter(file => file.status.startsWith('D')).map(file => file.oldPath));
  const artifactCache = new Map();
  for (const item of preliminary) {
    if (item.specs.length === 0 && deleted.has(item.path)) item.specs = removalLinks(projectDir, item.path, projection.registry, artifactCache);
  }
  const changedPaths = new Set(preliminary.map(item => item.path));
  const currentSpecs = new Set(projection.registry.specs
    .filter(spec => spec.reviewed.lifecycle.context === 'current' && spec.reviewed.lifecycle.approval === 'approved')
    .map(spec => spec.specId));
  const classifications = preliminary.map(item => {
    const companionKinds = new Set(preliminary
      .filter(other => other.specs.some(id => item.specs.includes(id)))
      .map(other => other.kind));
    return { ...item, ...disposition(item.kind, item.specs, companionKinds, currentSpecs, item.canonical, changedPaths) };
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
    ...[...new Set(preliminary.flatMap(item => item.canonical || []))].sort()
      .map(ref => ({ id: `requirement:${ref}`, type: 'canonical_requirement', path: ref.split('#')[0] })),
  ];
  const edges = preliminary.flatMap(item => [
    ...item.specs.map(specId => ({
      from: `change:${item.path}`,
      to: `spec:${specId}`,
      kind: 'direct_evidence',
      confidence: 'high',
    })),
    ...(item.canonical || []).map(ref => ({
      from: `change:${item.path}`,
      to: `requirement:${ref}`,
      kind: 'canonical_requirement',
      confidence: 'high',
    })),
  ]);
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
      patchBytes,
      batches,
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
