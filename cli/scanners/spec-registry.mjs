/**
 * Deterministic Spec Kit lifecycle registry projection.
 *
 * Specs own requirement prose. The registry owns reviewed lifecycle metadata
 * and regenerates only observable facts, so a refresh cannot silently rewrite
 * intent or declare work complete.
 * @implements docguard.document-lifecycle#FR-013
 * @implements docguard.document-lifecycle#FR-016
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve, sep } from 'node:path';
import { detectSpecKit } from './speckit.mjs';
import { readRetirementManifest } from './document-lifecycle.mjs';
import { collectRequirementIdsFromContent, requirementPatterns } from '../shared-requirements.mjs';
import { walkFiles } from '../shared-ignore.mjs';
import { scanImplementationFilesForReferences, scanTestFilesForReferences } from './requirement-evidence.mjs';

export const SPEC_REGISTRY_PATH = '.docguard-specs.json';
export const SPEC_REGISTRY_SCHEMA_VERSION = 2;
export const SPEC_REGISTRY_SCHEMA_URL = 'https://raccioly.github.io/docguard/schemas/docguard-specs.schema.json';

const SPEC_ID_RE = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const APPROVAL = new Set(['draft', 'approved', 'rejected']);
const DELIVERY = new Set(['planned', 'in_progress', 'implemented', 'verified', 'released']);
const CONTEXT = new Set(['current', 'retired']);
const RETIREMENT = new Set([null, 'completed', 'superseded', 'abandoned']);
const STORAGE = new Set(['working_tree', 'git_history']);
const PERSISTENCE = new Set([null, 'flow_back', 'flow_forward', 'living']);
const STOP_TERMS = new Set(['must', 'should', 'with', 'from', 'that', 'this', 'have', 'into']);

const posix = path => path.split(sep).join('/').replace(/^\.\//, '');
const digest = content => `sha256:${createHash('sha256').update(content).digest('hex')}`;
const sortedUnique = values => [...new Set(values)].sort((a, b) => a.localeCompare(b));

function isSafeFile(projectDir, path) {
  try {
    const root = realpathSync(projectDir);
    const real = realpathSync(path);
    return lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()
      && (real === root || real.startsWith(`${root}${sep}`));
  } catch { return false; }
}

export function parseSpecId(content) {
  const header = content.split('\n').slice(0, 80).join('\n');
  const comment = header.match(/<!--\s*docguard:spec-id\s+([^\s>]+)\s*-->/i);
  const field = header.match(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?Spec ID(?:\*\*)?\s*:\s*(?:`([^`]+)`|([^\s\n]+))/i);
  return (comment?.[1] || field?.[1] || field?.[2] || '').trim() || null;
}

function readJson(path, label) {
  if (!existsSync(path)) return { exists: false, value: null, error: null };
  try {
    return { exists: true, value: JSON.parse(readFileSync(path, 'utf8')), error: null };
  } catch (error) {
    return { exists: true, value: null, error: `${label} is not valid JSON: ${error.message}` };
  }
}

function defaultControl() {
  return {
    reviewed: {
      lifecycle: {
        approval: 'draft',
        delivery: 'planned',
        context: 'current',
        retirementReason: null,
        storage: 'working_tree',
        persistenceModel: null,
      },
      relations: {
        extends: [],
        duplicates: [],
        conflictsWith: [],
        supersedes: [],
        supersededBy: [],
      },
      scope: { canonicalDocs: [] },
      reconciliation: { lastReviewedRevision: null, outcomes: [] },
    },
  };
}

function validateStringArray(value, label, issues) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    issues.push({ code: 'SPR003', path: SPEC_REGISTRY_PATH, message: `${label} must be an array of non-empty strings.` });
    return [];
  }
  return sortedUnique(value);
}

function validateSpecIdArray(value, label, owner, issues) {
  const values = validateStringArray(value, label, issues);
  if (values.some(item => !SPEC_ID_RE.test(item))) {
    issues.push({ code: 'SPR003', path: SPEC_REGISTRY_PATH, message: `${label} contains an invalid spec ID.` });
  }
  if (values.includes(owner)) {
    issues.push({ code: 'SPR004', path: SPEC_REGISTRY_PATH, message: `${owner} cannot relate to itself through ${label}.` });
  }
  return values;
}

function validateCanonicalPaths(value, label, issues) {
  const values = validateStringArray(value, label, issues);
  if (values.some(path => path.startsWith('/') || path.split(/[\\/]/).some(part => part === '..' || part === '.local'))) {
    issues.push({ code: 'SPR003', path: SPEC_REGISTRY_PATH, message: `${label} must contain safe repository-relative paths outside .local.` });
  }
  return values;
}

function rejectUnknownKeys(value, allowed, label, issues) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ code: 'SPR003', path: SPEC_REGISTRY_PATH, message: `${label} must be an object.` });
    return;
  }
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length) issues.push({ code: 'SPR003', path: SPEC_REGISTRY_PATH, message: `${label} has unknown field(s): ${unknown.join(', ')}.` });
}

function validatedControl(entry, issues) {
  const fallback = defaultControl();
  if (!entry) return fallback;
  const reviewed = entry.reviewed;
  rejectUnknownKeys(reviewed, new Set(['lifecycle', 'relations', 'scope', 'reconciliation']), `${entry.specId}.reviewed`, issues);
  if (!reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed)) return fallback;
  const lifecycle = reviewed.lifecycle || {};
  rejectUnknownKeys(lifecycle, new Set(['approval', 'delivery', 'context', 'retirementReason', 'storage', 'persistenceModel']), `${entry.specId}.reviewed.lifecycle`, issues);
  const checks = [
    ['approval', APPROVAL], ['delivery', DELIVERY], ['context', CONTEXT],
    ['retirementReason', RETIREMENT], ['storage', STORAGE], ['persistenceModel', PERSISTENCE],
  ];
  for (const [key, allowed] of checks) {
    if (!allowed.has(lifecycle[key])) {
      issues.push({ code: 'SPR003', path: SPEC_REGISTRY_PATH, message: `Invalid lifecycle.${key} for ${entry.specId || '<unknown spec>'}.` });
    }
  }
  const relations = reviewed.relations || {};
  const scope = reviewed.scope || {};
  const reconciliation = reviewed.reconciliation || {};
  rejectUnknownKeys(relations, new Set(['extends', 'duplicates', 'conflictsWith', 'supersedes', 'supersededBy']), `${entry.specId}.reviewed.relations`, issues);
  rejectUnknownKeys(scope, new Set(['canonicalDocs']), `${entry.specId}.reviewed.scope`, issues);
  rejectUnknownKeys(reconciliation, new Set(['lastReviewedRevision', 'outcomes']), `${entry.specId}.reviewed.reconciliation`, issues);
  const revision = reconciliation.lastReviewedRevision ?? null;
  if (revision !== null && (typeof revision !== 'string' || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(revision))) {
    issues.push({ code: 'SPR003', path: SPEC_REGISTRY_PATH, message: `Invalid reconciliation revision for ${entry.specId}.` });
  }
  const outcomes = reconciliation.outcomes ?? [];
  if (!Array.isArray(outcomes) || outcomes.length > 20 || outcomes.some(outcome => {
    if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) return true;
    const allowed = new Set(['revision', 'reason', 'evidence', 'deviations', 'successor']);
    return Object.keys(outcome).some(key => !allowed.has(key))
      || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(outcome.revision || '')
      || typeof outcome.reason !== 'string' || !outcome.reason.trim() || outcome.reason.length > 500
      || !Array.isArray(outcome.evidence) || outcome.evidence.length > 100
      || outcome.evidence.some(path => typeof path !== 'string' || !path.trim())
      || !Array.isArray(outcome.deviations) || outcome.deviations.length > 20
      || outcome.deviations.some(item => typeof item !== 'string' || !item.trim() || item.length > 500)
      || (outcome.successor !== null && outcome.successor !== undefined && !SPEC_ID_RE.test(outcome.successor));
  })) {
    issues.push({ code: 'SPR003', path: SPEC_REGISTRY_PATH, message: `Invalid or unbounded reconciliation outcomes for ${entry.specId}.` });
  }
  return {
    reviewed: {
      lifecycle: {
        approval: APPROVAL.has(lifecycle.approval) ? lifecycle.approval : fallback.reviewed.lifecycle.approval,
        delivery: DELIVERY.has(lifecycle.delivery) ? lifecycle.delivery : fallback.reviewed.lifecycle.delivery,
        context: CONTEXT.has(lifecycle.context) ? lifecycle.context : fallback.reviewed.lifecycle.context,
        retirementReason: RETIREMENT.has(lifecycle.retirementReason) ? lifecycle.retirementReason : null,
        storage: STORAGE.has(lifecycle.storage) ? lifecycle.storage : fallback.reviewed.lifecycle.storage,
        persistenceModel: PERSISTENCE.has(lifecycle.persistenceModel) ? lifecycle.persistenceModel : null,
      },
      relations: {
        extends: validateSpecIdArray(relations.extends ?? [], `${entry.specId}.relations.extends`, entry.specId, issues),
        duplicates: validateSpecIdArray(relations.duplicates ?? [], `${entry.specId}.relations.duplicates`, entry.specId, issues),
        conflictsWith: validateSpecIdArray(relations.conflictsWith ?? [], `${entry.specId}.relations.conflictsWith`, entry.specId, issues),
        supersedes: validateSpecIdArray(relations.supersedes ?? [], `${entry.specId}.relations.supersedes`, entry.specId, issues),
        supersededBy: validateSpecIdArray(relations.supersededBy ?? [], `${entry.specId}.relations.supersededBy`, entry.specId, issues),
      },
      scope: {
        canonicalDocs: validateCanonicalPaths(scope.canonicalDocs ?? [], `${entry.specId}.scope.canonicalDocs`, issues),
      },
      reconciliation: {
        lastReviewedRevision: revision,
        outcomes: Array.isArray(outcomes) ? outcomes.slice(-20).map(outcome => ({
          revision: outcome.revision,
          reason: outcome.reason,
          evidence: sortedUnique(outcome.evidence || []),
          deviations: sortedUnique(outcome.deviations || []),
          successor: outcome.successor ?? null,
        })) : [],
      },
    },
  };
}

export function readSpecRegistry(projectDir) {
  const loaded = readJson(resolve(projectDir, SPEC_REGISTRY_PATH), SPEC_REGISTRY_PATH);
  if (!loaded.exists || loaded.error) return loaded;
  const value = loaded.value;
  if (value?.$schema !== SPEC_REGISTRY_SCHEMA_URL || ![1, SPEC_REGISTRY_SCHEMA_VERSION].includes(value?.schemaVersion)
    || !Array.isArray(value?.specs) || !Array.isArray(value?.tombstones)) {
    return { exists: true, value: null, error: `${SPEC_REGISTRY_PATH} does not use a supported schema version.` };
  }
  const topKeys = new Set(['$schema', 'schemaVersion', 'specs', 'tombstones']);
  const unknownTop = Object.keys(value).filter(key => !topKeys.has(key));
  if (unknownTop.length) return { exists: true, value: null, error: `${SPEC_REGISTRY_PATH} has unknown field(s): ${unknownTop.join(', ')}.` };
  const shapeIssues = registryShapeIssues(value);
  if (shapeIssues.length > 0) {
    return { exists: true, value: null, error: shapeIssues.map(issue => issue.message).join(' ') };
  }
  return loaded;
}

function taskCompletion(path) {
  if (!path || !existsSync(path)) return { checked: 0, total: 0 };
  const content = readFileSync(path, 'utf8');
  const checked = content.match(/(?:^|\n)\s*- \[[xX]\]/g)?.length || 0;
  const open = content.match(/(?:^|\n)\s*- \[ \]/g)?.length || 0;
  return { checked, total: checked + open };
}

function projectFiles(projectDir) {
  const tracked = spawnSync('git', ['ls-files', '-z'], {
    cwd: projectDir,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (tracked.status === 0) return tracked.stdout.split('\0').filter(Boolean).map(posix).sort();
  const files = [];
  const root = realpathSync(projectDir);
  walkFiles(projectDir, path => {
    try {
      if (lstatSync(path).isSymbolicLink()) return;
      const real = realpathSync(path);
      if (real !== root && !real.startsWith(`${root}${sep}`)) return;
      files.push(posix(relative(projectDir, path)));
    } catch { /* unreadable candidates cannot become evidence */ }
  }, {
    keepDot: entry => entry === '.github',
  });
  return files.sort();
}

