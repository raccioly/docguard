/**
 * Mirrors: copies of one thing for different agent harnesses (specs/100-file-kinds,
 * Stage 3, FR-014 and FR-015).
 *
 * Two kinds of files are mirrors, and only these two:
 *
 *   instruction  the root instruction files `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and
 *                `.github/copilot-instructions.md`; the same set in one nested folder is
 *                compared only within that folder;
 *   skill        a skill or command file at the same relative path under different agent
 *                roots (`.agent/`, `.agents/`, `.claude/`, `.codex/`, `.gemini/`, `.github/`
 *                and an installed extension folder `.specify/extensions/<ext>/`).
 *
 * The same basename alone is never a mirror: `docs/X.md` and `docs/runbooks/X.md`, or
 * `docs-canonical/X.md` and `docs-implementation/X.md`, are different documents.
 *
 * Identical mirrors (same bytes, therefore the same git blob) are one subject: a
 * finding raised on each copy is raised once, on the first path in a fixed order, and
 * names every path (`collapseMirrorFindings`). Mirrors that differ are drift: a skill
 * pair always, a pair of root instruction files only when they share most of their
 * lines (`mirrorDrift`). A pointer file, a symlink and a file `docguard agents --sync`
 * generated are never mirrors of what they point at or were generated from.
 *
 * @implements docguard.file-kinds#FR-014
 * @implements docguard.file-kinds#FR-015
 */

import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { listTrackedFiles, runGit } from './shared-git.mjs';
import { buildIgnoreFilter, loadDocguardIgnore, relPosix, walkFiles } from './shared-ignore.mjs';
import { agentInstructionDocs, instructionLeftOut, ROOT_AGENT_FILES } from './shared-agent-instructions.mjs';
import { fileKind } from './shared-file-kind.mjs';

/** Drift findings name both sides in their message; their `mirrors` lists the copies involved, so no "also in" line is added for them. */
export const MIRROR_DRIFT_CODES = new Set(['PSR007', 'PSR008']);

/** Instruction files in the order a mirror group reports them: the first is the one a finding is raised on. */
export const MIRROR_INSTRUCTION_ORDER = Object.freeze(ROOT_AGENT_FILES.filter(name => name !== 'AGENTS.override.md'));

/**
 * Share of non-blank lines two instruction files must have in common (against the longer of the
 * two) to be called near-identical. Chosen from the measurement recorded in spec 100, "Stage 3 decisions".
 */
export const NEAR_IDENTICAL_RATIO = 0.8;
/** An instruction file with fewer non-blank lines than this is too short for a similarity to mean anything. */
export const MIN_SIMILARITY_LINES = 5;

const SKILL_FILE_RE = /^((?:[^/.][^/]*\/)*)(\.agent|\.agents|\.claude|\.codex|\.gemini|\.github|\.specify\/extensions\/[^/]+)\/((?:skills\/[^/]+\/|commands\/).+)$/;
const MIRROR_DOT_FOLDERS = new Set(['.agent', '.agents', '.claude', '.codex', '.gemini', '.github', '.specify']);
const MAX_MIRROR_BYTES = 256 * 1024;
const MAX_MIRROR_FILES = 5000;
const GENERATED_MARKER = 'docguard:agents-sync';

const instructionRank = path => {
  const i = MIRROR_INSTRUCTION_ORDER.findIndex(n => path === n || path.endsWith(`/${n}`));
  return i === -1 ? MIRROR_INSTRUCTION_ORDER.length : i;
};

/** The order mirrors are reported in: instruction files by the fixed order, skill files lexically. */
export function mirrorOrder(kind) {
  return kind === 'instruction'
    ? (a, b) => instructionRank(a) - instructionRank(b) || (a < b ? -1 : a > b ? 1 : 0)
    : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
}

const hashOf = text => createHash('sha256').update(text).digest('hex');

function readRegular(projectDir, path) {
  try {
    const abs = resolve(projectDir, path);
    const st = lstatSync(abs);
    if (!st.isFile() || st.size > MAX_MIRROR_BYTES) return null;
    const buf = readFileSync(abs);
    if (buf.includes(0)) return null;
    return buf.toString('utf-8');
  } catch { return null; }
}

/**
 * A generator's header names the harness it was written for (`re-run \`tool install claude\` to refresh`), so
 * two renderings of one generated file differ in that line by design. Drift compares them without it, so a
 * different generator version still shows.
 */
const GENERATED_HEADER = /<!--\s*((?:auto-)?generated\s+by\s+\S+(?:\s+v?\d[\w.+-]*)?)[^>]*-->/i;
const normalizeForDrift = text => String(text).split('\n').map(l => { const m = GENERATED_HEADER.exec(l); return m ? `<!-- ${m[1]} -->` : l; }).join('\n');

