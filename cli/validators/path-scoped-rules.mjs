/**
 * Path-Scoped Rules validator: agent instruction files whose scope or
 * pointers went stale (specs/033-path-scoped-rules).
 *
 *   PSR001  a scope glob matches no tracked file: the rule never loads
 *   PSR002  a path an instruction file points at does not exist
 *   PSR003  the instructions one harness loads for some path exceed the budget
 *   PSR004  a scope DocGuard or the harness cannot read
 *   PSR005  a vendored instruction copy differs from what its installer recorded
 *   PSR006  a template, test, fixture or example copy shares an instruction file's name
 *
 * Guard evaluates tracked files, so a laptop with untracked or ignored files
 * gets the same answer as CI. Instruction files under test, fixture and
 * example paths are test data, not this project's instructions, and are
 * skipped. `rules --for` lists everything an agent would load, local included.
 *
 * @implements docguard.path-scoped-rules#FR-003
 * @implements docguard.path-scoped-rules#FR-004
 * @implements docguard.path-scoped-rules#FR-007
 * @implements docguard.output-ux#FR-011
 * @implements docguard.agent-instruction-role#FR-007
 * @implements docguard.instruction-copies#FR-003
 */

import { basename, posix } from 'node:path';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import {
  applicableFor, HARNESSES, instructionScopes, MAX_INSTRUCTION_FILES, safeProjectPath,
} from '../scanners/instruction-scopes.mjs';
import { extractInstructionPointers, safePointerPath } from '../scanners/instruction-audit.mjs';
import { readFrontmatter } from '../scanners/frontmatter.mjs';
import { DEFAULT_INSTRUCTION_BUDGET } from '../scanners/agent-instructions.mjs';
import { buildIgnoreFilter, loadDocguardIgnore, walkFiles, relPosix } from '../shared-ignore.mjs';
import { gitIgnoredPaths, listTrackedFiles } from '../shared-git.mjs';
import { agentInstructionDocs, fileSha256, instructionLeftOut, ROOT_AGENT_FILES } from '../shared-agent-instructions.mjs';
import { fileKind, INSTRUCTION_COPY } from '../shared-file-kind.mjs';
import { contractFields } from '../shared-result-contract.mjs';

