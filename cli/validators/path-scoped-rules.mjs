/**
 * Path-Scoped Rules validator: agent instruction files whose scope or
 * pointers went stale (specs/033-path-scoped-rules).
 *
 *   PSR001  a scope glob matches no tracked file: the rule never loads
 *   PSR002  a path an instruction file points at does not exist
 *   PSR003  the instructions one harness loads for some path exceed the budget
 *   PSR004  a scope DocGuard or the harness cannot read
 *
 * Guard evaluates tracked files, so a laptop with untracked or ignored files
 * gets the same answer as CI. Instruction files under test, fixture and
 * example paths are test data, not this project's instructions, and are
 * skipped. `rules --for` lists everything an agent would load, local included.
 *
 * @implements docguard.path-scoped-rules#FR-003
 * @implements docguard.path-scoped-rules#FR-004
 * @implements docguard.path-scoped-rules#FR-007
 */

import { posix } from 'node:path';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import {
  applicableFor, HARNESSES, instructionScopes, MAX_INSTRUCTION_FILES, safeProjectPath,
} from '../scanners/instruction-scopes.mjs';
import { extractInstructionPointers, safePointerPath } from '../scanners/instruction-audit.mjs';
import { readFrontmatter } from '../scanners/frontmatter.mjs';
import { DEFAULT_INSTRUCTION_BUDGET } from '../scanners/agent-instructions.mjs';
import { buildIgnoreFilter, isNonProductPath, loadDocguardIgnore, walkFiles, relPosix } from '../shared-ignore.mjs';
import { gitIgnoredPaths, listTrackedFiles } from '../shared-git.mjs';

