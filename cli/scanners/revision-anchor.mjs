/**
 * Revision anchoring for spec completion.
 *
 * Spec: specs/028-completion-revision-anchoring (docguard.completion-revision-anchoring).
 *
 * `specs complete` records the revision it reviewed. Under a squash-merge
 * workflow a revision recorded on a PR branch never reaches the default
 * branch, so the next maintenance completion cannot reconcile from it. This
 * module answers three questions with plain git plumbing (argv arrays only):
 *
 *   - which recorded revisions dangle (do not resolve, or are not ancestors
 *     of HEAD);
 *   - which tracked changes are only the lifecycle files completion writes,
 *     so several completions can share one revision and one commit;
 *   - which first-parent commit carries byte-identical evidence, so an anchor
 *     can move without anyone re-reviewing unchanged files.
 *
 * @implements docguard.completion-revision-anchoring#FR-001
 * @implements docguard.completion-revision-anchoring#FR-002
 * @implements docguard.completion-revision-anchoring#FR-003
 * @implements docguard.completion-one-commit#FR-001
 * @implements docguard.completion-one-commit#FR-006
 * @implements docguard.completion-one-commit#FR-007
 * @implements docguard.completion-one-commit#FR-009
 */

import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readOutcomeBlobs, stripImplementationOutcomes } from '../writers/spec-outcomes.mjs';
import { ensureStateDir, STATE_DIR } from '../writers/state-dir.mjs';
import { OWN_STATE_PATHSPEC, isShallowRepository, runGit } from '../shared-git.mjs';

const REVISION_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
export const HISTORY_LIMIT = 1000;

// docguard.verdict-contract#FR-004: a spawn failure is recorded as a gap; a
// non-zero exit (an unknown revision) stays an answer.
function git(projectDir, args) {
  const r = runGit(projectDir, args, { operation: `git ${args[0]} (revision anchor)`, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
  return r.status === 0 && !r.error ? { ok: true, out: r.stdout } : { ok: false, out: '' };
}

export { isShallowRepository };

export function revisionResolves(projectDir, revision) {
  return REVISION_RE.test(revision || '') && git(projectDir, ['cat-file', '-e', `${revision}^{commit}`]).ok;
}

/**
 * The full SHA of the commit `revision` names (a branch, tag, `HEAD`, an
 * abbreviated SHA), or null. A value starting with `-` is refused before git
 * runs: git would read it as an option.
 * @implements docguard.first-spec-preflight#FR-010
 */
export function resolveCommit(projectDir, revision) {
  const value = typeof revision === 'string' ? revision.trim() : '';
  if (!value || value.startsWith('-') || value.length > 256 || /[\s\0]/.test(value)) return null;
  const r = git(projectDir, ['rev-parse', '--verify', '--quiet', `${value}^{commit}`]);
  const sha = r.ok ? r.out.trim() : '';
  return REVISION_RE.test(sha) ? sha : null;
}

export function isAncestorOf(projectDir, revision, of = 'HEAD') {
  return git(projectDir, ['merge-base', '--is-ancestor', revision, of]).ok;
}

/** Commits reachable from `to` and not from `from`, or null when Git cannot count them. */
export function commitsBetween(projectDir, from, to) {
  const r = git(projectDir, ['rev-list', '--count', `${from}..${to}`]);
  const count = r.ok ? Number(r.out.trim()) : NaN;
  return Number.isSafeInteger(count) ? count : null;
}

/** The blob id of `path` at `revision`, or null when the path is absent there. */
export function blobAt(projectDir, revision, path) {
  const r = git(projectDir, ['rev-parse', '--verify', '--quiet', `${revision}:${path}`]);
  return r.ok ? r.out.trim() || null : null;
}

/** Every revision a spec's reviewed state points at. */
export function recordedRevisions(spec) {
  const rec = spec?.reviewed?.reconciliation || {};
  return [...new Set([rec.lastReviewedRevision, ...(rec.outcomes || []).map(o => o.revision)].filter(Boolean))];
}

/**
 * Recorded revisions that do not resolve or are not ancestors of HEAD.
 * @returns {Array<{ specId: string, revision: string, reason: 'missing'|'not-ancestor' }>}
 */
export function danglingRevisions(projectDir, registry) {
  const out = [];
  for (const spec of registry?.specs || []) {
    for (const revision of recordedRevisions(spec)) {
      if (!revisionResolves(projectDir, revision)) out.push({ specId: spec.specId, revision, reason: 'missing' });
      else if (!isAncestorOf(projectDir, revision)) out.push({ specId: spec.specId, revision, reason: 'not-ancestor' });
    }
  }
  return out;
}

/** A task list with every checkbox read as unchecked: equal for two lists that differ only by ticks. */
const uncheckedTasks = text => String(text).replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/gm, '$1[ ]');

/**
 * Tracked changes other than the lifecycle files completion itself writes:
 * the registry, the active context, and spec files whose change is confined
 * to the implementation-outcomes block.
 * @returns {string[]|null} changed paths, or null when git cannot answer
 */
export function nonLifecycleChanges(projectDir, { registryPath, contextPath, specPaths = [], tickOnlyPaths = [] }) {
  // DocGuard's own .docguard/ state is never a change (docguard.read-only-commands#FR-006).
  const status = git(projectDir, ['status', '--porcelain=v1', '-z', '--untracked-files=no', ...OWN_STATE_PATHSPEC]);
  if (!status.ok) return null;
  const specs = new Set(specPaths);
  const tickOnly = new Set(tickOnlyPaths);
  const entries = status.out.split('\0').filter(Boolean);
  const changed = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code.includes('R') || code.includes('C')) i++; // the original path follows a rename/copy
    if (path === registryPath || path === contextPath) continue;
    // docguard.completion-one-commit#FR-001: ticking a box in the completing
    // spec's own task list is part of closing it, so the tick, the record and
    // the outcome can land in one commit. Any other edit of that file is not.
    if (tickOnly.has(path) && !code.includes('D') && !code.includes('R')) {
      const committed = git(projectDir, ['show', `HEAD:${path}`]);
      let current = null;
      try { current = readFileSync(resolve(projectDir, path), 'utf8'); } catch { /* deleted or unreadable */ }
      if (committed.ok && current !== null && uncheckedTasks(committed.out) === uncheckedTasks(current)) continue;
    }
    if (specs.has(path) && !code.includes('D') && !code.includes('R')) {
      const committed = git(projectDir, ['show', `HEAD:${path}`]);
      let current = null;
      try { current = readFileSync(resolve(projectDir, path), 'utf8'); } catch { /* deleted or unreadable */ }
      if (committed.ok && current !== null
        && stripImplementationOutcomes(committed.out) === stripImplementationOutcomes(current)) continue;
    }
    changed.push(path);
  }
  return changed.sort();
}