const HARNESS_NAMES = { codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', copilot: 'GitHub Copilot', openhands: 'OpenHands' };
const MAX_POINTER_FINDINGS = 50;
const SKILL_DIRS_RE = /^(\.\/)?(scripts|references|assets)\//;

const MAX_COPY_FINDINGS = 50;

const NOTHING_HOW = 'Nothing to configure unless an agent-instruction file carries something to check: a path scope (a `globs:`, `paths:` or `applyTo:` field), a path pointer (`docs/ARCHITECTURE.md`, `@docs/guide.md`), a vendored Spec Kit copy, or a template or fixture copy that shares an instruction file\'s name. Path-Scoped-Rules reads AGENTS.md, CLAUDE.md, .claude/rules, .cursor/rules, .github/instructions and the other files of the agent-instruction role.';

/**
 * Does this kind of check belong to the project? It does when an agent
 * instruction file carries something for it to examine: a path scope, a path
 * pointer, an `@` import or a vendored copy. A project whose instruction files
 * are prose only, or that has none, has nothing of this kind (the validator
 * would examine nothing, and no declaration makes it examine something).
 *
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}) {
  const run = validatePathScopedRules(projectDir, config);
  return { applies: run.applies.applies, evidence: run.applies.evidence };
}

export function validatePathScopedRules(projectDir, config = {}) {
  const tracked = listTrackedFiles(projectDir);
  const ignored = buildIgnoreFilter([...(config.ignore || []), ...loadDocguardIgnore(projectDir)]);
  let allFiles = tracked;
  if (allFiles === null) {
    allFiles = [];
    walkFiles(projectDir, full => { allFiles.push(relPosix(projectDir, full)); });
  }
  // `.docguardignore` decides which files are validated; whether a pointer's
  // target exists is checked against every file (docguard.docs-verification-findings#FR-007).
  let projectFiles = allFiles.filter(f => !ignored(f));

  const { entries: all, files: instructionFiles, skipped } = instructionScopes(projectDir, projectFiles);
  // Test, fixture and example paths (spec 094) and template copies (spec 099 FR-001) are
  // forms for other projects, not this one's instructions, unless fileKinds.own names them.
  const entries = all.filter(e => !instructionLeftOut(e.file, config));
  const role = agentInstructionDocs(projectDir, config);
  const copies = instructionCopies(projectFiles, config);
  if (entries.length === 0 && copies.length === 0 && !role.docs.some(d => d.vendored?.hashes?.length)) {
    return {
      ...resultFromFindings([], { passed: 0, total: 0 }), applicable: false, note: 'no agent instruction files',
      ...contractFields({
        performed: 0,
        decide: () => ({ applies: false, evidence: 'the project has no agent-instruction file (AGENTS.md, CLAUDE.md, .claude/rules, .cursor/rules, .github/instructions) outside test, fixture, example and template paths' }),
        empty: d => ({ emptyCause: 'nothing-of-this-kind', note: `Path-Scoped-Rules found no agent instruction file to read: ${d.evidence}.`, howToConfigure: NOTHING_HOW }),
      }),
    };
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
  const fileSet = new Set(allFiles);
  const dirSet = new Set();
  for (const f of allFiles) {
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
  // docguard.output-ux#FR-011: a Claude Code `@path` import that names nothing.
  const missingImports = new Map();
  for (const e of entries) {
    if (e.generated || e.scope === 'not-loaded') continue;
    for (const m of e.missingImports || []) {
      const key = `${m.from}\0${m.line}\0${m.path}`;
      if (missingImports.has(key)) continue;
      total++;
      const candidate = posix.normalize(posix.join(m.from.includes('/') ? m.from.slice(0, m.from.lastIndexOf('/')) : '', m.path));
      missingImports.set(key, { e: { file: m.from }, line: m.line, path: m.path, candidate, isImport: true });
    }
  }
  unresolved.push(...missingImports.values());
  const ignoredByGit = gitIgnoredPaths(projectDir, [...new Set(unresolved.map(u => u.candidate))]);
  // docguard.verdict-contract#FR-006: when git cannot say which pointers name
  // machine-local (ignored) files, none of them is known to be broken. The
  // helper recorded the gap; withhold them all and say how many.
  if (ignoredByGit === null && unresolved.length > 0) {
    limitations.push(`${unresolved.length} unresolved pointer${unresolved.length === 1 ? '' : 's'} not checked: git could not report which paths are ignored`);
    unresolved.length = 0;
  }
  let reported = 0;
  for (const u of unresolved) {
    // A pointer to a gitignored path names a machine-local file on purpose.
    if (ignoredByGit && (ignoredByGit.ignored.has(u.candidate) || ignoredByGit.unknown.has(u.candidate))) continue;
    if (++reported > MAX_POINTER_FINDINGS) continue;
    findings.push(mkFinding({
      code: 'PSR002', validator: 'pathScopedRules', severity: 'warn', disposition: 'act', confidence: 'high',
      message: u.isImport ? `${u.e.file}:${u.line} imports @${u.path}, which does not exist` : `${u.e.file}:${u.line} points at ${u.path}, which does not exist`,
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

  // ── PSR005: a vendored copy no longer matches what was installed ──
  // docguard.agent-instruction-role#FR-007: only Spec Kit manifest copies,
  // whose sha256 is the record of what was written. DocGuard's own copies
  // are compared with the running package by `upgrade` instead.
  limitations.push(...role.limitations.filter(l => /manifest\.json/.test(l)));
  for (const doc of role.docs) {
    if (!doc.vendored?.hashes?.length) continue;
    total++;
    const actual = fileSha256(projectDir, doc.path);
    if (actual === null || doc.vendored.hashes.includes(actual)) continue;
    const { integration, version } = doc.vendored;
    // A Windows checkout with core.autocrlf rewrites LF as CRLF: say so rather
    // than calling a byte-identical copy edited (coordinator review of #633).
    const lineEndingsOnly = doc.vendored.hashes.includes(fileSha256(projectDir, doc.path, { normalizeLineEndings: true }));
    findings.push(mkFinding({
      code: 'PSR005', validator: 'pathScopedRules', severity: 'warn', disposition: 'escalate', confidence: 'high',
      message: lineEndingsOnly
        ? `${doc.path} differs from the copy Spec Kit installed (${integration} integration${version ? ` ${version}` : ''}) only in line endings (CRLF): a checkout with core.autocrlf converted it; mark it \`text eol=lf\` in .gitattributes`
        : `${doc.path} differs from the copy Spec Kit installed (${integration} integration${version ? ` ${version}` : ''}); reinstall it or move the change to an authored file`,
      location: { file: doc.path },
      suggestion: { kind: 'review', text: `Reinstall the ${integration} integration (specify integration install ${integration}) to restore the installed copy, or keep the change in a file the project owns: an edit here is lost on the next install` },
    }));
  }

  // ── PSR006: a copy shares an instruction file's name (spec 099 FR-003) ──
  let copyFindings = 0;
  for (const c of copies) {
    total++;
    if (++copyFindings > MAX_COPY_FINDINGS) continue;
    const base = basename(c.path);
    const template = c.copy.kind === 'template';
    findings.push(mkFinding({
      code: 'PSR006', validator: 'pathScopedRules', severity: 'warn',
      disposition: template ? 'act' : 'escalate', confidence: template ? 'high' : 'low',
      message: `${c.path} is a ${template ? 'template' : 'test, fixture or example'} copy (under \`${c.copy.segment}/\`) with the same name as ${c.governing}: an agent searching the repository for ${c.name} may read it as this project's instructions`,
      location: { file: c.path },
      suggestion: template
        ? { kind: 'fix', text: `Rename it to ${base}.template and have whatever writes it out drop the suffix. If it does govern its folder, list it in fileKinds.own` }
        : { kind: 'review', text: `Rename it to ${base}.template and have the test copy it into place, or, if the fixture needs the name, list it in .docguardignore with a reason. If it does govern its folder, list it in fileKinds.own` },
    }));
  }
  if (copyFindings > MAX_COPY_FINDINGS) limitations.push(`${copyFindings - MAX_COPY_FINDINGS} more instruction copies not listed`);

  const passed = Math.max(0, total - findings.length);
  const result = {
    ...resultFromFindings(findings, { passed, total }),
    ...contractFields({
      performed: total,
      found: findings.length > 0,
      ran: `${total} scope, pointer, import, vendored-copy and same-name-copy check(s) over ${instructionFiles.length} instruction file(s)`,
      decide: () => ({ applies: false, evidence: `${entries.length} agent-instruction file(s) but none carries a path scope, a path pointer, an @import or a vendored copy, and no copy shares an instruction file's name` }),
      empty: d => ({ emptyCause: 'nothing-of-this-kind', note: `Path-Scoped-Rules read ${entries.length} instruction file(s) and found nothing to check: ${d.evidence}.`, howToConfigure: NOTHING_HOW }),
    }),
  };
  if (limitations.length) result.applicability = { status: 'partial', reason: limitations.join('; ') };
  result.instructionFiles = instructionFiles.length;
  return result;
}

/**
 * Template, test, fixture and example copies that share an instruction file's
 * name with a file that governs this project (spec 099 FR-003). Names are the
 * root instruction files' basenames, `.github/copilot-instructions.md` by path
 * tail, and each `requiredFiles.agentFile` basename. A governing file is a root
 * file, a nested file that is not a copy, or one `fileKinds.own`
 * names. `files` is already filtered by `.docguardignore` and `ignore`.
 *
 * @implements docguard.instruction-copies#FR-003
 * @returns {{ path: string, name: string, governing: string, copy: { kind, segment } }[]}
 */
export function instructionCopies(files, config = {}) {
  const tails = ROOT_AGENT_FILES.filter(n => n.includes('/'));
  const names = new Set(ROOT_AGENT_FILES.filter(n => !n.includes('/')));
  const configured = Array.isArray(config.requiredFiles?.agentFile) ? config.requiredFiles.agentFile : [config.requiredFiles?.agentFile];
  for (const p of configured) if (typeof p === 'string' && p.trim()) names.add(basename(p.trim()));
  const nameOf = f => tails.find(t => f === t || f.endsWith(`/${t}`)) || (names.has(basename(f)) ? basename(f) : null);
  const groups = new Map();
  for (const path of files) {
    const name = nameOf(path);
    if (!name) continue;
    const group = groups.get(name) || { governing: [], copies: [] };
    const copy = fileKind(path, config, INSTRUCTION_COPY);
    if (copy.kind !== 'own') group.copies.push({ path, copy });
    else group.governing.push(path);
    groups.set(name, group);
  }
  const out = [];
  for (const [name, group] of groups) {
    if (!group.governing.length || !group.copies.length) continue;
    // Name the root file when there is one, else the shallowest governing file.
    const governing = [...group.governing].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))[0];
    for (const c of group.copies) out.push({ path: c.path, name, governing, copy: c.copy });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
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
