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
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripImplementationOutcomes } from '../writers/spec-outcomes.mjs';

const REVISION_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
export const HISTORY_LIMIT = 1000;

function git(projectDir, args) {
  try {
    return { ok: true, out: execFileSync('git', args, { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 }) };
  } catch {
    return { ok: false, out: '' };
  }
}

export function isShallowRepository(projectDir) {
  return git(projectDir, ['rev-parse', '--is-shallow-repository']).out.trim() === 'true';
}

export function revisionResolves(projectDir, revision) {
  return REVISION_RE.test(revision || '') && git(projectDir, ['cat-file', '-e', `${revision}^{commit}`]).ok;
}

export function isAncestorOf(projectDir, revision, of = 'HEAD') {
  return git(projectDir, ['merge-base', '--is-ancestor', revision, of]).ok;
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

/**
 * Tracked changes other than the lifecycle files completion itself writes:
 * the registry, the active context, and spec files whose change is confined
 * to the implementation-outcomes block.
 * @returns {string[]|null} changed paths, or null when git cannot answer
 */
export function nonLifecycleChanges(projectDir, { registryPath, contextPath, specPaths = [] }) {
  const status = git(projectDir, ['status', '--porcelain=v1', '-z', '--untracked-files=no']);
  if (!status.ok) return null;
  const specs = new Set(specPaths);
  const entries = status.out.split('\0').filter(Boolean);
  const changed = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    if (code.includes('R') || code.includes('C')) i++; // the original path follows a rename/copy
    if (path === registryPath || path === contextPath) continue;
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
