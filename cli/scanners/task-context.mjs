/**
 * Deterministic task-specific context selection.
 *
 * @implements docguard.task-specific-agent-context#FR-001
 * @implements docguard.task-specific-agent-context#FR-002
 * @implements docguard.task-specific-agent-context#FR-003
 * @implements docguard.task-specific-agent-context#FR-004
 * @implements docguard.task-specific-agent-context#FR-005
 * @implements docguard.task-specific-agent-context#FR-006
 * @implements docguard.task-specific-agent-context#FR-007
 * @implements docguard.task-specific-agent-context#FR-008
 * @implements docguard.task-specific-agent-context#FR-009
 */

import { basename } from 'node:path';
import { citedSources, contentHash, createEvidenceReader, evidenceDocs, gitEvidence } from './semantic-claims.mjs';
import { compileGlob } from '../shared-ignore.mjs';

const LIMITS = Object.freeze({
  taskChars: 2000,
  documents: 32,
  chunks: 256,
  selectedExcerpts: 6,
  linesPerExcerpt: 16,
  totalChars: 6000,
  pointers: 8,
});
const SCORE_THRESHOLD = 12;
const STOP = new Set('a an and are as at be by can change cli create do docguard for from has have how i improve in into is it make mjs of on or preserve should that the this to update use want when with you your'.split(' '));
const FINDING_RE = /\b[A-Z]{2,5}\d{3}\b/g;
const QUALIFIED_REQ_RE = /\b[a-z0-9][a-z0-9._/-]{2,127}#(?:FR|SC|NFR)-\d{3}\b/gi;
const REQUIREMENT_RE = /\b(?:FR|SC|NFR)-\d{3}\b/g;

function normalizeTask(task) {
  if (typeof task !== 'string') throw new Error('Task context requires a text task.');
  const normalized = task.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  if (!normalized) throw new Error('Task context requires a non-empty task.');
  if (normalized.length > LIMITS.taskChars) throw new Error(`Task context is limited to ${LIMITS.taskChars} characters.`);
  return normalized;
}

function words(text) {
  return [...new Set((String(text).toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) || [])
    .filter(word => !STOP.has(word)))].sort();
}

function exactTokens(text) {
  return [...new Set(String(text).match(/[A-Za-z_$][A-Za-z0-9_$.-]{2,}|(?:[^\s]+\/)+[^\s]+/g) || [])]
    .filter(token => !STOP.has(token.toLowerCase())
      && (/[._/$-]/.test(token) || /[A-Z]/.test(token.slice(1)) || /\d/.test(token)))
    .sort();
}

function ignored(path, config) {
  for (const pattern of config.ignore || []) {
    try { if (compileGlob(pattern).test(path)) return true; } catch { /* invalid config is handled elsewhere */ }
  }
  return false;
}

function safeRegistry(read) {
  const loaded = read('.docguard-specs.json');
  if (loaded.content == null) return { active: [], excluded: 0, issue: 'spec-registry-unavailable' };
  try {
    const registry = JSON.parse(loaded.content);
    if (registry.schemaVersion !== 2 || !Array.isArray(registry.specs)) throw new Error('schema');
    const active = [];
    let excluded = 0;
    for (const entry of registry.specs) {
      const lifecycle = entry?.reviewed?.lifecycle;
      if (lifecycle?.context !== 'current' || lifecycle?.approval !== 'approved') { excluded++; continue; }
      const artifact = entry?.observed?.artifacts?.find(item => item.path === entry.path);
      const spec = read(entry.path);
      if (!artifact?.digest || spec.content == null || contentHash(spec.content) !== artifact.digest) { excluded++; continue; }
      active.push(entry);
    }
    return { active: active.sort((a, b) => a.specId.localeCompare(b.specId)), excluded, issue: null };
  } catch {
    return { active: [], excluded: 0, issue: 'spec-registry-invalid' };
  }
}

function chunks(path, kind, content, specId = null) {
  const lines = content.split('\n');
  const headings = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^#{1,4}\s+(.+)$/);
    if (match) headings.push({ index, heading: match[1].trim() });
  }
  if (!headings.length || headings[0].index !== 0) headings.unshift({ index: 0, heading: basename(path) });
  const ranges = [];
  for (let h = 0; h < headings.length; h++) {
    const sectionStart = headings[h].index;
    const sectionEnd = headings[h + 1]?.index ?? lines.length;
    if (/^implementation outcomes$/i.test(headings[h].heading)) continue;
    for (let start = sectionStart; start < sectionEnd; start += LIMITS.linesPerExcerpt) {
      const end = Math.min(sectionEnd, start + LIMITS.linesPerExcerpt);
      ranges.push({ path, kind, specId, heading: headings[h].heading, startLine: start + 1, endLine: end, content: lines.slice(start, end).join('\n') });
    }
  }
  return ranges;
}

