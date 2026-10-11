#!/usr/bin/env node
/**
 * Anchor churn replay: how many requirement links would each recent commit
 * have made suspect, and how many of those flags were formatting only?
 *
 * Spec: specs/070-requirement-anchors (docguard.requirement-anchors#FR-027).
 *
 *   node tools/anchor-churn-replay.mjs [--commits 100] [--out <json>] [--write-default]
 *
 * It walks the last N first-parent commits in a scratch worktree, using TODAY's
 * anchor code on each commit's tree. Each commit is compared with its parent
 * as if every link had been accepted at the parent. A code-side flag is
 * classified by a rule anyone can rerun (research P6): FORMATTING-ONLY when
 * every `git diff -w` hunk that touches the anchored span changes only blank
 * or comment lines, CODE-CHANGING otherwise.
 *
 * The decision it feeds (FR-028): `anchors.failOn` defaults to
 * `reviewed-exact` only if no exact-tier link (Babel, python3 ast) was flagged
 * for a formatting-only commit. `--write-default` writes that into
 * `ANCHOR_FAIL_DEFAULT` in cli/scanners/anchors.mjs, so the shipped default
 * is the measured one, and tests/requirement-anchors-policy.test.mjs keeps
 * them equal.
 *
 * @implements docguard.requirement-anchors#FR-027
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { computeLinks, isExactTier } from '../cli/scanners/anchors.mjs';
import { loadConfig } from '../cli/config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RULE = 'formatting-only = every `git diff -w -U0` hunk touching the anchored span changes only blank or comment lines; anything else is code-changing';
const COMMENT_LINE = /^\s*(?:$|\/\/|\/\*|\*|\*\/|#(?!include|define|if|else|endif|pragma|!)|<!--|-->)/;

function args(argv) {
  const out = { commits: 100, out: join(ROOT, 'specs/070-requirement-anchors/evidence/churn-replay.json'), writeDefault: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--commits') out.commits = Number(argv[++i]);
    else if (argv[i] === '--out') out.out = resolve(argv[++i]);
    else if (argv[i] === '--write-default') out.writeDefault = true;
  }
  if (!Number.isInteger(out.commits) || out.commits < 1) throw new Error('--commits must be a positive integer');
  return out;
}

const git = (cwd, a) => execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** New-side line ranges and the changed lines of each `git diff -w -U0` hunk. */
function hunks(cwd, from, to, file) {
  let text;
  try { text = git(cwd, ['diff', '-w', '-U0', '--no-color', '--no-ext-diff', from, to, '--', file]); } catch { return null; }
  const out = [];
  let current = null;
  for (const line of text.split('\n')) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      current = { start, end: count === 0 ? start : start + count - 1, lines: [] };
      out.push(current);
    } else if (current && (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')) {
      current.lines.push(line.slice(1));
    }
  }
  return out;
}

function classify(cwd, from, to, link) {
  const touching = (hunks(cwd, from, to, link.file) || [])
    .filter(h => link.scope === 'file' || (h.end >= (link.startLine || 1) - 1 && h.start <= (link.endLine || Infinity)));
  const codeChanging = touching.some(h => h.lines.some(l => !COMMENT_LINE.test(l)));
  return codeChanging ? 'code-changing' : 'formatting-only';
}

export function replay({ commits }) {
  const revs = git(ROOT, ['rev-list', '--first-parent', '-n', String(commits + 1), 'HEAD']).trim().split('\n').reverse();
  const work = mkdtempSync(join(tmpdir(), 'dg-anchor-replay-'));
  const tree = join(work, 'tree');
  git(ROOT, ['worktree', 'add', '-q', '--detach', tree, revs[0]]);
  const perCommit = [];
  const totals = { flags: 0, codeChanging: 0, formattingOnly: 0, formattingOnlyExact: 0, codeChangingExact: 0, lost: 0 };
  const formattingOnlyExamples = [];
  try {
    let previous = null;
    for (const rev of revs) {
      git(tree, ['checkout', '-q', '--detach', rev]);
      const config = loadConfig(tree);
      const now = computeLinks(tree, config, { env: {} });
      if (previous) {
        const prior = new Map(previous.result.links.map(l => [l.key, l]));
        const current = new Map(now.links.map(l => [l.key, l]));
        const row = { rev: rev.slice(0, 12), flags: 0, codeChanging: 0, formattingOnly: 0, lost: 0 };
        for (const [key, before] of prior) {
          const after = current.get(key);
          if (!after) {
            if (now.requirements.has(before.requirement)) { row.lost++; totals.lost++; }
            continue;
          }
          const changed = before.tier === after.tier ? before.exact !== after.exact : before.floor !== after.floor;
          if (!changed) continue;
          row.flags++; totals.flags++;
          const kind = classify(tree, previous.rev, rev, after);
          if (kind === 'code-changing') {
            row.codeChanging++; totals.codeChanging++;
            if (isExactTier(after.tier)) totals.codeChangingExact++;
          } else {
            row.formattingOnly++; totals.formattingOnly++;
            if (isExactTier(after.tier)) {
              totals.formattingOnlyExact++;
              if (formattingOnlyExamples.length < 20) formattingOnlyExamples.push({ rev: rev.slice(0, 12), key, tier: after.tier });
            }
          }
        }
        perCommit.push(row);
      }
      previous = { rev, result: now };
    }
  } finally {
    try { git(ROOT, ['worktree', 'remove', '--force', tree]); } catch { /* best effort */ }
    rmSync(work, { recursive: true, force: true });
  }
  const failOnDefault = totals.formattingOnlyExact === 0 ? 'reviewed-exact' : 'none';
  return {
    schemaVersion: 1,
    spec: 'docguard.requirement-anchors',
    requirement: 'FR-027',
    head: revs[revs.length - 1],
    from: revs[0],
    commits: perCommit.length,
    rule: RULE,
    totals,
    failOnDefault,
    decision: failOnDefault === 'reviewed-exact'
      ? 'No exact-tier link was flagged by a formatting-only commit, so reviewed, exact-tier, precisely scoped suspects fail guard by default.'
      : `${totals.formattingOnlyExact} exact-tier flag(s) came from formatting-only commits, so failing stays opt-in (failOn: none) until the normalization is fixed.`,
    formattingOnlyExamples,
    perCommit,
  };
}

function writeDefault(value) {
  const path = join(ROOT, 'cli/scanners/anchors.mjs');
  const text = readFileSync(path, 'utf8');
  const next = text.replace(/export const ANCHOR_FAIL_DEFAULT = '[^']*';/, `export const ANCHOR_FAIL_DEFAULT = '${value}';`);
  if (next !== text) writeFileSync(path, next);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = args(process.argv.slice(2));
  const report = replay(opts);
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, `${JSON.stringify(report, null, 2)}\n`);
  if (opts.writeDefault) writeDefault(report.failOnDefault);
  console.log(`${report.commits} commits ${report.from.slice(0, 12)}..${report.head.slice(0, 12)}: ${report.totals.flags} flag(s), ${report.totals.codeChanging} code-changing, ${report.totals.formattingOnly} formatting-only (${report.totals.formattingOnlyExact} at an exact tier), ${report.totals.lost} lost`);
  console.log(`failOn default: ${report.failOnDefault}${opts.writeDefault ? ' (written to cli/scanners/anchors.mjs)' : ''}`);
}
