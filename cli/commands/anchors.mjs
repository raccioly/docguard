/**
 * `docguard anchors`: every code→requirement link, what it anchors to, and
 * at which tier.
 *
 * Spec: specs/070-requirement-anchors (docguard.requirement-anchors).
 * Contract: specs/070-requirement-anchors/contracts/anchors-cli.md.
 *
 *   docguard anchors [--spec <id>] [--state <state>] [--file <path>] [--format json] [--no-cache]
 *
 * Read-only. The listing works whether or not the project has opted in;
 * `activated` says whether guard reports on it (FR-026). Informational
 * problems that guard never reports (ANC006 ambiguous scope) are listed here.
 *
 * @implements docguard.requirement-anchors#FR-021
 * @implements docguard.requirement-anchors#FR-020
 */

import { c } from '../shared.mjs';
import { ANCHOR_LOCK_PATH, computeLinks } from '../scanners/anchors.mjs';

const ACTIONS = new Set([]);

function filterLinks(links, flags) {
  return links.filter(link => (!flags.spec || link.specId === flags.spec || link.requirement.startsWith(`${flags.spec}#`))
    && (!flags.file || link.file === flags.file)
    && (!flags.state || (link.state || 'unreviewed') === flags.state));
}

function printText(result) {
  const { summary } = result;
  console.log(`${c.bold}Requirement anchors${c.reset}: ${summary.links} link(s) in ${summary.files} file(s)`);
  console.log(`  by scope: ${Object.entries(summary.byScope).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  console.log(`  by tier:  ${Object.entries(summary.byTier).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  if (!result.activated) {
    console.log(`${c.dim}  Not active in guard: no ${ANCHOR_LOCK_PATH} and anchors.enabled is not set.${c.reset}`);
  }
  let file = null;
  const byFile = [...result.links].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.startLine || 0) - (b.startLine || 0)));
  for (const link of byFile) {
    if (link.file !== file) { file = link.file; console.log(`\n${c.cyan}${file}${c.reset}`); }
    const where = link.scope === 'file' ? 'whole file' : `${link.anchor} (${link.scope}, lines ${link.startLine}-${link.endLine})`;
    console.log(`  ${link.requirement.padEnd(48)} → ${where} ${c.dim}[${link.tier}]${c.reset}`);
  }
  if (result.problems.length) {
    console.log(`\n${c.yellow}${result.problems.length} problem(s)${c.reset}`);
    for (const p of result.problems.slice(0, 50)) console.log(`  ${p.code} ${p.file}${p.line ? `:${p.line}` : ''} ${p.message}`);
    if (result.problems.length > 50) console.log(`  … ${result.problems.length - 50} more; use --format json`);
  }
  if (!result.cache.enabled && result.cache.reason && !/CI|--no-cache/.test(result.cache.reason)) {
    console.log(`${c.dim}Cache ${result.cache.reason}${c.reset}`);
  }
}

export function runAnchors(projectDir, config, flags = {}) {
  const action = flags.args?.[0] || null;
  if (action && !ACTIONS.has(action)) {
    console.error(`${c.red}Unknown anchors action: ${action}${c.reset}`);
    process.exitCode = 1;
    return;
  }
  const computed = computeLinks(projectDir, config, { noCache: flags.noCache === true });
  const links = filterLinks(computed.links, flags);
  const problems = computed.problems
    .filter(p => !flags.file || p.file === flags.file)
    .map(p => ({ ...p, severity: p.code === 'ANC006' ? 'info' : 'warn' }));
  const result = {
    command: 'anchors',
    status: problems.some(p => p.severity === 'warn') ? 'WARN' : 'PASS',
    activated: computed.activated,
    lock: { path: ANCHOR_LOCK_PATH },
    summary: { ...computed.summary, links: links.length },
    links,
    problems,
    files: computed.files,
    cache: computed.cache,
    python: computed.python,
  };
  if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
  else printText(result);
  if (result.status === 'WARN') process.exitCode = 2;
}
