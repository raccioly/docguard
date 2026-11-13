#!/usr/bin/env node
/**
 * History-replay benchmark for FRS006 and FRS007 (specs/095-recorded-document-reviews FR-012).
 *
 * For every review point in a repository's history (a commit that set a
 * document's `docguard:last-reviewed` marker), evaluate the per-reference
 * measure at review + 2, 4 and 8 weeks, as guard would have then, and label
 * each hit by what the project did next:
 *
 *   FRS006 hit (doc, file):  TRUE when, within LABEL_WINDOW_DAYS after the
 *     evaluation point, the document rewrote a line that names the file
 *     (a removed or changed line containing the path); FALSE when the window
 *     was fully observed and it did not; UNLABELED when the window runs past
 *     the repository's head.
 *   FRS007 hit (doc, name):  TRUE when the document later added a mention.
 *
 * This is a proxy label: a project can fix a stale line late, or rewrite a
 * line for another reason. `--labels <file>` overrides individual keys with a
 * human judgment. Precision is reported per role (agent-instruction, where
 * FRS006 is emitted, and canonical, where it is only evidence), per horizon
 * and per threshold, with a Wilson 95% interval.
 *
 * Usage: node benchmarks/history-replay/run.mjs --repo <path> [--repo <path> …]
 *          [--name <label> …] [--until <revision>] [--labels <file>] [--out <file>]
 * The repositories are only read: each evaluation point is a detached
 * worktree under the system temp directory, removed afterwards.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { agentInstructionDocs } from '../../cli/shared-agent-instructions.mjs';
import { documentReferences } from '../../cli/scanners/doc-reviews.mjs';
import { measureReferences, commitTime, surfaceAt, surfaceNow, mentionsScript, mentionsDir } from '../../cli/scanners/reference-staleness.mjs';
import { listCanonicalDocs } from '../../cli/shared-ignore.mjs';
import { wilsonInterval } from '../lib/metrics.mjs';

export const HORIZON_DAYS = [14, 28, 56];
export const THRESHOLDS = [0.25, 0.5, 0.75];
export const LABEL_WINDOW_DAYS = 56;
const MARKER_RE = /<!--\s*docguard:last-reviewed\s+(\d{4}-\d{2}-\d{2})\s*-->/;
const DAY = 86400;

// A replay reads history through throwaway worktrees; a hook from the user's git configuration (a post-checkout
// that fails, say) must neither run nor stop it.
const NO_HOOKS = ['-c', `core.hooksPath=${devNull}`];
const git = (cwd, args, opts = {}) => execFileSync('git', [...NO_HOOKS, ...args], { cwd, encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'], ...opts });
const tryGit = (cwd, args) => { const r = spawnSync('git', [...NO_HOOKS, ...args], { cwd, encoding: 'utf8', maxBuffer: 256 << 20 }); return r.status === 0 ? r.stdout : null; };

/** First-parent commits of `until`, oldest first: [{ sha, time }]. */
function firstParent(repo, until) {
  return git(repo, ['log', '--first-parent', '--format=%H %ct', until]).trim().split('\n').filter(Boolean)
    .map(l => { const [sha, t] = l.split(' '); return { sha, time: Number(t) }; }).reverse();
}

function markerAt(repo, sha, doc) {
  const text = tryGit(repo, ['show', `${sha}:${doc}`]);
  return text ? (text.match(MARKER_RE)?.[1] || null) : null;
}

/** Review points of `doc`: first-parent commits where its marker value changed. */
function reviewPoints(repo, chain, doc) {
  const touching = new Set(git(repo, ['log', '--first-parent', '--format=%H', chain[chain.length - 1].sha, '--', doc]).trim().split('\n').filter(Boolean));
  const points = [];
  let last = null;
  for (const c of chain) {
    if (!touching.has(c.sha)) continue;
    const m = markerAt(repo, c.sha, doc);
    if (m && m !== last) points.push({ sha: c.sha, time: c.time, marker: m });
    last = m;
  }
  return points;
}

/** The last first-parent commit at or before `time`. */
function commitAt(chain, time) {
  let best = null;
  for (const c of chain) { if (c.time <= time) best = c; else break; }
  return best;
}

