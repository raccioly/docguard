/**
 * Closed specs whose evidence changed after their last review.
 *
 * A completion records the git blob of every evidence file. SPR008 compares
 * those blobs with the commit that landed the record, which is why a squash
 * merge cannot strand one, and also why a later edit is not seen on a pull
 * request's merge ref: the landing commit there is main's squash commit, whose
 * blobs match. This module compares the record with the files as `HEAD` has
 * them now.
 *
 * Scope (specs/103-completion-upkeep): the spec's canonical documents are not
 * compared (a document is shared by many specs; Freshness and requirement
 * anchors cover it), and an outcome without blobs is not judged. Only `HEAD`'s
 * tree is read, with one `cat-file --batch-check` for every spec, so it works
 * in a shallow clone.
 *
 * @implements docguard.completion-upkeep#FR-001
 * @implements docguard.completion-upkeep#FR-002
 * @implements docguard.completion-upkeep#FR-003
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readOutcomeBlobs } from '../writers/spec-outcomes.mjs';
import { runGit } from '../shared-git.mjs';

const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
export const STALE_COMMAND = 'docguard specs complete --stale --reason "<what changed and what you reviewed>" --write';

/** The blob id at `HEAD` of each path, null when the path is not in HEAD's tree; null overall when git cannot answer. */
function blobsAtHead(projectDir, paths) {
  const out = new Map(paths.map(path => [path, null]));
  if (!paths.length) return out;
  const r = runGit(projectDir, ['cat-file', '--batch-check'], {
    operation: 'git cat-file (stale completions)', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024,
    input: `${paths.map(path => `HEAD:./${path}`).join('\n')}\n`,
  });
  if (r.status !== 0 || r.error) return null;
  const lines = r.stdout.split('\n');
  paths.forEach((path, index) => {
    const [id, type] = (lines[index] || '').split(' ');
    out.set(path, type === 'blob' && OBJECT_ID.test(id) ? id : null);
  });
  return out;
}

/**
 * @param {string} projectDir
 * @param {{ specs: object[] }} registry
 * @returns {Array<{ specId: string, path: string, revision: string, files: string[], removed: string[] }>}
 *   one entry per spec with a changed implementation or test evidence file
 */
export function staleCompletions(projectDir, registry) {
  const judged = [];
  for (const spec of registry?.specs || []) {
    if (spec.reviewed?.lifecycle?.context !== 'current') continue;
    if (!['verified', 'released'].includes(spec.reviewed?.lifecycle?.delivery)) continue;
    const latest = (spec.reviewed?.reconciliation?.outcomes || []).at(-1);
    if (!latest) continue;
    let content;
    try { content = readFileSync(resolve(projectDir, spec.path), 'utf8'); } catch { continue; }
    const blobs = readOutcomeBlobs(content, latest.revision);
    if (!blobs) continue;
    const canonical = new Set(spec.reviewed?.scope?.canonicalDocs || []);
    const compared = Object.entries(blobs).filter(([path]) => !canonical.has(path));
    if (compared.length) judged.push({ spec, revision: latest.revision, compared });
  }
  if (!judged.length) return [];
  const now = blobsAtHead(projectDir, [...new Set(judged.flatMap(item => item.compared.map(([path]) => path)))]);
  if (!now) return [];
  const stale = [];
  for (const { spec, revision, compared } of judged) {
    const changed = compared.filter(([path, id]) => now.get(path) !== id).map(([path]) => path).sort();
    if (!changed.length) continue;
    stale.push({ specId: spec.specId, path: spec.path, revision, files: changed, removed: changed.filter(path => now.get(path) === null) });
  }
  return stale;
}

/** `a, b, c, d, e and N more`: the files a message names. */
export function describeFiles(files, removed = [], limit = 5) {
  const shown = files.slice(0, limit).map(file => (removed.includes(file) ? `${file} (removed)` : file));
  return `${shown.join(', ')}${files.length > limit ? `, and ${files.length - limit} more` : ''}`;
}
