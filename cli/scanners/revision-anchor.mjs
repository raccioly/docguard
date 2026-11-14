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
 * @implements docguard.completion-upkeep#FR-007
 * @implements docguard.completion-upkeep#FR-009
 * @implements docguard.completion-upkeep#FR-011
 * @implements docguard.completion-upkeep#FR-017
 */

import { randomUUID } from 'node:crypto';
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
  // Specs completed in one commit record the same revision, so ask git once per
  // distinct revision. Past a few revisions, two processes each is still the
  // cost (74 for 37 revisions here): one `cat-file --batch-check` says which
  // resolve to a commit and one `rev-list ^HEAD` names those that
  // `merge-base --is-ancestor <revision> HEAD` would refuse.
  const verdicts = new Map();
  const distinct = [...new Set((registry?.specs || []).flatMap(recordedRevisions))];
  if (distinct.length > 2) {
    const resolvable = distinct.filter(revision => REVISION_RE.test(revision));
    const peeled = new Map();
    const checked = resolvable.length === 0 ? null : runGit(projectDir, ['cat-file', '--batch-check'], {
      operation: 'git cat-file (revision anchor)', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024,
      input: `${resolvable.map(revision => `${revision}^{commit}`).join('\n')}\n`,
    });
    const lines = checked && checked.status === 0 && !checked.error ? checked.stdout.split('\n') : null;
    if (lines) {
      resolvable.forEach((revision, index) => {
        const [id, type] = (lines[index] || '').split(' ');
        if (type === 'commit' && REVISION_RE.test(id)) peeled.set(revision, id);
      });
    }
    // `rev-list ^HEAD <commits>` lists only commits reachable from those and not from HEAD, so a
    // revision is an ancestor of HEAD exactly when it is absent from the answer. Its size is the
    // history a squash merge discarded, not the repository's.
    const commits = [...new Set(peeled.values())];
    const off = !lines ? null : commits.length === 0 ? { status: 0, stdout: '' }
      : runGit(projectDir, ['rev-list', '^HEAD', ...commits], { operation: 'git rev-list (revision anchor)', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
    if (lines && off && off.status === 0 && !off.error) {
      const offHistory = new Set(off.stdout.split('\n').filter(Boolean));
      for (const revision of distinct) {
        const commit = peeled.get(revision);
        verdicts.set(revision, !commit ? 'missing' : offHistory.has(commit) ? 'not-ancestor' : null);
      }
    }
  }
  const verdict = revision => {
    if (!verdicts.has(revision)) {
      verdicts.set(revision, !revisionResolves(projectDir, revision) ? 'missing' : !isAncestorOf(projectDir, revision) ? 'not-ancestor' : null);
    }
    return verdicts.get(revision);
  };
  for (const spec of registry?.specs || []) {
    for (const revision of recordedRevisions(spec)) {
      const reason = verdict(revision);
      if (reason) out.push({ specId: spec.specId, revision, reason });
    }
  }
  return out;
}

/** A task list with every checkbox read as unchecked: equal for two lists that differ only by ticks. */
const uncheckedTasks = text => String(text).replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[[ xX]\]/gm, '$1[ ]');

const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MARK = '\u0000';

/**
 * Whether `current` differs from `committed` only by `@implements` or `@req`
 * tags for `specId`'s own requirements, and adds at least one. Each tag of that
 * spec is replaced by a marker in both texts; then a comment block that held
 * nothing but markers, and a line that held nothing but a marker and a comment
 * opener, are removed, and a marker that ended a code line is dropped with the
 * comment opener before it. Whatever is left must be identical, so a blank line,
 * a deleted `*\/`, an edited statement or any other change still differs.
 * @implements docguard.completion-upkeep#FR-007
 */