/** Lines of `doc` removed or changed between two commits. */
function rewrittenLines(repo, from, to, doc) {
  const diff = tryGit(repo, ['diff', '--unified=0', from, to, '--', doc]) || '';
  return diff.split('\n').filter(l => /^-/.test(l) && !/^---/.test(l)).map(l => l.slice(1));
}
function addedLines(repo, from, to, doc) {
  const diff = tryGit(repo, ['diff', '--unified=0', from, to, '--', doc]) || '';
  return diff.split('\n').filter(l => /^\+/.test(l) && !/^\+\+\+/.test(l)).map(l => l.slice(1)).join('\n');
}

/**
 * A label override: `true`/`false` (confirmed, the original form) or
 * `{ label, confirmed, by }`. An unconfirmed override is reported apart and
 * never counted in precision (spec 095 FR-012).
 */
export function readOverride(labels, key) {
  if (!Object.hasOwn(labels, key)) return null;
  const v = labels[key];
  if (typeof v === 'boolean') return { label: v, source: 'override' };
  if (v && typeof v === 'object' && typeof v.label === 'boolean') return { label: v.label, source: v.confirmed === false ? 'override-unconfirmed' : 'override', ...(typeof v.by === 'string' ? { by: v.by } : {}) };
  throw new Error(`label ${key} must be true, false or { label, confirmed, by }`);
}

export function replayRepository(repo, { name = repo, until = 'HEAD', labels = {} } = {}) {
  const chain = firstParent(repo, until);
  const head = chain[chain.length - 1];
  const worktrees = new Map();
  const root = mkdtempSync(join(tmpdir(), 'docguard-replay-'));
  const worktreeAt = sha => {
    if (!worktrees.has(sha)) {
      const dir = join(root, sha.slice(0, 12));
      git(repo, ['worktree', 'add', '--detach', '-q', dir, sha]);
      worktrees.set(sha, dir);
    }
    return worktrees.get(sha);
  };
  const hits = [];
  let points = 0;
  try {
    const headDir = worktreeAt(head.sha);
    const role = new Set(agentInstructionDocs(headDir, {}).docs.filter(d => !d.pointer && !d.vendored).map(d => d.path));
    const canonical = listCanonicalDocs(headDir).map(d => d.rel).filter(p => !role.has(p));
    const docs = [...[...role].map(p => ({ path: p, role: 'agent-instruction' })), ...canonical.map(p => ({ path: p, role: 'canonical' }))];
    for (const { path: doc, role: docRole } of docs) {
      for (const point of reviewPoints(repo, chain, doc)) {
        const reviewCommit = commitAt(chain, Date.parse(`${point.marker}T23:59:59Z`) / 1000);
        if (!reviewCommit) continue;
        points++;
        for (const days of HORIZON_DAYS) {
          const evalCommit = commitAt(chain, reviewCommit.time + days * DAY);
          if (!evalCommit || evalCommit.sha === reviewCommit.sha) continue;
          if (markerAt(repo, evalCommit.sha, doc) !== point.marker) continue; // re-reviewed or gone by then
          const dir = worktreeAt(evalCommit.sha);
          const tracked = git(dir, ['ls-files']).trim().split('\n');
          let content;
          try { content = readFileSync(join(dir, doc), 'utf8'); } catch { continue; }
          const { references } = documentReferences(dir, doc, content, { tracked });
          const { references: measured } = measureReferences(dir, doc, references, { revision: reviewCommit.sha, time: commitTime(dir, reviewCommit.sha) }, { threshold: Math.min(...THRESHOLDS) });
          const windowEnd = commitAt(chain, evalCommit.time + LABEL_WINDOW_DAYS * DAY);
          const censored = evalCommit.time + LABEL_WINDOW_DAYS * DAY > head.time;
          const rewritten = windowEnd ? rewrittenLines(repo, evalCommit.sha, windowEnd.sha, doc) : [];
          for (const r of measured.filter(x => x.share >= Math.min(...THRESHOLDS))) {
            const key = `${name}|${doc}|${point.marker}|+${days}d|FRS006|${r.path}`;
            const proxy = censored ? null : rewritten.some(l => l.includes(r.path));
            const o = readOverride(labels, key);
            hits.push({ key, repo: name, doc, role: docRole, review: point.marker, horizonDays: days, code: 'FRS006', subject: r.path, line: r.line, share: Number(r.share.toFixed(4)), label: o ? o.label : proxy, labelSource: o ? o.source : 'proxy', ...(o?.by ? { labeledBy: o.by } : {}) });
          }
          if (docRole === 'agent-instruction') {
            const then = surfaceAt(dir, reviewCommit.sha);
            const now = surfaceNow(dir, tracked);
            const later = windowEnd ? addedLines(repo, evalCommit.sha, windowEnd.sha, doc) : '';
            const missing = [
              ...[...now.scripts].filter(s => !then.scripts.has(s) && !mentionsScript(content, s)).map(s => ({ s, mentioned: mentionsScript(later, s) })),
              ...[...now.dirs].filter(d => !then.dirs.has(d) && !mentionsDir(content, d)).map(d => ({ s: `${d}/`, mentioned: mentionsDir(later, d) })),
            ];
            for (const m of missing) {
              const key = `${name}|${doc}|${point.marker}|+${days}d|FRS007|${m.s}`;
              const o = readOverride(labels, key);
              hits.push({ key, repo: name, doc, role: docRole, review: point.marker, horizonDays: days, code: 'FRS007', subject: m.s, share: null, label: o ? o.label : censored ? null : m.mentioned, labelSource: o ? o.source : 'proxy', ...(o?.by ? { labeledBy: o.by } : {}) });
            }
          }
        }
      }
    }
  } finally {
    for (const dir of worktrees.values()) tryGit(repo, ['worktree', 'remove', '--force', dir]);
    rmSync(root, { recursive: true, force: true });
    tryGit(repo, ['worktree', 'prune']);
  }
  return { repo: name, head: head.sha, reviewPoints: points, hits };
}