function evidenceForSpec(specId, path, requirements, refs) {
  const requirementIds = new Set(requirements.map(requirement => requirement.slice(requirement.lastIndexOf('#') + 1)));
  const evidence = [];
  for (const [requirementId, locations] of refs) {
    if (!requirementIds.has(requirementId)) continue;
    for (const location of locations) {
      // Bare numeric IDs are too ambiguous for lifecycle proof once a repo has
      // multiple specs. Require an immutable ID or exact historical path.
      if (location.scope === path || location.scope === specId) {
        evidence.push({ requirementId, file: location.file, line: location.line });
      }
    }
  }
  return evidence.sort((a, b) => a.requirementId.localeCompare(b.requirementId)
    || a.file.localeCompare(b.file) || a.line - b.line);
}

function archiveTombstones(entries, retention = null) {
  return entries
    .filter(entry => Array.isArray(entry.requirementIds) && entry.requirementIds.length > 0)
    .map(entry => ({
      specId: typeof entry.specId === 'string' ? entry.specId : null,
      path: entry.path,
      archivedFrom: entry.archivedFrom,
      blob: entry.blob,
      retentionRef: entry.retentionRef || retention?.ref || null,
      objectFormat: entry.objectFormat || retention?.objectFormat || null,
      recoverability: entry.recoverability || retention?.recoverability || null,
      requirements: sortedUnique(entry.requirementIds.map(id => `${entry.specId || entry.path}#${id}`)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function registryShapeIssues(registry) {
  const issues = [];
  if (!registry) return issues;
  const ids = new Set();
  for (const entry of registry.specs) {
    if (!entry || !SPEC_ID_RE.test(entry.specId || '') || typeof entry.path !== 'string') {
      issues.push({ code: 'SPR003', path: SPEC_REGISTRY_PATH, message: 'Every registry spec needs a valid specId and path.' });
      continue;
    }
    if (ids.has(entry.specId)) issues.push({ code: 'SPR002', path: SPEC_REGISTRY_PATH, message: `Registry reuses immutable spec ID ${entry.specId}.` });
    ids.add(entry.specId);
    rejectUnknownKeys(entry, new Set(['specId', 'path', 'reviewed', 'intent', 'observed']), `${entry.specId}`, issues);
    validatedControl(entry, issues);
  }
  return issues;
}

function relationGraphIssues(specs) {
  const issues = [];
  const byId = new Map(specs.map(entry => [entry.specId, entry]));
  const reciprocal = new Map([
    ['duplicates', 'duplicates'],
    ['conflictsWith', 'conflictsWith'],
    ['supersedes', 'supersededBy'],
    ['supersededBy', 'supersedes'],
  ]);

  for (const entry of specs) {
    for (const [relation, targets] of Object.entries(entry.reviewed.relations)) {
      for (const targetId of targets) {
        const target = byId.get(targetId);
        if (!target) {
          issues.push({
            code: 'SPR004',
            path: entry.path,
            message: `${entry.specId}.${relation} references unknown spec ${targetId}.`,
          });
          continue;
        }
        const inverse = reciprocal.get(relation);
        if (inverse && !target.reviewed.relations[inverse].includes(entry.specId)) {
          issues.push({
            code: 'SPR004',
            path: entry.path,
            message: `${entry.specId}.${relation} must be mirrored by ${targetId}.${inverse}.`,
          });
        }
      }
    }

    if (entry.reviewed.lifecycle.retirementReason === 'superseded') {
      for (const successorId of entry.reviewed.relations.supersededBy) {
        const successor = byId.get(successorId);
        if (successor && (successor.reviewed.lifecycle.context !== 'current'
          || successor.reviewed.lifecycle.approval !== 'approved')) {
          issues.push({
            code: 'SPR004',
            path: entry.path,
            message: `Successor ${successorId} must be an approved current spec.`,
          });
        }
      }
    }
  }
  return issues;
}

export function projectSpecRegistry(projectDir, config = {}, options = {}) {
  const existing = readSpecRegistry(projectDir);
  const issues = [];
  if (existing.error) issues.push({ code: 'SPR003', path: SPEC_REGISTRY_PATH, message: existing.error });
  issues.push(...registryShapeIssues(existing.value));
  const existingById = new Map((existing.value?.specs || []).map(entry => [entry.specId, entry]));
  const detected = detectSpecKit(projectDir);
  const files = projectFiles(projectDir);
  const patterns = requirementPatterns(config);
  const testReferences = scanTestFilesForReferences(projectDir, files, patterns);
  const implementationReferences = scanImplementationFilesForReferences(projectDir, files, patterns);
  const ids = new Map();
  const specs = [];

  for (const feature of detected.specs.filter(item => item.hasSpec)) {
    const path = posix(relative(projectDir, feature.specPath));
    if (path === options.excludeSpecPath) continue;
    const artifactsForFeature = [feature.specPath, feature.planPath, feature.tasksPath].filter(Boolean);
    const unsafeArtifact = artifactsForFeature.find(artifact => !isSafeFile(projectDir, artifact));
    if (unsafeArtifact) {
      issues.push({ code: 'SPR003', path: posix(relative(projectDir, unsafeArtifact)), message: 'Spec artifacts must be regular files inside the project; symlinks cannot supply lifecycle evidence.' });
      continue;
    }
    let content;
    try { content = readFileSync(feature.specPath, 'utf8'); } catch (error) {
      issues.push({ code: 'SPR003', path, message: `Cannot read spec: ${error.message}` });
      continue;
    }
    const specId = parseSpecId(content);
    if (!specId || !SPEC_ID_RE.test(specId)) {
      issues.push({ code: 'SPR002', path, message: 'Spec needs an immutable lowercase `Spec ID` (3-128 letters, digits, dots, underscores, or hyphens).' });
      continue;
    }
    if (ids.has(specId)) {
      issues.push({ code: 'SPR002', path, message: `Spec ID ${specId} is already declared by ${ids.get(specId)}.` });
      continue;
    }
    ids.set(specId, path);
    const control = validatedControl(existingById.get(specId), issues);
    if (control.reviewed.lifecycle.context !== 'current' || control.reviewed.lifecycle.storage !== 'working_tree') {
      issues.push({ code: 'SPR004', path, message: `Active spec ${specId} must have context=current and storage=working_tree.` });
    }
    if (control.reviewed.lifecycle.retirementReason !== null) {
      issues.push({ code: 'SPR004', path, message: `Active spec ${specId} cannot have a retirement reason.` });
    }
    const definitions = collectRequirementIdsFromContent(content, path, patterns);
    const requirements = sortedUnique([...definitions.values()].map(definition => `${specId}#${definition.id}`));
    const artifacts = artifactsForFeature
      .map(artifact => ({
        path: posix(relative(projectDir, artifact)),
        digest: digest(readFileSync(artifact, 'utf8')),
      }));
    specs.push({
      specId,
      path,
      ...control,
      intent: { requirements },
      observed: {
        artifacts,
        taskCompletion: taskCompletion(feature.tasksPath),
        implementationEvidence: evidenceForSpec(specId, path, requirements, implementationReferences),
        testEvidence: evidenceForSpec(specId, path, requirements, testReferences),
      },
    });
  }

  const archive = readRetirementManifest(projectDir);
  if (!archive.ok) issues.push({ code: 'SPR004', path: '.docguard-archive.json', message: archive.error });
  const tombstones = archive.ok ? archiveTombstones(archive.entries, archive.retention) : [];
  const archivedPaths = new Set(archive.entries.map(entry => entry.path));
  for (const entry of existing.value?.specs || []) {
    if (ids.has(entry.specId)) continue;
    const control = validatedControl(entry, issues);
    if (control.reviewed.lifecycle.context !== 'retired' || control.reviewed.lifecycle.storage !== 'git_history'
      || !control.reviewed.lifecycle.retirementReason || !archivedPaths.has(entry.path)) {
      issues.push({ code: 'SPR004', path: entry.path, message: `Registry spec ${entry.specId} is absent from the working tree without a matching retired lifecycle and archive event.` });
      continue;
    }
    specs.push({ ...entry, ...control });
  }

  for (const entry of specs) {
    if (entry.reviewed.lifecycle.retirementReason === 'superseded'
      && entry.reviewed.relations.supersededBy.length === 0) {
      issues.push({ code: 'SPR004', path: entry.path, message: `Superseded spec ${entry.specId} needs a reviewed supersededBy relationship.` });
    }
  }
  issues.push(...relationGraphIssues(specs));

  const projected = {
    $schema: SPEC_REGISTRY_SCHEMA_URL,
    schemaVersion: SPEC_REGISTRY_SCHEMA_VERSION,
    specs: specs.sort((a, b) => a.specId.localeCompare(b.specId)),
    tombstones,
  };
  const serialized = `${JSON.stringify(projected, null, 2)}\n`;
  const current = existing.exists && !existing.error
    ? `${JSON.stringify(existing.value, null, 2)}\n` === serialized
    : false;
  return {
    registry: projected,
    serialized,
    current,
    exists: existing.exists,
    issues,
    detected: detected.specs.length,
  };
}

function terms(text) {
  return new Set((text.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [])
    .filter(term => !STOP_TERMS.has(term)));
}

function similarity(left, right) {
  const a = terms(left);
  const b = terms(right);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / new Set([...a, ...b]).size;
}

export function preflightSpec(projectDir, config = {}, draftPath = null) {
  let absolute = null;
  let rel = null;
  if (draftPath) {
    absolute = resolve(projectDir, draftPath);
    rel = posix(relative(projectDir, absolute));
  }
  const projection = projectSpecRegistry(projectDir, config, { excludeSpecPath: rel });
  const briefing = projection.registry.specs
    .filter(entry => entry.reviewed.lifecycle.context === 'current')
    .map(entry => ({
      specId: entry.specId,
      path: entry.path,
      approval: entry.reviewed.lifecycle.approval,
      delivery: entry.reviewed.lifecycle.delivery,
      requirements: entry.intent?.requirements?.length || 0,
      taskCompletion: entry.observed?.taskCompletion || { checked: 0, total: 0 },
      testEvidence: entry.observed?.testEvidence?.length || 0,
    }));
  if (!draftPath) {
    const emptyProject = projection.detected === 0 && !projection.exists && projection.issues.length === 0;
    const ready = projection.current || emptyProject;
    return {
      status: ready ? 'BRIEFING' : 'BLOCKED',
      briefing,
      blockers: ready ? [] : projection.issues.length
        ? projection.issues
        : [{ code: 'SPR001', path: SPEC_REGISTRY_PATH, message: 'Spec registry is missing or stale.' }],
      overlaps: [],
    };
  }

  const blockers = [...projection.issues];
  let safeDraft = false;
  try {
    const root = realpathSync(projectDir);
    const real = realpathSync(absolute);
    safeDraft = Boolean(rel && rel !== '..' && !rel.startsWith('../')
      && !rel.split('/').includes('.local')
      && existsSync(absolute) && lstatSync(absolute).isFile() && !lstatSync(absolute).isSymbolicLink()
      && (real === root || real.startsWith(`${root}${sep}`)));
  } catch { safeDraft = false; }
  if (!safeDraft) {
    blockers.push({ code: 'SPR003', path: draftPath, message: 'Preflight path must name a readable spec inside the project.' });
    return { status: 'BLOCKED', briefing, blockers, overlaps: [] };
  }
  if (!projection.current) blockers.push({ code: 'SPR001', path: SPEC_REGISTRY_PATH, message: 'Refresh the committed registry before planning a new spec.' });
  const content = readFileSync(absolute, 'utf8');
  const specId = parseSpecId(content);
  if (!specId || !SPEC_ID_RE.test(specId)) blockers.push({ code: 'SPR002', path: rel, message: 'Draft needs a valid immutable Spec ID.' });
  const reused = projection.registry.specs.find(entry => entry.specId === specId && entry.path !== rel);
  if (reused) blockers.push({ code: 'SPR002', path: rel, message: `Spec ID ${specId} already belongs to ${reused.path}.` });
  const draftRequirements = [...collectRequirementIdsFromContent(content, rel, requirementPatterns(config)).values()]
    .map(definition => definition.text).join('\n');
  const overlaps = projection.registry.specs
    .filter(entry => entry.path !== rel && existsSync(resolve(projectDir, entry.path)))
    .map(entry => {
      const priorContent = readFileSync(resolve(projectDir, entry.path), 'utf8');
      const priorRequirements = [...collectRequirementIdsFromContent(priorContent, entry.path, requirementPatterns(config)).values()]
        .map(definition => definition.text).join('\n');
      return {
        specId: entry.specId,
        path: entry.path,
        relationship: 'ambiguous',
        intent: entry.reviewed.lifecycle.context,
        implementation: entry.observed.implementationEvidence.length ? 'present' : 'unsupported',
        provenance: entry.observed.testEvidence.length ? 'spec-linked' : 'unknown',
        confidence: 'low',
        similarity: similarity(draftRequirements, priorRequirements),
      };
    })
    .filter(entry => entry.similarity >= 0.25)
    .sort((a, b) => b.similarity - a.similarity);
  return { status: blockers.length ? 'BLOCKED' : 'READY', specId, path: rel, briefing, blockers, overlaps };
}