/**
 * Whether HEAD is reachable from the remote default branch (origin/HEAD).
 * @returns {boolean|null} null when there is no remote default branch to ask
 */
export function reachableFromDefaultBranch(projectDir) {
  if (!git(projectDir, ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/HEAD']).ok) return null;
  return isAncestorOf(projectDir, 'HEAD', 'refs/remotes/origin/HEAD');
}

/** Evidence paths whose blob at `candidate` differs from the blob at `from`. */
export function evidenceDifferences(projectDir, from, candidate, evidence) {
  return evidence.filter(path => blobAt(projectDir, from, path) !== blobAt(projectDir, candidate, path));
}

/**
 * The oldest first-parent commit of HEAD after the merge base whose blobs for
 * every evidence path equal those at `from`. Bounded to HISTORY_LIMIT commits.
 * @returns {{ target: string|null, differing: string[] }}
 */
export function findAnchor(projectDir, from, evidence, { limit = HISTORY_LIMIT } = {}) {
  const base = git(projectDir, ['merge-base', from, 'HEAD']).out.trim();
  if (!base) return { target: null, differing: evidence };
  const listed = git(projectDir, ['rev-list', '--first-parent', `--max-count=${limit}`, `${base}..HEAD`]).out
    .split('\n').map(s => s.trim()).filter(Boolean).reverse();
  let differing = evidence;
  for (const candidate of listed) {
    differing = evidenceDifferences(projectDir, from, candidate, evidence);
    if (differing.length === 0) return { target: candidate, differing: [] };
  }
  return { target: null, differing };
}

/** The git blob id of each path in `paths` at `commit` (relative to the project), or null when the path is absent there. */
export function evidenceBlobsAt(projectDir, commit, paths) {
  const out = Object.fromEntries(paths.map(path => [path, null]));
  if (!paths.length) return out;
  const r = git(projectDir, ['ls-tree', '-z', commit, '--', ...paths.map(path => `:(literal)${path}`)]);
  if (!r.ok) return out;
  for (const record of r.out.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [, type, id] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (type === 'blob' && path in out) out[path] = id;
  }
  return out;
}

const ANCHOR_CACHE = `${STATE_DIR}/revision-anchors.json`;
const CACHE_LIMIT = 256 * 1024;

function readAnchorCache(projectDir) {
  // A cache can only arrive through the checkout in CI, so it is not read there.
  if (process.env.CI) return {};
  try {
    const path = resolve(projectDir, ANCHOR_CACHE);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > CACHE_LIMIT) return {};
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && value.version === 1 && value.entries && typeof value.entries === 'object' ? value.entries : {};
  } catch { return {}; }
}

function writeAnchorCache(projectDir, entries) {
  if (process.env.CI || !ensureStateDir(projectDir)) return;
  const path = resolve(projectDir, ANCHOR_CACHE);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ version: 1, entries })}\n`, { flag: 'wx' });
    renameSync(temporary, path);
  } catch {
    try { unlinkSync(temporary); } catch { /* best effort: a cache never changes a verdict */ }
  }
}

/**
 * Where a recorded revision's review landed on HEAD's history: the first
 * first-parent commit whose registry contains the revision (one `git log -S`
 * over the registry path), and the evidence files whose blobs there differ from
 * the ones reviewed (one `git ls-tree`). It needs no old commit, so it works
 * after a squash merge or a rebase has discarded the id.
 *
 * The cache holds only the landing commit. A hit is trusted no further than a
 * commit that is still an ancestor of HEAD, and the verdict is recomputed from
 * the blobs at that commit, so a stale or planted cache cannot change it.
 * @returns {{ commit: string|null, differing: string[] }} `commit` is null when no commit on
 *   this history introduced the revision into the registry
 * @implements docguard.completion-one-commit#FR-006
 * @implements docguard.completion-one-commit#FR-009
 */
export function locateContentAnchor(projectDir, { specId, revision, blobs, registryPath }) {
  const paths = Object.keys(blobs).sort();
  const key = `${specId}|${revision}|${createHash('sha256').update(JSON.stringify(blobs)).digest('hex').slice(0, 16)}`;
  const entries = readAnchorCache(projectDir);
  let commit = entries[key]?.commit;
  if (!(typeof commit === 'string' && REVISION_RE.test(commit) && isAncestorOf(projectDir, commit))) {
    const introduced = git(projectDir, ['log', '--first-parent', '--format=%H', `-S${revision}`, '--', registryPath]).out
      .split('\n').map(line => line.trim()).filter(Boolean);
    commit = introduced.length ? introduced[introduced.length - 1] : null;
    if (commit) writeAnchorCache(projectDir, { ...entries, [key]: { commit } });
  }
  if (!commit) return { commit: null, differing: paths };
  const found = evidenceBlobsAt(projectDir, commit, paths);
  return { commit, differing: paths.filter(path => found[path] !== blobs[path]) };
}

/**
 * Whether a recorded revision that is not an ancestor of HEAD is still anchored
 * by its content: its outcome carries the evidence blobs, and the commit that
 * landed the record has exactly those blobs.
 * @returns {{ hasBlobs: boolean, anchored: boolean, commit: string|null, differing: string[] }}
 * @implements docguard.completion-one-commit#FR-006
 */
export function contentAnchor(projectDir, spec, revision, { registryPath }) {
  let content = null;
  try { content = readFileSync(resolve(projectDir, spec.path), 'utf8'); } catch { /* no spec file */ }
  const blobs = content === null ? null : readOutcomeBlobs(content, revision);
  if (!blobs) return { hasBlobs: false, anchored: false, commit: null, differing: [] };
  const found = locateContentAnchor(projectDir, { specId: spec.specId, revision, blobs, registryPath });
  return { hasBlobs: true, anchored: found.commit !== null && found.differing.length === 0, commit: found.commit, differing: found.differing };
}