/** Precision tables: per code, role, horizon and threshold. */
export function summarize(hits) {
  const rows = [];
  const groups = new Map();
  for (const h of hits) {
    const thresholds = h.code === 'FRS006' ? THRESHOLDS.filter(t => h.share >= t) : [null];
    for (const t of thresholds) {
      const k = `${h.code}|${h.role}|${h.horizonDays}|${t}`;
      if (!groups.has(k)) groups.set(k, { code: h.code, role: h.role, horizonDays: h.horizonDays, threshold: t, n: 0, tp: 0, fp: 0, unlabeled: 0, unconfirmed: { n: 0, tp: 0 } });
      const g = groups.get(k);
      if (h.label === null || h.label === undefined) g.unlabeled++;
      else if (h.labelSource === 'override-unconfirmed') { g.unconfirmed.n++; if (h.label) g.unconfirmed.tp++; }
      else { g.n++; if (h.label) g.tp++; else g.fp++; }
    }
  }
  for (const g of groups.values()) {
    const ci = g.n ? wilsonInterval(g.tp, g.n) : null;
    rows.push({ ...g, precision: g.n ? Number((g.tp / g.n).toFixed(4)) : null, confidence95: ci });
  }
  return rows.sort((a, b) => a.code.localeCompare(b.code) || a.role.localeCompare(b.role) || (a.threshold ?? 0) - (b.threshold ?? 0) || a.horizonDays - b.horizonDays);
}

function main(argv) {
  const repos = [], names = [];
  let until = 'HEAD', labelsPath = null, out = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') repos.push(resolve(argv[++i]));
    else if (argv[i] === '--name') names.push(argv[++i]);
    else if (argv[i] === '--until') until = argv[++i];
    else if (argv[i] === '--labels') labelsPath = argv[++i];
    else if (argv[i] === '--out') out = argv[++i];
  }
  if (!repos.length) throw new Error('usage: run.mjs --repo <path> [--name <label>] [--until <rev>] [--labels <file>] [--out <file>]');
  const labels = labelsPath ? JSON.parse(readFileSync(labelsPath, 'utf8')) : {};
  const results = repos.map((repo, i) => replayRepository(repo, { name: names[i] || repo, until, labels }));
  const hits = results.flatMap(r => r.hits);
  const report = {
    method: 'history replay (spec 095 FR-012)',
    horizonsDays: HORIZON_DAYS, thresholds: THRESHOLDS, labelWindowDays: LABEL_WINDOW_DAYS,
    label: 'proxy: TRUE when the document later rewrote a line naming the file (FRS006) or added a mention (FRS007) within the window; overrides via --labels; unconfirmed overrides are reported apart (summary[].unconfirmed) and never counted in n or precision',
    repositories: results.map(r => ({ repo: r.repo, head: r.head, reviewPoints: r.reviewPoints, hits: r.hits.length })),
    summary: summarize(hits),
    hits,
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (out) writeFileSync(out, text); else process.stdout.write(text);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