export function tagOnlyChange(committed, current, specId) {
  const tag = new RegExp(`@(?:implements|req)[ \\t]+(?:${escapeRe(specId)}#[A-Za-z0-9_.-]+[, \\t]*)+`, 'g');
  const count = text => (String(text).match(tag) || []).length;
  const normal = text => String(text).replace(tag, MARK)
    .replace(/\/\*+(?:[\s*]|\u0000)*\*\//g, block => (block.includes(MARK) ? MARK : block))
    .split('\n')
    .flatMap(line => {
      if (!line.includes(MARK)) return [line];
      const rest = line.split(MARK).join('');
      if (/^[ \t]*(?:\/\/+|#+|\*+)?[ \t]*$/.test(rest)) return []; // the line held only the tag
      return [rest.replace(/[ \t]*(?:\/\/+|#+)[ \t]*$/, '').replace(/[ \t]+$/, '')];
    })
    .join('\n');
  return count(current) > count(committed) && normal(committed) === normal(current);
}

/** A spec with its `**Status**:` header and its outcomes block neutralized: what completion itself writes. */
const withoutCompletionWrites = text => stripImplementationOutcomes(text).replace(/^\*\*Status\*\*:.*$/m, '**Status**:');

/**
 * Tracked changes other than the lifecycle files completion itself writes:
 * the registry, the active context, and spec files whose change is confined
 * to the implementation-outcomes block.
 * @returns {string[]|null} changed paths, or null when git cannot answer
 */
export function nonLifecycleChanges(projectDir, { registryPath, contextPath, specPaths = [], tickOnlyPaths = [], tagSpecId = null, evidencePaths = [] }) {
  // DocGuard's own .docguard/ state is never a change (docguard.read-only-commands#FR-006).
  const status = git(projectDir, ['status', '--porcelain=v1', '-z', '--untracked-files=no', ...OWN_STATE_PATHSPEC]);
  if (!status.ok) return null;
  const specs = new Set(specPaths);
  const tickOnly = new Set(tickOnlyPaths);
  const evidence = new Set(evidencePaths);
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
      // docguard.completion-upkeep#FR-011: the Status header is one of the lines completion writes.
      if (committed.ok && current !== null
        && withoutCompletionWrites(committed.out) === withoutCompletionWrites(current)) continue;
    }
    // docguard.completion-upkeep#FR-017: an uncommitted edit of an implementation or test file the completing
    // spec lists as evidence is what the completion reviews; it lands in the same commit as the record.
    if (evidence.has(path) && !code.includes('D') && !code.includes('R') && !code.includes('A')) continue;
    // docguard.completion-upkeep#FR-007: adding the completing spec's own requirement tags is part of
    // closing it, so tagging and closing can land in one commit. Any other edit of the file is not.
    if (tagSpecId && !specs.has(path) && !code.includes('D') && !code.includes('R') && !code.includes('A')) {
      const committed = git(projectDir, ['show', `HEAD:${path}`]);
      let current = null;
      try { current = readFileSync(resolve(projectDir, path), 'utf8'); } catch { /* deleted or unreadable */ }
      if (committed.ok && current !== null && tagOnlyChange(committed.out, current, tagSpecId)) continue;
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

/**
 * Like {@link evidenceBlobsAt}, but a file with an uncommitted change (only a tag
 * line, by the time this runs) gets the blob of its working-tree content, which is
 * what the commit that follows will hold.
 * @implements docguard.completion-upkeep#FR-007
 */
export function evidenceBlobsInTree(projectDir, commit, paths) {
  const out = evidenceBlobsAt(projectDir, commit, paths);
  for (const [path, id] of workingTreeBlobs(projectDir, paths)) out[path] = id;
  return out;
}

/** The paths among `paths` whose tracked content differs from HEAD (staged or not) and that still exist on disk. */
export function modifiedPaths(projectDir, paths) {
  if (!paths.length) return [];
  const wanted = new Set(paths);
  const dirty = git(projectDir, ['diff', '--name-only', '-z', 'HEAD', '--', ...paths.map(path => `:(literal)${path}`)]);
  return dirty.out.split('\0').filter(path => path && wanted.has(path) && existsOnDisk(projectDir, path));
}

/**
 * path -> blob id of the working-tree content, for each of `paths` that has an uncommitted change:
 * what the commit that follows will hold.
 * @implements docguard.completion-upkeep#FR-017
 */
export function workingTreeBlobs(projectDir, paths) {
  const changed = modifiedPaths(projectDir, paths);
  const out = new Map();
  if (!changed.length) return out;
  const r = runGit(projectDir, ['hash-object', '--stdin-paths'], {
    operation: 'git hash-object (completion blobs)', stdio: ['pipe', 'pipe', 'ignore'], input: `${changed.join('\n')}\n`,
  });
  const ids = r.status === 0 && !r.error ? r.stdout.split('\n') : [];
  changed.forEach((path, index) => { if (REVISION_RE.test(ids[index] || '')) out.set(path, ids[index]); });
  return out;
}

function existsOnDisk(projectDir, path) {
  try { return lstatSync(resolve(projectDir, path)).isFile(); } catch { return false; }
}

/**
 * The newest commit in `since..HEAD` that touched any of `paths` (at most 200 are
 * asked about), or null when there is none or it is HEAD itself. One bounded `git log`.
 * @implements docguard.completion-upkeep#FR-009
 */
export function lastCommitTouching(projectDir, since, paths) {
  if (!paths.length) return null;
  const r = git(projectDir, ['log', '-n1', '--format=%H', `${since}..HEAD`, '--', ...paths.slice(0, 200).map(path => `:(literal)${path}`)]);
  const sha = r.ok ? r.out.trim() : '';
  if (!REVISION_RE.test(sha)) return null;
  const head = git(projectDir, ['rev-parse', 'HEAD']).out.trim();
  return sha === head ? null : sha;
}

const ANCHOR_CACHE = `${STATE_DIR}/revision-anchors.json`;
const CACHE_LIMIT = 256 * 1024;
const LOG_BATCH = 200;
const HASH_RE = /[0-9a-f]{40}(?:[0-9a-f]{24})?/g;

function readAnchorCache(projectDir) {
  // A cache can only arrive through the checkout in CI, so it is not read there.
  if (process.env.CI) return {};
  try {
    const path = resolve(projectDir, ANCHOR_CACHE);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > CACHE_LIMIT) return {};
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return value && value.version === 1 && value.landings && typeof value.landings === 'object' ? value.landings : {};
  } catch { return {}; }
}

function writeAnchorCache(projectDir, landings) {
  if (process.env.CI || !ensureStateDir(projectDir)) return;
  const path = resolve(projectDir, ANCHOR_CACHE);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify({ version: 1, landings })}\n`, { flag: 'wx' });
    renameSync(temporary, path);
  } catch {
    try { unlinkSync(temporary); } catch { /* best effort: a cache never changes a verdict */ }
  }
}

/**
 * The first first-parent commit whose registry adds each of `revisions`, or
 * null. Constant git work however many revisions there are: one `rev-list` of
 * the commits that touched the registry (which also validates the cache, since
 * a landing commit touched it by definition), one `git log -G` over all the
 * revisions that were not cached, oldest first. `-G`, not `-S`: a maintenance
 * commit that moves one recorded revision to another leaves the occurrence
 * count unchanged, and `-S` would skip it.
 * @implements docguard.completion-one-commit#FR-009
 */
function landingCommits(projectDir, revisions, registryPath) {
  const landings = new Map(revisions.map(revision => [revision, null]));
  const chain = new Set(git(projectDir, ['rev-list', '--first-parent', 'HEAD', '--', registryPath]).out.split('\n').map(line => line.trim()).filter(Boolean));
  const cached = readAnchorCache(projectDir);
  const pending = [];
  for (const revision of landings.keys()) {
    if (typeof cached[revision] === 'string' && chain.has(cached[revision])) landings.set(revision, cached[revision]);
    else if (REVISION_RE.test(revision)) pending.push(revision);
  }
  for (let from = 0; from < pending.length; from += LOG_BATCH) {
    const batch = new Set(pending.slice(from, from + LOG_BATCH));
    const log = git(projectDir, ['log', '--first-parent', '--reverse', '-p', '-U0', '--no-color', '--format=%x01%H', `-G${[...batch].join('|')}`, '--', registryPath]);
    for (const chunk of log.out.split('\x01').slice(1)) {
      const [commit, ...lines] = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        for (const hash of line.match(HASH_RE) || []) {
          if (batch.has(hash) && landings.get(hash) === null) landings.set(hash, commit.trim());
        }
      }
    }
  }
  const found = Object.fromEntries([...landings].filter(([revision, commit]) => commit && pending.includes(revision)));
  if (Object.keys(found).length) writeAnchorCache(projectDir, { ...cached, ...found });
  return landings;
}

/**
 * Where each recorded revision's review landed on HEAD's history, and which
 * evidence files have a different blob there than the one reviewed. It needs
 * no old commit, so it works after a squash merge or a rebase has discarded
 * the id. The cache holds only landing commits and a hit is trusted no
 * further than "that commit is still on HEAD's first-parent chain": the
 * verdict is recomputed from the blobs, so a stale or planted cache cannot
 * change it. One `rev-list`, at most one `log` per 200 revisions, one
 * `cat-file --batch-check`, whatever the number of items.
 * @param {Array<{ key: string, revision: string, blobs: Record<string,string> }>} items
 * @returns {Map<string, { commit: string|null, differing: string[] }>} `commit` is null when no commit on
 *   this history introduced the revision into the registry
 * @implements docguard.completion-one-commit#FR-006
 * @implements docguard.completion-one-commit#FR-009
 */
export function locateContentAnchors(projectDir, items, { registryPath }) {
  const out = new Map();
  if (!items.length) return out;
  const landings = landingCommits(projectDir, [...new Set(items.map(item => item.revision))], registryPath);
  const lookups = [];
  for (const item of items) {
    const commit = landings.get(item.revision);
    if (!commit) { out.set(item.key, { commit: null, differing: Object.keys(item.blobs).sort() }); continue; }
    for (const path of Object.keys(item.blobs)) lookups.push({ key: item.key, commit, path });
  }
  const found = new Map();
  if (lookups.length) {
    const r = runGit(projectDir, ['cat-file', '--batch-check'], {
      operation: 'git cat-file (revision anchor)', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024,
      input: `${lookups.map(lookup => `${lookup.commit}:./${lookup.path}`).join('\n')}\n`,
    });
    const lines = r.status === 0 && !r.error ? r.stdout.split('\n') : [];
    lookups.forEach((lookup, index) => {
      const [id, type] = (lines[index] || '').split(' ');
      found.set(`${lookup.key}\0${lookup.path}`, type === 'blob' && REVISION_RE.test(id) ? id : null);
    });
  }
  for (const item of items) {
    if (out.has(item.key)) continue;
    const differing = Object.keys(item.blobs).sort().filter(path => found.get(`${item.key}\0${path}`) !== item.blobs[path]);
    out.set(item.key, { commit: landings.get(item.revision), differing });
  }
  return out;
}

/**
 * A commit anywhere in HEAD's ancestry (not only its first-parent chain) whose registry
 * change introduced `revision` and whose files are exactly the reviewed blobs. A branch
 * that merged main sees main's squash commit only through the merge's second parent, so
 * the first-parent search above finds the merge commit instead, whose files already
 * carry the branch's own later edits.
 * @returns {string|null}
 * @implements docguard.completion-upkeep#FR-015
 */
export function reviewedCommitOnHistory(projectDir, revision, blobs, { registryPath, limit = 20 }) {
  if (!REVISION_RE.test(revision || '')) return null;
  // `--max-count` applies before `--reverse`, so the oldest `limit` are taken here, after git has answered.
  const log = git(projectDir, ['log', '--reverse', '--format=%H', `-G${revision}`, 'HEAD', '--', registryPath]);
  const paths = Object.keys(blobs);
  for (const commit of log.out.split('\n').map(line => line.trim()).filter(line => REVISION_RE.test(line)).slice(0, limit)) {
    const at = evidenceBlobsAt(projectDir, commit, paths);
    if (paths.every(path => at[path] === blobs[path])) return commit;
  }
  return null;
}

function readSpecContent(projectDir, spec) {
  try { return readFileSync(resolve(projectDir, spec.path), 'utf8'); } catch { return null; }
}

/**
 * Whether each given recorded revision that is not an ancestor of HEAD is still
 * anchored by its content: its outcome carries the evidence blobs, and the commit
 * that landed the record has exactly those blobs.
 * @param {Array<{ spec: object, revision: string }>} entries
 * @returns {Map<string, { hasBlobs: boolean, anchored: boolean, commit: string|null, differing: string[] }>}
 *   keyed by `${specId}|${revision}`
 * @implements docguard.completion-one-commit#FR-006
 */
export function contentAnchors(projectDir, entries, { registryPath }) {
  const results = new Map();
  const items = [];
  const contents = new Map();
  for (const { spec, revision } of entries) {
    const key = `${spec.specId}|${revision}`;
    if (!contents.has(spec.specId)) contents.set(spec.specId, readSpecContent(projectDir, spec));
    const content = contents.get(spec.specId);
    const blobs = content === null ? null : readOutcomeBlobs(content, revision);
    if (!blobs) results.set(key, { hasBlobs: false, anchored: false, commit: null, differing: [] });
    else items.push({ key, revision, blobs });
  }
  for (const [key, found] of locateContentAnchors(projectDir, items, { registryPath })) {
    results.set(key, { hasBlobs: true, anchored: found.commit !== null && found.differing.length === 0, commit: found.commit, differing: found.differing });
  }
  return results;
}

/** {@link contentAnchors} for one revision. */
export function contentAnchor(projectDir, spec, revision, { registryPath }) {
  return contentAnchors(projectDir, [{ spec, revision }], { registryPath }).get(`${spec.specId}|${revision}`);
}

/**
 * The recorded revisions that are off HEAD's history and not anchored by their
 * content: what SPR008 reports and `reanchor` moves. An outcome that carries its
 * evidence blobs and was superseded by a later review of the same spec (a
 * second completion in the same pull request, after the evidence changed) does
 * not strand anything while that later review is on the history or anchored:
 * only the last reviewed revision is a diff base.
 * @returns {Array<{ specId: string, revision: string, reason: string, content: object }>}
 * @implements docguard.completion-one-commit#FR-006
 */
export function strandedRevisions(projectDir, registry, { registryPath }) {
  const dangling = danglingRevisions(projectDir, registry);
  const specs = new Map((registry?.specs || []).map(spec => [spec.specId, spec]));
  const anchors = contentAnchors(projectDir, dangling.map(({ specId, revision }) => ({ spec: specs.get(specId), revision })), { registryPath });
  const key = ({ specId, revision }) => `${specId}|${revision}`;
  const lastIsFine = specId => {
    const last = specs.get(specId)?.reviewed?.reconciliation?.lastReviewedRevision;
    const entry = dangling.find(item => item.specId === specId && item.revision === last);
    return !entry || anchors.get(key(entry)).anchored;
  };
  return dangling
    .map(item => ({ ...item, content: anchors.get(key(item)) }))
    .filter(item => {
      if (item.content.anchored) return false;
      const last = specs.get(item.specId)?.reviewed?.reconciliation?.lastReviewedRevision;
      return !(item.content.hasBlobs && item.revision !== last && lastIsFine(item.specId));
    });
}