/**
 * Spec Kit renders each skill for the harness that loads it (frontmatter keys, `$skill` or `/skill`), so two
 * integrations' copies differ by design. Two integration installs of different versions are a stale install,
 * which is drift: only same-version (or unrecorded-version) pairs are renderings.
 */
const isSpecKitInstall = m => /^spec-kit/.test(m.vendored?.source || '');
const differentInstallVersions = (a, b) => /^spec-kit:/.test(a.vendored?.source || '') && /^spec-kit:/.test(b.vendored?.source || '')
  && a.vendored.version && b.vendored.version && a.vendored.version !== b.vendored.version;

/** Non-blank lines of a document, trimmed. */
const contentLines = text => String(text).split('\n').map(l => l.trim()).filter(Boolean);

function multisetOverlap(x, y) {
  const counts = new Map();
  for (const l of x) counts.set(l, (counts.get(l) || 0) + 1);
  let n = 0;
  for (const l of y) { const c = counts.get(l) || 0; if (c > 0) { counts.set(l, c - 1); n++; } }
  return n;
}

/**
 * Lines that differ between two texts: the longer side's lines outside their longest common
 * subsequence (a replaced line counts once). Past 4 million cells it counts by multiset.
 */
export function differingLines(a, b) {
  const x = String(a).split('\n');
  const y = String(b).split('\n');
  while (x.length && y.length && x[x.length - 1] === '' && y[y.length - 1] === '') { x.pop(); y.pop(); }
  let common;
  if (x.length * y.length <= 4_000_000) {
    let prev = new Array(y.length + 1).fill(0);
    for (let i = 1; i <= x.length; i++) {
      const cur = new Array(y.length + 1).fill(0);
      for (let j = 1; j <= y.length; j++) cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
      prev = cur;
    }
    common = prev[y.length];
  } else common = multisetOverlap(x, y);
  return Math.max(x.length, y.length) - common;
}

/** Share of non-blank lines two instruction files have in common, against the longer one (0 to 1). */
export function lineSimilarity(a, b) {
  const x = contentLines(a);
  const y = contentLines(b);
  const longest = Math.max(x.length, y.length);
  return longest === 0 ? 1 : multisetOverlap(x, y) / longest;
}

const memo = new WeakMap();

/**
 * Every mirror group of the project: two or more files that are mirrors by the rules above, identical or not.
 *
 * @returns {{ groups: { kind: 'instruction'|'skill', key: string, members: { path, hash, content, pointer, generated, vendored }[],
 *   clusters: string[][] }[], limitations: string[] }}
 *   `members` and every cluster follow `mirrorOrder`; a cluster lists the paths with the same bytes.
 */
export function mirrorGroups(projectDir, config = {}) {
  const key = config && typeof config === 'object' ? config : {};
  const byDir = memo.get(key) || new Map();
  const abs = resolve(projectDir);
  if (byDir.has(abs)) return byDir.get(abs);
  const result = computeGroups(abs, key);
  byDir.set(abs, result);
  memo.set(key, byDir);
  return result;
}

function computeGroups(projectDir, config) {
  const limitations = [];
  const ignored = buildIgnoreFilter([...(config.ignore || []), ...loadDocguardIgnore(projectDir)]);
  let files = listTrackedFiles(projectDir);
  if (files === null) {
    limitations.push('git unavailable: looked for mirrors in the working tree instead of tracked files');
    files = [];
    // The walk skips dot folders; the agent roots and `.specify` are exactly where mirrors live.
    walkFiles(projectDir, full => { files.push(relPosix(projectDir, full)); }, { keepDot: entry => MIRROR_DOT_FOLDERS.has(entry) });
  }
  files = files.filter(f => !ignored(f));

  const role = agentInstructionDocs(projectDir, config);
  const roleDocs = new Map(role.docs.map(d => [d.path, d]));
  const buckets = new Map();
  const add = (kind, bucketKey, path) => {
    const content = readRegular(projectDir, path);
    if (content === null) return;
    const doc = roleDocs.get(path);
    const id = `${kind}\0${bucketKey}`;
    const bucket = buckets.get(id) || { kind, key: bucketKey, members: [] };
    bucket.members.push({
      path, hash: hashOf(content), content,
      pointer: doc?.pointer || null,
      generated: content.includes(GENERATED_MARKER),
      vendored: doc?.vendored || (/(^|\/)\.specify\/extensions\//.test(path) ? { source: 'spec-kit-extension', reason: 'extension folder' } : null),
    });
    buckets.set(id, bucket);
  };

  let considered = 0;
  for (const path of files) {
    const name = basename(path);
    const instruction = MIRROR_INSTRUCTION_ORDER.some(n => (n.includes('/') ? path === n : name === n));
    const skill = instruction ? null : SKILL_FILE_RE.exec(path);
    if (!instruction && !skill) continue;
    if (++considered > MAX_MIRROR_FILES) { limitations.push(`mirror grouping stopped after ${MAX_MIRROR_FILES} candidate files`); break; }
    if (instruction) {
      // A nested copy that the role leaves out (a template, a fixture) is not this project's instruction file.
      if (path.includes('/') && path !== '.github/copilot-instructions.md' && instructionLeftOut(path, config)) continue;
      add('instruction', path.startsWith('.github/') || !path.includes('/') ? '' : path.slice(0, path.lastIndexOf('/')), path);
    } else if (fileKind(path, config).kind === 'own') {
      add('skill', `${skill[1]}${skill[3]}`, path);
    }
  }

  const groups = [];
  for (const bucket of [...buckets.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key))) {
    if (bucket.members.length < 2) continue;
    bucket.members.sort((a, b) => mirrorOrder(bucket.kind)(a.path, b.path));
    const byHash = new Map();
    for (const mem of bucket.members) byHash.set(mem.hash, [...(byHash.get(mem.hash) || []), mem.path]);
    groups.push({ kind: bucket.kind, key: bucket.key, members: bucket.members, clusters: [...byHash.values()] });
  }
  return { groups, limitations };
}

