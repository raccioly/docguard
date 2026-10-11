/**
 * `docguard anchors`: every code→requirement link, what it anchors to, at
 * which tier, and its reviewed state; `anchors accept` is the anchor lock's
 * only writer for links.
 *
 * Spec: specs/070-requirement-anchors (docguard.requirement-anchors).
 * Contract: specs/070-requirement-anchors/contracts/anchors-cli.md.
 *
 *   docguard anchors [--spec <id>] [--state <state>] [--file <path>] [--format json] [--no-cache]
 *   docguard anchors accept (--link <key> | --spec <id> | --file <path>) --reason <text> [--bulk] [--gitattributes]
 *   docguard anchors accept --baseline --bulk --reason <text> [--gitattributes]
 *   docguard anchors accept --remove <key> --reason <text>
 *
 * Accepting is a statement that someone read the code against the
 * requirement, so it needs a reason, it is bound to the exact fingerprints it
 * saw (a later change re-flags the link), it refuses when a file changed
 * during the run, and an accept of more than one link must say `--bulk`.
 * DocGuard authenticates nobody: CODEOWNERS on the lock is where a team
 * requires a human (FR-025).
 *
 * @implements docguard.requirement-anchors#FR-020
 * @implements docguard.requirement-anchors#FR-021
 * @implements docguard.requirement-anchors#FR-022
 * @implements docguard.requirement-anchors#FR-023
 * @implements docguard.requirement-anchors#FR-024
 * @implements docguard.requirement-anchors#FR-025
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { c } from '../shared.mjs';
import { commitFileTransaction } from '../writers/file-transaction.mjs';
import { contentSha } from '../scanners/anchor-cache.mjs';
import { GITATTRIBUTES_LINE, gitattributesDeclaresUnion, readAnchorLock, serializeAnchorLock } from '../scanners/anchor-lock.mjs';
import { ANCHOR_LOCK_PATH, computeAnchorStatus } from '../scanners/anchors.mjs';

const ACTIONS = new Set(['accept']);
const STATE_ICON = { reviewed: '✅', baselined: '◐ ', unreviewed: '○ ', suspect: '⚠️ ', lost: '❌', 'retired-target': '⊘ ', unverifiable: '? ' };

function headRevision(projectDir) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

const today = () => new Date().toISOString().slice(0, 10);

function filterLinks(links, flags) {
  return links.filter(link => (!flags.spec || link.specId === flags.spec || link.requirement.startsWith(`${flags.spec}#`))
    && (!flags.file || link.file === flags.file)
    && (!flags.state || link.state === flags.state));
}

function printText(result) {
  const { summary } = result;
  console.log(`${c.bold}Requirement anchors${c.reset}: ${summary.links} link(s) in ${summary.files} file(s)`);
  console.log(`  by scope: ${Object.entries(summary.byScope).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  console.log(`  by tier:  ${Object.entries(summary.byTier).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  if (summary.byState) console.log(`  by state: ${Object.entries(summary.byState).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  if (!result.activated) {
    console.log(`${c.dim}  Not active in guard: no ${ANCHOR_LOCK_PATH} and anchors.enabled is not set.${c.reset}`);
  }
  let file = null;
  const byFile = [...result.links, ...result.lost].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.startLine || 0) - (b.startLine || 0)));
  for (const link of byFile) {
    if (link.file !== file) { file = link.file; console.log(`\n${c.cyan}${file}${c.reset}`); }
    const where = link.scope === 'file' ? 'whole file' : `${link.anchor} (${link.scope}${link.startLine ? `, lines ${link.startLine}-${link.endLine}` : ''})`;
    const state = link.state ? `${STATE_ICON[link.state] || ''} ${link.state}${link.side ? ` (${link.side})` : ''}` : '';
    console.log(`  ${link.requirement.padEnd(48)} → ${where} ${c.dim}[${link.tier}]${c.reset} ${state}`);
  }
  if (result.problems.length) {
    console.log(`\n${c.yellow}${result.problems.length} problem(s)${c.reset}`);
    for (const p of result.problems.slice(0, 50)) console.log(`  ${p.code} ${p.file}${p.line ? `:${p.line}` : ''} ${p.message}`);
    if (result.problems.length > 50) console.log(`  … ${result.problems.length - 50} more; use --format json`);
  }
  for (const note of result.notes || []) console.log(`${c.dim}${note}${c.reset}`);
}

function list(projectDir, config, flags) {
  const computed = computeAnchorStatus(projectDir, config, { noCache: flags.noCache === true });
  const links = filterLinks(computed.links, flags);
  const lost = filterLinks(computed.lost, flags);
  const infoCodes = new Set(['ANC004', 'ANC006']);
  const problems = computed.problems
    .filter(p => !flags.file || p.file === flags.file)
    .map(p => ({ ...p, severity: p.code === 'ANC005' ? 'error' : infoCodes.has(p.code) ? 'info' : 'warn' }));
  const result = {
    command: 'anchors',
    status: problems.some(p => p.severity === 'error') ? 'FAIL' : problems.some(p => p.severity === 'warn') ? 'WARN' : 'PASS',
    activated: computed.activated,
    lock: computed.lock,
    summary: { ...computed.summary, links: links.length },
    links: links.map(({ entry, ...rest }) => (rest.key && rest.state !== 'unreviewed' ? { ...rest, reviewedOn: entry?.date || null, acceptCommand: `docguard anchors accept --link '${rest.key}' --reason "<what you checked>"` } : rest)),
    lost: lost.map(({ entry, ...rest }) => ({ ...rest, reviewedOn: entry?.date || null })),
    problems,
    notes: computed.notes,
    files: computed.files.map(({ sha, ...rest }) => rest),
    cache: computed.cache,
    python: computed.python,
  };
  if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
  else printText(result);
  if (result.status === 'FAIL') process.exitCode = 1;
  else if (result.status === 'WARN') process.exitCode = 2;
}

function fail(message, flags) {
  if (flags.format === 'json') console.log(JSON.stringify({ command: 'anchors accept', status: 'REFUSED', message }, null, 2));
  else console.error(`${c.red}${message}${c.reset}`);
  process.exitCode = 1;
}

/** Re-read every selected file and compare with the bytes the fingerprints came from. */
export function changedDuringRun(projectDir, selected, files) {
  const shaOf = new Map(files.map(f => [f.path, f.sha]));
  const changed = [];
  for (const path of new Set(selected.map(l => l.file))) {
    const abs = resolve(projectDir, path);
    let now = null;
    try { now = contentSha(readFileSync(abs)); } catch { now = null; }
    if (now !== shaOf.get(path)) changed.push(path);
  }
  return changed;
}