function scoreChunk(chunk, task) {
  const lower = chunk.content.toLowerCase();
  const heading = chunk.heading.toLowerCase();
  const reasons = [];
  let score = 0;
  if (task.paths.includes(chunk.path)) { score += 120; reasons.push('exact-path'); }
  for (const req of task.qualifiedRequirements) {
    const split = req.lastIndexOf('#');
    const scope = req.slice(0, split).toLowerCase();
    const id = req.slice(split + 1).toUpperCase();
    if (lower.includes(req.toLowerCase()) || (chunk.specId?.toLowerCase() === scope && chunk.content.includes(id))) {
      score += 100;
      reasons.push(`qualified-requirement:${req}`);
    }
  }
  for (const code of task.findingCodes) {
    if (chunk.content.includes(code)) { score += 80; reasons.push(`finding-code:${code}`); }
  }
  for (const token of task.exact) {
    if (chunk.content.includes(token)) { score += 12; reasons.push(`exact-token:${token}`); }
  }
  for (const word of task.words) {
    if (lower.includes(word)) {
      score += heading.includes(word) ? 8 : 4;
      reasons.push(`${heading.includes(word) ? 'heading' : 'term'}:${word}`);
    }
  }
  const pathTerms = words(chunk.path);
  const pathOverlap = pathTerms.filter(word => task.words.includes(word));
  if (pathOverlap.length) {
    score += 8 * pathOverlap.length;
    reasons.push(...pathOverlap.map(word => `path-term:${word}`));
  }
  return { score, reasons: [...new Set(reasons)].sort() };
}