/** Clusters of identical mirrors (two or more paths with the same bytes), each in report order. */
export function identicalClusters(projectDir, config = {}) {
  return mirrorGroups(projectDir, config).groups
    .flatMap(g => g.clusters.filter(c => c.length > 1).map(paths => ({ kind: g.kind, key: g.key, paths })));
}

// ── Collapsing findings ─────────────────────────────────────────────────────────

const fileOfLocation = location => (typeof location === 'string' ? location.replace(/:\d+$/, '') : null);
const lineOfLocation = location => (typeof location === 'string' ? (/:(\d+)$/.exec(location) || [])[1] || '' : '');

/** A finding's identity across copies: its message with each mirror's path replaced, plus code, line and suggestion. */
function shapeOf(finding, paths) {
  let text = finding.message || '';
  for (const p of [...paths].sort((a, b) => b.length - a.length)) text = text.split(p).join('<file>');
  return `${finding.code}\0${lineOfLocation(finding.location)}\0${text}\0${finding.suggestion?.text || ''}`;
}

/**
 * Collapse findings a validator raised on identical mirrors into one (FR-014). Two findings are the same
 * when they have the same code, line, suggestion and message once each mirror's path is replaced. The one
 * kept is on the first path in report order and gains `mirrors`, every path that had it. Findings that
 * still differ (a different count, a pointer that resolves elsewhere) are different findings: all kept.
 *
 * @param {object[]} findings
 * @param {{ kind: string, paths: string[] }[]} clusters from `identicalClusters`
 * @returns {{ findings: object[], removed: number }}
 */
export function collapseMirrorFindings(findings, clusters) {
  if (!clusters.length || findings.length < 2) return { findings, removed: 0 };
  const clusterOf = new Map();
  for (const c of clusters) for (const p of c.paths) clusterOf.set(p, c);
  const sets = new Map();
  const occurrence = new Map();
  findings.forEach((f, index) => {
    const file = fileOfLocation(f.location);
    const cluster = file && clusterOf.get(file);
    if (!cluster) return;
    const shape = shapeOf(f, cluster.paths);
    // The n-th identical finding in one file pairs with the n-th in another, never with its own neighbor.
    const nth = occurrence.get(`${file}\0${shape}`) || 0;
    occurrence.set(`${file}\0${shape}`, nth + 1);
    const key = `${cluster.paths[0]}\0${nth}\0${shape}`;
    const set = sets.get(key) || { cluster, items: [] };
    set.items.push({ index, file });
    sets.set(key, set);
  });
  const dropped = new Set();
  const replaced = new Map();
  for (const { cluster, items } of sets.values()) {
    if (items.length < 2) continue;
    const order = mirrorOrder(cluster.kind);
    const sorted = [...items].sort((x, y) => order(x.file, y.file));
    replaced.set(sorted[0].index, { ...findings[sorted[0].index], mirrors: sorted.map(s => s.file) });
    for (const s of sorted.slice(1)) dropped.add(s.index);
  }
  const kept = findings.flatMap((f, index) => (dropped.has(index) ? [] : [replaced.get(index) || f]));
  return { findings: kept, removed: dropped.size };
}

// ── Drift ───────────────────────────────────────────────────────────────────────

