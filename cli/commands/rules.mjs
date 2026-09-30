/**
 * `docguard rules --for <path>` — which agent instruction files each harness
 * loads for a path, why, and how many bytes (specs/033-path-scoped-rules).
 *
 * Read-only. Lists machine-local files too (marked `local`): an untracked or
 * gitignored rule still loads on the machine that has it. The path need not
 * exist; scope is a pattern match.
 *
 * @implements docguard.path-scoped-rules#FR-005
 * @implements docguard.path-scoped-rules#FR-006
 */

import { c } from '../shared.mjs';
import {
  applicableFor, HARNESSES, instructionFilesOnDisk, instructionScopes, safeProjectPath,
} from '../scanners/instruction-scopes.mjs';
import { listTrackedFiles } from '../shared-git.mjs';

const NAMES = { codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', copilot: 'GitHub Copilot', openhands: 'OpenHands' };

/** The rules report as data; throws on an unsafe path or unknown harness. */
export function rulesFor(projectDir, path, { harness = null } = {}) {
  const target = safeProjectPath(projectDir, path);
  if (target === null) throw new Error(`--for must be a path inside the project, without .. or an absolute prefix: ${path}`);
  if (harness && !HARNESSES.includes(harness)) throw new Error(`--harness must be one of ${HARNESSES.join(', ')}`);
  const tracked = listTrackedFiles(projectDir);
  const disk = instructionFilesOnDisk(projectDir);
  const trackedSet = new Set(tracked || []);
  const files = [...new Set([...(tracked || []), ...disk.files])];
  const local = new Set(tracked ? disk.files.filter(f => !trackedSet.has(f)) : []);
  const { entries, skipped } = instructionScopes(projectDir, files, { local });
  const harnesses = {};
  for (const h of harness ? [harness] : HARNESSES) {
    const applied = applicableFor(entries, h, target);
    harnesses[h] = { files: applied, totalBytes: applied.reduce((n, a) => n + a.bytes, 0) };
  }
  const notPathScoped = [...new Set(entries
    .filter(e => e.scope === 'not-path-scoped' && (!harness || e.harness === harness))
    .map(e => e.file))].sort();
  const limitations = [];
  if (tracked === null) limitations.push('git unavailable: tracked and local files are not distinguished');
  if (!disk.complete) limitations.push('the working-tree walk stopped early');
  if (skipped) limitations.push(`${skipped} instruction files were not read`);
  return { path: target, harnesses, notPathScoped, limitations };
}

export function runRules(projectDir, config, flags) {
  const path = flags.for;
  if (typeof path !== 'string' || !path) {
    console.error(`${c.red}Usage: docguard rules --for <path> [--harness <name>] [--format json]${c.reset}`);
    process.exitCode = 1;
    return null;
  }
  let report;
  try { report = rulesFor(projectDir, path, { harness: flags.harness || null }); }
  catch (error) {
    console.error(`${c.red}${error.message}${c.reset}`);
    process.exitCode = 1;
    return null;
  }
  if (flags.format === 'json') {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }
  console.log(`${c.bold}Instructions an agent loads for ${report.path || '(project root)'}${c.reset}\n`);
  for (const [harness, { files, totalBytes }] of Object.entries(report.harnesses)) {
    console.log(`  ${c.bold}${NAMES[harness]}${c.reset} ${c.dim}(${totalBytes} bytes)${c.reset}`);
    if (files.length === 0) console.log(`    ${c.dim}nothing${c.reset}`);
    for (const f of files) {
      console.log(`    ${f.file} ${c.dim}— ${f.reason} — ${f.bytes} bytes${f.local ? ' — local' : ''}${c.reset}`);
    }
  }
  if (report.notPathScoped.length) {
    console.log(`\n  ${c.dim}Not path-scoped (loaded by description, keyword or on request): ${report.notPathScoped.length} file(s)${c.reset}`);
  }
  for (const note of report.limitations) console.log(`  ${c.yellow}Partial: ${note}${c.reset}`);
  console.log('');
  return report;
}