function taskSignals(normalized) {
  const paths = [...new Set((normalized.match(/(?:^|\s|[`'"(])([^\s`'"()]+\/[A-Za-z0-9_.\/-]+)(?=$|\s|[`'"),.])/g) || [])
    .map(value => value.trim().replace(/^[`'"(]+|[`'"),.]+$/g, '')))];
  return {
    normalized,
    words: words(normalized),
    exact: exactTokens(normalized),
    paths,
    findingCodes: [...new Set(normalized.match(FINDING_RE) || [])].sort(),
    qualifiedRequirements: [...new Set(normalized.match(QUALIFIED_REQ_RE) || [])].sort(),
  };
}

function requirementIds(chunk) {
  const ids = [...new Set(chunk.content.match(REQUIREMENT_RE) || [])];
  return chunk.specId ? ids.map(id => `${chunk.specId}#${id}`) : [];
}

function pointerRecords(selected, registry, read, task) {
  const candidates = new Map();
  const push = (path, kind, reason, requirement = null, priority = 3) => {
    if (!path) return;
    const result = read(path);
    if (result.evidence.status !== 'snapshot') return;
    const existing = candidates.get(path);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      if (requirement && !existing.requirements.includes(requirement)) existing.requirements.push(requirement);
      if (priority < existing.priority) { existing.priority = priority; existing.kind = kind; }
      return;
    }
    candidates.set(path, { path, kind, requirements: requirement ? [requirement] : [], reasons: [reason], hash: result.evidence.hash, priority });
  };
  for (const path of task.paths) push(path, 'task-path', 'named-by-task', null, 0);
  const explicitRequirements = new Set(task.qualifiedRequirements.map(value => value.toLowerCase()));
  for (const excerpt of selected) {
    for (const path of citedSources(excerpt.content)) {
      const clean = path.replace(/:\d+(?:-\d+)?$/, '');
      const relevant = task.paths.includes(clean) || words(clean).some(word => task.words.includes(word));
      if (relevant) push(clean, 'cited-source', `cited-by:${excerpt.path}`, null, 3);
    }
    for (const identity of requirementIds(excerpt)) {
      if (explicitRequirements.size && !explicitRequirements.has(identity.toLowerCase())) continue;
      const split = identity.lastIndexOf('#');
      const specId = identity.slice(0, split);
      const id = identity.slice(split + 1);
      const spec = registry.find(item => item.specId === specId);
      for (const evidence of spec?.observed?.implementationEvidence || []) {
        if (evidence.requirementId === id) push(evidence.file, 'implementation', `implements:${identity}`, identity, explicitRequirements.size ? 1 : 2);
      }
      for (const evidence of spec?.observed?.testEvidence || []) {
        if (evidence.requirementId === id) push(evidence.file, 'test', `tests:${identity}`, identity, explicitRequirements.size ? 1 : 2);
      }
    }
  }
  return [...candidates.values()]
    .sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path))
    .slice(0, LIMITS.pointers)
    .map(({ priority: _priority, ...item }) => ({
      ...item,
      requirements: item.requirements.sort(),
      reasons: item.reasons.sort(),
    }));
}

function removeContent(excerpt) {
  const { content: _content, ...rest } = excerpt;
  return rest;
}

/** Build a bounded packet or an honest abstention; never writes repository state. */
export function buildTaskContextPacket(projectDir, config = {}, taskText) {
  const normalized = normalizeTask(taskText);
  const signal = taskSignals(normalized);
  const read = createEvidenceReader(projectDir);
  const lifecycle = safeRegistry(read);
  const docPaths = evidenceDocs(projectDir, config).filter(path => !ignored(path, config)).slice(0, LIMITS.documents);
  const safeCanonicalDocs = [];
  const candidates = [];
  const inventory = [];
  const add = (path, kind, specId = null) => {
    if (inventory.includes(path) || inventory.length >= LIMITS.documents) return false;
    const result = read(path);
    if (result.content == null) return false;
    inventory.push(path);
    candidates.push(...chunks(path, kind, result.content, specId));
    return true;
  };
  for (const path of docPaths) if (add(path, 'canonical')) safeCanonicalDocs.push(path);
  for (const spec of lifecycle.active) add(spec.path, 'active-spec', spec.specId);
  if (!ignored('AGENTS.md', config)) add('AGENTS.md', 'project-rules');

  const ranked = candidates.slice(0, LIMITS.chunks).map(chunk => ({ ...chunk, ...scoreChunk(chunk, signal) }))
    .filter(chunk => chunk.score >= SCORE_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine);
  const selected = [];
  let chars = 0;
  let truncated = candidates.length > LIMITS.chunks;
  for (const candidate of ranked) {
    if (selected.length >= LIMITS.selectedExcerpts) { truncated = true; break; }
    if (selected.filter(item => item.path === candidate.path).length >= 2) continue;
    if (selected.some(item => item.path === candidate.path && !(candidate.endLine < item.startLine || candidate.startLine > item.endLine))) continue;
    const remaining = LIMITS.totalChars - chars;
    if (remaining <= 0) { truncated = true; break; }
    const content = candidate.content.length > remaining ? candidate.content.slice(0, remaining) : candidate.content;
    if (content.length < candidate.content.length) truncated = true;
    const file = read(candidate.path).evidence;
    selected.push({
      path: candidate.path,
      kind: candidate.kind,
      specId: candidate.specId,
      heading: candidate.heading,
      startLine: candidate.startLine,
      endLine: candidate.endLine,
      fileHash: file.hash,
      excerptHash: contentHash(content),
      score: candidate.score,
      reasons: candidate.reasons,
      content,
    });
    chars += content.length;
  }
  if (ranked.length > selected.length) truncated = true;

  const status = selected.length ? 'targeted' : 'abstained';
  const limitations = [
    'Selection is deterministic retrieval, not proof that selected prose or omitted files are correct.',
    'Agents may inspect additional repository evidence before editing.',
  ];
  if (lifecycle.issue) limitations.push(lifecycle.issue);
  if (truncated) limitations.push('selection-budget-reached');
  if (status === 'abstained') limitations.push('no-candidate-met-relevance-threshold');
  const pointers = status === 'targeted' ? pointerRecords(selected, lifecycle.active, read, signal) : [];
  const publicExcerpts = status === 'targeted' ? selected : [];
  return {
    schemaVersion: 1,
    kind: 'docguard.task-context',
    task: { digest: contentHash(normalized), characters: normalized.length },
    provenance: { git: gitEvidence(projectDir), registry: lifecycle.issue ? 'unavailable' : 'snapshot' },
    assurance: { scope: 'retrieval-only', factualAccuracy: null, verification: 'unverified' },
    selection: {
      status,
      threshold: SCORE_THRESHOLD,
      candidatesConsidered: Math.min(candidates.length, LIMITS.chunks),
      selectedExcerpts: publicExcerpts.length,
      omittedCandidates: Math.max(0, ranked.length - publicExcerpts.length),
      excludedLifecycleDocuments: lifecycle.excluded,
      limits: LIMITS,
      truncated,
    },
    excerpts: publicExcerpts,
    pointers,
    verification: [
      { command: 'docguard guard --format json', purpose: 'Resolve deterministic errors and triage warnings.' },
      ...(pointers.some(item => item.kind === 'test')
        ? [{ command: 'Run the repository tests that cover the selected test pointers.', purpose: 'Verify task behavior and existing behavior.' }]
        : []),
    ],
    navigation: {
      canonicalDocs: safeCanonicalDocs.sort(),
      activeSpecs: lifecycle.active.map(spec => ({ specId: spec.specId, path: spec.path })),
    },
    limitations,
    coreDigest: contentHash(JSON.stringify({
      task: contentHash(normalized), status,
      excerpts: publicExcerpts.map(removeContent), pointers,
      inventory: inventory.sort(), limitations,
    })),
  };
}

export const TASK_CONTEXT_LIMITS = LIMITS;
export const TASK_CONTEXT_THRESHOLD = SCORE_THRESHOLD;