function accept(projectDir, config, flags) {
  const reason = typeof flags.reason === 'string' ? flags.reason.trim() : '';
  if (reason.length < 10 || reason.length > 500) return fail('anchors accept needs --reason "<what you checked>" (10-500 characters).', flags);
  const lockNow = readAnchorLock(projectDir);
  if (lockNow.error) return fail(`${lockNow.error}. Restore the lock before accepting.`, flags);
  const links = new Map(lockNow.links);
  const dispositions = lockNow.dispositions;
  let written = [];
  let removed = [];

  if (flags.remove) {
    if (!links.has(flags.remove)) return fail(`No entry ${flags.remove} in ${ANCHOR_LOCK_PATH}.`, flags);
    links.delete(flags.remove);
    removed = [flags.remove];
  } else {
    // Never trust the cache for a write: fingerprint every file afresh.
    const status = computeAnchorStatus(projectDir, config, { noCache: true });
    let selected;
    if (flags.baseline) {
      selected = status.links.filter(l => l.state === 'unreviewed');
    } else if (flags.link) {
      selected = status.links.filter(l => l.key === flags.link);
      if (!selected.length) return fail(`No current link ${flags.link}. Run \`docguard anchors --format json\` for the keys.`, flags);
    } else if (flags.spec || flags.file) {
      selected = status.links.filter(l => (!flags.spec || l.specId === flags.spec || l.requirement.startsWith(`${flags.spec}#`)) && (!flags.file || l.file === flags.file));
    } else {
      return fail('anchors accept needs --link <key>, --spec <id>, --file <path>, --baseline or --remove <key>.', flags);
    }
    // Retired targets and unverifiable links cannot be reviewed against anything.
    selected = selected.filter(l => l.state !== 'retired-target' && l.state !== 'unverifiable');
    if (!selected.length) return fail('Nothing to accept: the selection matches no link that can be reviewed.', flags);
    if (flags.baseline && !flags.bulk) return fail(`--baseline stamps ${selected.length} link(s); add --bulk to confirm.`, flags);
    if (selected.length > 1 && !flags.bulk) return fail(`The selection matches ${selected.length} links; add --bulk to accept them all, or use --link for one.`, flags);
    const changed = changedDuringRun(projectDir, selected, status.files);
    if (changed.length) return fail(`Refused: ${changed.join(', ')} changed while the fingerprints were computed. Run the accept again.`, flags);
    const revision = headRevision(projectDir);
    const date = today();
    const bulk = selected.length > 1;
    for (const l of selected) {
      // A moved link's review lives under its old key: rewrite it (FR-030).
      if (l.movedFrom) links.delete(l.movedFrom);
      const prior = links.get(l.key) || l.entry || null;
      links.set(l.key, {
        key: l.key, requirement: l.requirement, file: l.file, anchor: l.anchor, scope: l.scope, tier: l.tier,
        code: l.exact, floor: l.floor, req: l.req,
        prev: prior ? { code: prior.code, floor: prior.floor, req: prior.req } : null,
        state: flags.baseline ? 'baselined' : 'reviewed', revision, date, reason, bulk,
      });
      written.push(l.key);
    }
  }

  const entries = [{ path: resolve(projectDir, ANCHOR_LOCK_PATH), content: serializeAnchorLock(links, dispositions) }];
  let gitattributes = 'unchanged';
  if (flags.gitattributes && !gitattributesDeclaresUnion(projectDir)) {
    // Constitution VI: `.gitattributes` changes only on this explicit flag, inside the same transaction.
    const path = resolve(projectDir, '.gitattributes');
    const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
    entries.push({ path, content: `${before}${before && !before.endsWith('\n') ? '\n' : ''}${GITATTRIBUTES_LINE}\n` });
    gitattributes = 'added';
  }
  commitFileTransaction(entries, {
    validate: () => {
      const back = readAnchorLock(projectDir);
      if (back.error) throw new Error(back.error);
    },
  });
  const summary = { command: 'anchors accept', status: 'WRITTEN', written: written.length, removed, baseline: flags.baseline === true, bulk: written.length > 1, gitattributes,
    note: gitattributesDeclaresUnion(projectDir) ? null : `Add \`${GITATTRIBUTES_LINE}\` to .gitattributes (or rerun with --gitattributes) so reviews on two branches merge cleanly.` };
  if (flags.format === 'json') console.log(JSON.stringify({ ...summary, keys: written }, null, 2));
  else {
    if (written.length) console.log(`${c.green}✓ ${flags.baseline ? 'BASELINED' : 'ACCEPTED'}${c.reset} ${written.length} link(s) in ${ANCHOR_LOCK_PATH}`);
    for (const key of removed) console.log(`${c.green}✓ REMOVED${c.reset} ${key} (${reason})`);
    if (gitattributes === 'added') console.log(`${c.green}✓${c.reset} .gitattributes: ${GITATTRIBUTES_LINE}`);
    if (summary.note) console.log(`${c.dim}${summary.note}${c.reset}`);
  }
}

export function runAnchors(projectDir, config, flags = {}) {
  const action = flags.args?.[0] || null;
  if (action && !ACTIONS.has(action)) {
    console.error(`${c.red}Unknown anchors action: ${action}${c.reset}`);
    process.exitCode = 1;
    return;
  }
  try {
    if (action === 'accept') accept(projectDir, config, flags);
    else list(projectDir, config, flags);
  } catch (e) {
    fail(e.message, flags);
  }
}