const HARNESS_NAMES = { codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', copilot: 'GitHub Copilot', openhands: 'OpenHands' };
const MAX_POINTER_FINDINGS = 50;
const SKILL_DIRS_RE = /^(\.\/)?(scripts|references|assets)\//;

export function validatePathScopedRules(projectDir, config = {}) {
  const tracked = listTrackedFiles(projectDir);
  const ignored = buildIgnoreFilter([...(config.ignore || []), ...loadDocguardIgnore(projectDir)]);
  let projectFiles = tracked;
  if (projectFiles === null) {
    projectFiles = [];
    walkFiles(projectDir, full => { projectFiles.push(relPosix(projectDir, full)); });
  }
  projectFiles = projectFiles.filter(f => !ignored(f));

  const { entries: all, files: instructionFiles, skipped } = instructionScopes(projectDir, projectFiles);
  const entries = all.filter(e => !isNonProductPath(e.file, config));
  if (entries.length === 0) {
    return { ...resultFromFindings([], { passed: 0, total: 0 }), applicable: false, note: 'no agent instruction files' };
  }

  const findings = [];
  let total = 0;
  const limitations = [];
  if (tracked === null) limitations.push('git unavailable: checked the working tree instead of tracked files');
  if (skipped) limitations.push(`${skipped} instruction files past the first ${MAX_INSTRUCTION_FILES} were not checked`);

  // ── PSR004: scopes that cannot be read ──
  for (const e of entries) {
    for (const issue of e.issues || []) {
      total++;
      findings.push(mkFinding({
        code: 'PSR004', validator: 'pathScopedRules', severity: 'warn', disposition: 'act', confidence: 'high',
        message: `${e.file} (${HARNESS_NAMES[e.harness]}): ${issue.message}`,
        location: { file: e.file, line: issue.line },
        suggestion: issue.fix
          ? { kind: 'fix', text: `${issue.field ? `${issue.field}: ` : ''}${issue.fix}` }
          : { kind: 'review', text: 'Fix the frontmatter so the harness reads the scope you intended' },
      }));
    }
    if (e.unevaluated?.length) limitations.push(`${e.file}: scope not checked, ${e.unevaluated.join(', ')}`);
  }

  // ── PSR001: scope globs that match no tracked file ──
  for (const e of entries.filter(x => x.scope === 'globs')) {
    const matches = g => projectFiles.some(f => g.test(f) || (e.base && (f === e.base || f.startsWith(`${e.base}/`)) && g.test(f.slice(e.base.length + 1))));
    const dead = e.globs.filter(g => !matches(g));
    total++;
    if (dead.length === 0) continue;
    const allDead = dead.length === e.globs.length;
    // A partly dead list still loads for the live patterns: the milder case,
    // marked low confidence (findings carry error or warn only).
    findings.push(mkFinding({
      code: 'PSR001', validator: 'pathScopedRules', severity: 'warn', disposition: 'escalate', confidence: allDead ? 'high' : 'low',
      message: allDead
        ? `${e.file} (${HARNESS_NAMES[e.harness]}): ${e.field} ${dead.map(g => JSON.stringify(g.pattern)).join(', ')} match${dead.length === 1 ? 'es' : ''} no tracked file, so the rule never loads`
        : `${e.file} (${HARNESS_NAMES[e.harness]}): ${e.field} ${dead.map(g => JSON.stringify(g.pattern)).join(', ')} match${dead.length === 1 ? 'es' : ''} no tracked file; the other patterns still do`,
      location: { file: e.file, line: e.fieldLine },
      suggestion: { kind: 'review', text: 'Point the pattern at where that code lives now, or delete the rule if the code is gone' },
    }));
  }

  // ── PSR002: pointers that resolve to nothing ──
  const fileSet = new Set(projectFiles);
  const dirSet = new Set();
  for (const f of projectFiles) {
    for (let i = f.indexOf('/'); i !== -1; i = f.indexOf('/', i + 1)) dirSet.add(f.slice(0, i));
  }
  const exists = p => fileSet.has(p) || dirSet.has(p);
  const unresolved = [];
  const pointerFiles = [...new Map(entries.filter(e => !e.generated && e.scope !== 'not-loaded').map(e => [e.file, e])).values()];
  for (const e of pointerFiles) {
    const dir = e.file.includes('/') ? e.file.slice(0, e.file.lastIndexOf('/')) : '';
    const skill = /(^|\/)SKILL\.md$/.test(e.file);
    for (const { line, path } of extractInstructionPointers(e.content, { skipLines: readFrontmatter(e.content).bodyStart })) {
      if (path.startsWith('~') || path.startsWith('/')) continue; // outside the project by design
      // A skill is a procedure over runtime paths. Only its own bundled files
      // (the Agent Skills spec's scripts/, references/, assets/) are pointers.
      if (skill && !SKILL_DIRS_RE.test(path)) continue;
      // A bare name is resolved if any tracked file has it; one that matches
      // nothing is an example ("ux.md"), not a pointer.
      if (!path.includes('/')) continue;
      const local = dir ? safeProjectPath(projectDir, posix.join(dir, path)) : null;
      const rooted = !skill && safePointerPath(path.replace(/\/$/, '')) ? posix.normalize(path).replace(/\/$/, '') : null;
      total++;
      if ((local !== null && exists(local)) || (rooted && exists(rooted))) continue;
      if (local === null && rooted === null) continue; // escapes the project: not ours to check
      unresolved.push({ e, line, path, candidate: local ?? rooted });
    }
  }
  const ignoredByGit = gitIgnoredPaths(projectDir, [...new Set(unresolved.map(u => u.candidate))]);
  let reported = 0;
  for (const u of unresolved) {
    // A pointer to a gitignored path names a machine-local file on purpose.
    if (ignoredByGit && (ignoredByGit.ignored.has(u.candidate) || ignoredByGit.unknown.has(u.candidate))) continue;
    if (++reported > MAX_POINTER_FINDINGS) continue;
    findings.push(mkFinding({
      code: 'PSR002', validator: 'pathScopedRules', severity: 'warn', disposition: 'act', confidence: 'high',
      message: `${u.e.file}:${u.line} points at ${u.path}, which does not exist`,
      location: { file: u.e.file, line: u.line },
      suggestion: { kind: 'fix', text: 'Point it at the file that replaced it, or remove the reference' },
    }));
  }
  if (reported > MAX_POINTER_FINDINGS) limitations.push(`${reported - MAX_POINTER_FINDINGS} more broken pointers not listed`);

  // ── PSR003: bytes one harness loads for a path ──
  // Nested AGENTS.md chains are STR004's; PSR003 counts every other file.
  const budget = config.agentInstructions || {};
  const maxBytes = Number.isInteger(budget.maxBytes) && budget.maxBytes > 0 ? budget.maxBytes : DEFAULT_INSTRUCTION_BUDGET;
  const allowances = budget.allowances && typeof budget.allowances === 'object' ? budget.allowances : {};
  for (const harness of HARNESSES.filter(h => h !== 'codex')) {
    const mine = entries.filter(e => e.harness === harness && e.kind !== 'agents' && e.scope !== 'unknown' && e.scope !== 'not-loaded');
    if (mine.length === 0) continue;
    const groups = groupByApplicable(mine, harness, projectFiles);
    for (const group of groups.values()) {
      total++;
      const allowanceKey = [harness, ...group.paths.map(p => `${harness}:${p}`)].find(k => Number.isInteger(allowances[k]));
      const limit = allowanceKey ? allowances[allowanceKey] : maxBytes;
      if (group.bytes <= limit) continue;
      const example = group.paths[0];
      findings.push(mkFinding({
        code: 'PSR003', validator: 'pathScopedRules', severity: 'warn', disposition: 'escalate', confidence: 'high',
        message: `${HARNESS_NAMES[harness]} loads ${group.bytes} bytes of instructions for ${example}${group.paths.length > 1 ? ` and ${group.paths.length - 1} other paths` : ''} (${group.files.join(', ')}), over the ${allowanceKey ? `allowance ${limit}` : `budget of ${limit}`} bytes`,
        location: { file: group.files[group.files.length - 1] },
        suggestion: { kind: 'review', text: `Narrow the rules' scopes, move procedures into linked docs, or record agentInstructions.allowances["${harness}:${example}"] so further growth is a reviewed change` },
      }));
    }
  }

  const passed = Math.max(0, total - findings.length);
  const result = resultFromFindings(findings, { passed, total });
  if (limitations.length) result.applicability = { status: 'partial', reason: limitations.join('; ') };
  result.instructionFiles = instructionFiles.length;
  return result;
}

/**
 * Tracked files grouped by the set of instruction files one harness loads for
 * them. Directory-only scopes group by directory, so the work is bounded by
 * directories plus glob tests, not by every file times every rule.
 */
function groupByApplicable(entries, harness, files) {
  const hasGlobs = entries.some(e => e.scope === 'globs');
  const groups = new Map();
  const memo = new Map();
  for (const file of files) {
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    let applied;
    if (!hasGlobs && memo.has(dir)) applied = memo.get(dir);
    else {
      applied = applicableFor(entries, harness, file);
      if (!hasGlobs) memo.set(dir, applied);
    }
    if (applied.length === 0) continue;
    const key = applied.map(a => a.file).join('\n');
    let group = groups.get(key);
    if (!group) {
      group = { files: applied.map(a => a.file), bytes: applied.reduce((n, a) => n + a.bytes, 0), paths: [] };
      groups.set(key, group);
    }
    group.paths.push(file);
  }
  return groups;
}