/** Commit time (seconds) of the last commit touching each path, from one batched `git log`; absent when unknown. */
export function lastCommitTimes(projectDir, paths) {
  const times = new Map();
  if (!paths.length) return times;
  const wanted = new Set(paths);
  const r = runGit(projectDir, ['log', '--format=%x00%ct', '--name-only', '-z', '--', ...paths], {
    operation: 'git log (mirror recency)', answers: [0], maxBuffer: 64 * 1024 * 1024, scope: { count: paths.length },
  });
  if (r.error || r.status !== 0) return times;
  let current = null;
  for (const token of r.stdout.split('\0')) {
    const text = token.trim();
    if (!text) continue;
    if (/^\d{9,11}$/.test(text)) { current = Number(text); continue; }
    if (current !== null && wanted.has(text) && !times.has(text)) times.set(text, current);
  }
  return times;
}

/** `YYYY-MM-DD` of a commit time in seconds. */
export const mirrorDate = seconds => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * Which of two paths was committed to more recently, or null when git cannot say (no history, a shallow
 * clone, an uncommitted file) or both were last committed at the same second.
 */
function newerOf(a, b, times) {
  const [ta, tb] = [times.get(a), times.get(b)];
  if (ta === undefined || tb === undefined || ta === tb) return null;
  return ta > tb ? { path: a, at: ta, other: b, otherAt: tb } : { path: b, at: tb, other: a, otherAt: ta };
}

/**
 * Mirrors that differ (FR-015).
 *
 *  - `skills`: a skill or command file at the same relative path under different agent roots with
 *    different bytes. One entry per content that differs from the first content of its group. `vendored` maps each
 *    path an installer wrote to what the install record says about it.
 *  - `instructions`: two root (or nested-folder) instruction files that share at least `threshold` of
 *    their non-blank lines and are not identical, where neither is a pointer and neither carries
 *    `docguard agents --sync`'s marker (`agents --check` already compares those).
 *  - `renderings`: skill pairs that differ by design and are not drift: two Spec Kit installs for different
 *    harnesses, and copies of one generated file that differ only in the harness its header names.
 *  - `similar`: every pair of instruction files that passes the pointer and marker rules, with its ratio:
 *    the measurement behind the threshold.
 *
 * @returns {{ skills: object[], instructions: object[], similar: object[], groups: number, identical: number, limitations: string[] }}
 */
export function mirrorDrift(projectDir, config = {}, { threshold = NEAR_IDENTICAL_RATIO } = {}) {
  const { groups, limitations } = mirrorGroups(projectDir, config);
  const skills = [];
  const instructions = [];
  const similar = [];
  let identical = 0;
  const pending = [];
  for (const group of groups) {
    identical += group.clusters.filter(c => c.length > 1).length;
    const byPath = new Map(group.members.map(m => [m.path, m]));
    const leaders = group.clusters.map(paths => byPath.get(paths[0]));
    if (leaders.length < 2) continue;
    if (group.kind === 'skill') {
      for (const other of leaders.slice(1)) pending.push({ group, a: leaders[0], b: other });
      continue;
    }
    for (let i = 0; i < leaders.length; i++) {
      for (let j = i + 1; j < leaders.length; j++) {
        const [a, b] = [leaders[i], leaders[j]];
        if (a.pointer || b.pointer || a.generated || b.generated) continue;
        if (contentLines(a.content).length < MIN_SIMILARITY_LINES || contentLines(b.content).length < MIN_SIMILARITY_LINES) continue;
        pending.push({ group, a, b });
      }
    }
  }
  const renderings = [];
  const drifting = pending.filter(({ group, a, b }) => {
    if (group.kind === 'skill' && isSpecKitInstall(a) && isSpecKitInstall(b) && !differentInstallVersions(a, b)) { renderings.push([a.path, b.path]); return false; }
    if (group.kind === 'skill' && normalizeForDrift(a.content) === normalizeForDrift(b.content)) { renderings.push([a.path, b.path]); return false; }
    return true;
  });
  const times = lastCommitTimes(projectDir, [...new Set(drifting.flatMap(p => [p.a.path, p.b.path]))]);
  for (const { group, a, b } of drifting) {
    const clusterOf = m => group.clusters.find(c => c[0] === m.path);
    const mirrors = [...new Set([...clusterOf(a), ...clusterOf(b)])].sort(mirrorOrder(group.kind));
    const entry = {
      kind: group.kind, key: group.key, paths: [a.path, b.path], mirrors,
      lines: differingLines(normalizeForDrift(a.content), normalizeForDrift(b.content)), newer: newerOf(a.path, b.path, times),
      vendored: Object.fromEntries([a, b].filter(m => m.vendored).map(m => [m.path, m.vendored])),
    };
    if (group.kind === 'skill') { skills.push(entry); continue; }
    const ratio = lineSimilarity(a.content, b.content);
    similar.push({ paths: entry.paths, ratio, lines: entry.lines });
    if (ratio >= threshold) instructions.push({ ...entry, ratio });
  }
  return { skills, instructions, similar, renderings, groups: groups.length, identical, limitations };
}
