/**
 * Instruction scopes — which agent instruction files apply to which paths,
 * per harness (specs/033-path-scoped-rules).
 *
 * Each harness loads instructions by its own rules. The formats below were
 * checked against each vendor's documentation on 2026-09-30 and are recorded
 * in docs/ai-integration.md:
 *
 *   codex     AGENTS.override.md or AGENTS.md per directory, root to leaf.
 *   claude    CLAUDE.md / CLAUDE.local.md per directory (AGENTS.md only when
 *             no CLAUDE file exists up the chain); .claude/rules/**.md with
 *             `paths:` (list or comma string; none = always; unparseable
 *             frontmatter loads the rule as if it had none); skills with
 *             `paths:`.
 *   cursor    .cursor/rules/**.mdc at any depth (`.md` there is ignored):
 *             `alwaysApply: true`, or `globs:` (comma string); nested AGENTS.md.
 *   copilot   .github/copilot-instructions.md always; .github/instructions/
 *             **.instructions.md with `applyTo:` (comma string); nearest AGENTS.md.
 *   openhands .agents/skills, .openhands/skills (SKILL.md) and legacy
 *             .openhands/microagents with `paths:`; a slashless pattern matches
 *             the basename at any depth; root AGENTS.md and CLAUDE.md always.
 *
 * @implements docguard.path-scoped-rules#FR-001
 * @implements docguard.path-scoped-rules#FR-002
 * @implements docguard.path-scoped-rules#FR-008
 */

import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, posix, resolve, relative, sep } from 'node:path';
import { readFrontmatter } from './frontmatter.mjs';
import { buildIgnoreFilter, compileGlob, DEFAULT_IGNORE_DIRS, loadDocguardIgnore } from '../shared-ignore.mjs';

export const HARNESSES = Object.freeze(['codex', 'claude', 'cursor', 'copilot', 'openhands']);
export const MAX_INSTRUCTION_FILES = 200;
const GENERATED_MARKER = 'docguard:agents-sync';
const AGENTS_NAMES = new Set(['AGENTS.md', 'AGENTS.override.md']);
const HARNESS_DIRS = new Set(['.claude', '.cursor', '.github', '.agents', '.openhands']);
const MAX_WALK_ENTRIES = 100_000;
const HARNESS_LABEL = { codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', copilot: 'GitHub Copilot', openhands: 'OpenHands' };

const dirOf = file => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const within = (path, dir) => dir === '' || path === dir || path.startsWith(`${dir}/`);

/** The kind of instruction file a project-relative POSIX path is, or null. */
export function instructionKind(file) {
  const name = basename(file);
  if (AGENTS_NAMES.has(name)) return 'agents';
  if (name === 'CLAUDE.md' || name === 'CLAUDE.local.md') return 'claude-memory';
  if (/^\.claude\/rules\/.+\.md$/.test(file)) return 'claude-rule';
  if (/(^|\/)\.claude\/skills\/[^/]+\/SKILL\.md$/.test(file)) return 'claude-skill';
  if (/(^|\/)\.cursor\/rules\/.+\.mdc$/.test(file)) return 'cursor-rule';
  if (/(^|\/)\.cursor\/rules\/.+\.md$/.test(file)) return 'cursor-ignored';
  if (file === '.github/copilot-instructions.md') return 'copilot-repo';
  if (/^\.github\/instructions\/.+\.instructions\.md$/.test(file)) return 'copilot-rule';
  if (/^(\.agents|\.openhands)\/skills\/[^/]+\/SKILL\.md$/.test(file)) return 'openhands-skill';
  if (/^\.openhands\/microagents\/.+\.md$/.test(file)) return 'openhands-legacy';
  return null;
}

/**
 * Compile one scope pattern. `semantics: 'basename'` (OpenHands) matches a
 * slashless pattern against the file name at any depth. Syntax the shared
 * matcher cannot represent is reported, never compiled into a pattern that
 * silently matches nothing (FR-008).
 */
export function compileScopePattern(raw, semantics = 'anchored') {
  let pattern = String(raw).trim().replace(/^\.\//, '').replace(/^\//, '');
  if (!pattern) return { ok: false, pattern: raw, reason: 'empty pattern' };
  if (pattern.startsWith('!')) return { ok: false, pattern: raw, reason: 'negation (!) is not documented by any harness and is not evaluated' };
  if (/[[\]]/.test(pattern)) return { ok: false, pattern: raw, reason: 'character classes ([...]) are not evaluated by DocGuard' };
  if (/\{[^}]*\{/.test(pattern)) return { ok: false, pattern: raw, reason: 'nested braces are not evaluated by DocGuard' };
  if (pattern.endsWith('/')) pattern += '**';
  const byName = semantics === 'basename' && !pattern.includes('/');
  const re = compileGlob(pattern);
  return { ok: true, pattern: raw, test: path => re.test(byName ? basename(path) : path) };
}

/** A scope field's value as a list of patterns: YAML list or comma string. */
function patternList(value) {
  if (Array.isArray(value)) return value.every(v => typeof v === 'string') ? value : null;
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  return null;
}

/**
 * Derive every (file, harness) scope entry from a list of project-relative
 * files. Reads each instruction file once; bounded to MAX_INSTRUCTION_FILES.
 *
 * @returns {{ entries: object[], files: string[], skipped: number }}
 */
export function instructionScopes(projectDir, files, { local = new Set() } = {}) {
  const found = files.filter(f => instructionKind(f)).sort();
  const checked = found.slice(0, MAX_INSTRUCTION_FILES);
  const entries = [];
  for (const file of checked) {
    const kind = instructionKind(file);
    let content = '';
    let bytes = 0;
    try {
      const full = resolve(projectDir, file);
      if (!lstatSync(full).isFile()) continue;
      content = readFileSync(full, 'utf-8');
      bytes = statSync(full).size;
    } catch { continue; }
    const base = { file, kind, bytes, local: local.has(file), generated: content.includes(GENERATED_MARKER), content };
    const dir = dirOf(file);
    const add = (harness, scope) => entries.push({ ...base, harness, ...scope });

    if (kind === 'agents') {
      for (const harness of ['codex', 'cursor', 'copilot', 'claude']) add(harness, { scope: 'directory', dir });
      if (dir === '') add('openhands', { scope: 'always' });
      continue;
    }
    if (kind === 'claude-memory') {
      // `.claude/CLAUDE.md` belongs to the directory that holds `.claude/`.
      add('claude', { scope: 'directory', dir: dir.replace(/(^|\/)\.claude$/, '') });
      if (dir === '' && basename(file) === 'CLAUDE.md') add('openhands', { scope: 'always' });
      continue;
    }
    if (kind === 'copilot-repo') { add('copilot', { scope: 'always' }); continue; }
    if (kind === 'cursor-ignored') {
      add('cursor', { scope: 'not-loaded', issues: [{ severity: 'warn', line: 1, field: null, message: 'Cursor ignores .md files in .cursor/rules; only .mdc rules load', fix: `rename to ${file.replace(/\.md$/, '.mdc')}` }] });
      continue;
    }

    const fm = readFrontmatter(content);
    const spec = {
      'claude-rule': { harness: 'claude', field: 'paths', whenAbsent: 'always', semantics: 'anchored' },
      'claude-skill': { harness: 'claude', field: 'paths', whenAbsent: 'not-path-scoped', semantics: 'anchored' },
      'cursor-rule': { harness: 'cursor', field: 'globs', whenAbsent: 'not-path-scoped', semantics: 'anchored' },
      'copilot-rule': { harness: 'copilot', field: 'applyTo', whenAbsent: 'not-path-scoped', semantics: 'anchored' },
      'openhands-skill': { harness: 'openhands', field: 'paths', whenAbsent: 'not-path-scoped', semantics: 'basename' },
      'openhands-legacy': { harness: 'openhands', field: 'paths', whenAbsent: 'always', semantics: 'basename' },
    }[kind];
    const issues = [];
    const fieldLine = fm.lines[spec.field] || 1;
    // Frontmatter-level failures and errors on the keys a harness reads.
    const readKeys = new Set([spec.field, 'alwaysApply', 'triggers']);
    const blocking = fm.issues.filter(i => i.key === null || readKeys.has(i.key));
    for (const issue of blocking) {
      issues.push({ severity: 'warn', line: issue.line, field: issue.key, message: issue.message, fix: issue.fix });
    }
    if (kind === 'claude-rule' && blocking.length) {
      issues.push({ severity: 'warn', line: fieldLine, field: spec.field, message: 'Claude Code loads a rule whose frontmatter does not parse as if it had no paths: for every file' });
    }
    if (blocking.length) { add(spec.harness, { scope: 'unknown', field: spec.field, fieldLine, issues }); continue; }

    const data = fm.data;
    // A scope key another harness reads is ignored by this one: the author
    // meant to scope the rule, and the harness loads it by its own default.
    const foreign = ['paths', 'globs', 'applyTo'].filter(k => k !== spec.field && Object.hasOwn(fm.lines, k));
    if (foreign.length && !Object.hasOwn(data, spec.field)) {
      const effect = spec.whenAbsent === 'always' ? 'loads it for every file' : 'does not load it by path';
      issues.push({ severity: 'warn', line: fm.lines[foreign[0]], field: foreign[0], message: `${HARNESS_LABEL[spec.harness]} reads \`${spec.field}:\`, not \`${foreign[0]}:\`, so it ignores this scope and ${effect}`, fix: `rename ${foreign[0]}: to ${spec.field}:` });
    }
    if (kind === 'cursor-rule' && Object.hasOwn(data, 'alwaysApply') && typeof data.alwaysApply !== 'boolean') {
      issues.push({ severity: 'warn', line: fm.lines.alwaysApply, field: 'alwaysApply', message: `alwaysApply must be true or false, not ${JSON.stringify(data.alwaysApply)}` });
      add(spec.harness, { scope: 'unknown', field: 'alwaysApply', fieldLine: fm.lines.alwaysApply, issues });
      continue;
    }
    if (kind === 'cursor-rule' && data.alwaysApply === true) { add('cursor', { scope: 'always', field: 'alwaysApply', fieldLine: fm.lines.alwaysApply }); continue; }
    // OpenHands: `paths:` wins over `triggers:`; triggers alone is keyword-activated.
    if (!Object.hasOwn(data, spec.field) || data[spec.field] === null) {
      const legacyTriggered = kind === 'openhands-legacy' && Object.hasOwn(data, 'triggers');
      add(spec.harness, { scope: legacyTriggered ? 'not-path-scoped' : spec.whenAbsent, field: spec.field, fieldLine, issues });
      continue;
    }
    const list = patternList(data[spec.field]);
    if (!list) {
      issues.push({ severity: 'warn', line: fieldLine, field: spec.field, message: `${spec.field} must be a string or a list of strings, not ${JSON.stringify(data[spec.field])}` });
      add(spec.harness, { scope: 'unknown', field: spec.field, fieldLine, issues });
      continue;
    }
    if (kind === 'copilot-rule' && list.length === 1 && list[0] === '**') {
      add('copilot', { scope: 'always', field: spec.field, fieldLine });
      continue;
    }
    const globs = list.map(p => compileScopePattern(p, spec.semantics));
    // Valid for the harness, but not something DocGuard evaluates: a coverage
    // gap, reported as partial, never as a defect in the rule.
    const unsupported = globs.filter(g => !g.ok);
    const unevaluated = unsupported.map(g => `${JSON.stringify(g.pattern)} (${g.reason})`);
    // A nested `.cursor/rules` directory: evaluate from its own directory and
    // from the root, since Cursor does not document which one it uses.
    const cursorBase = kind === 'cursor-rule' ? file.slice(0, file.indexOf('.cursor/rules/')).replace(/\/$/, '') : '';
    add(spec.harness, {
      scope: unsupported.length ? 'unknown' : 'globs',
      field: spec.field, fieldLine, globs, base: cursorBase, issues, unevaluated,
    });
  }
  return { entries, files: checked, skipped: Math.max(0, found.length - checked.length) };
}

/** True when a glob entry matches `path`. */
function globsMatch(entry, path) {
  const candidates = entry.base && within(path, entry.base) ? [path, path.slice(entry.base.length + 1)] : [path];
  return entry.globs.some(g => g.ok && candidates.some(c => g.test(c)));
}

/**
 * The instruction files one harness loads for `path`, in load order, with the
 * reason each applies. `path` need not exist: scope is a pattern match.
 *
 * @returns {{ file, reason, bytes, local }[]}
 */
export function applicableFor(entries, harness, path) {
  const mine = entries.filter(e => e.harness === harness);
  const chainDirs = dir => mine.filter(e => e.scope === 'directory' && within(path, e.dir))
    .sort((a, b) => a.dir.split('/').filter(Boolean).length - b.dir.split('/').filter(Boolean).length || a.file.localeCompare(b.file));
  const out = [];
  const push = (e, reason) => out.push({ file: e.file, reason, bytes: e.bytes, local: e.local });

  let chain = chainDirs();
  if (harness === 'codex' || harness === 'cursor' || harness === 'copilot' || harness === 'claude') {
    const agents = chain.filter(e => e.kind === 'agents');
    // One file per directory: AGENTS.override.md replaces AGENTS.md.
    const perDir = new Map();
    for (const e of agents) {
      const current = perDir.get(e.dir);
      if (!current || basename(e.file) === 'AGENTS.override.md') perDir.set(e.dir, e);
    }
    let agentChain = [...perDir.values()];
    if (harness === 'copilot') agentChain = agentChain.slice(-1); // the nearest one wins
    if (harness === 'cursor' || harness === 'copilot') agentChain = agentChain.filter(e => basename(e.file) === 'AGENTS.md');
    if (harness === 'claude') {
      const memory = chain.filter(e => e.kind === 'claude-memory');
      // Claude Code reads AGENTS.md only when no CLAUDE file exists up the chain.
      chain = memory.length ? memory : agentChain.filter(e => basename(e.file) === 'AGENTS.md');
    } else chain = agentChain;
  }
  const alwaysFirst = harness === 'copilot' || harness === 'openhands';
  const always = mine.filter(e => e.scope === 'always').sort((a, b) => a.file.localeCompare(b.file));
  const matched = mine.filter(e => e.scope === 'globs' && globsMatch(e, path)).sort((a, b) => a.file.localeCompare(b.file));
  if (alwaysFirst) always.forEach(e => push(e, 'always'));
  chain.forEach(e => push(e, e.dir === '' ? 'directory: project root' : `directory: ${e.dir}/`));
  if (!alwaysFirst) always.forEach(e => push(e, 'always'));
  for (const e of matched) {
    const hit = e.globs.find(g => g.ok && (g.test(path) || (e.base && within(path, e.base) && g.test(path.slice(e.base.length + 1)))));
    push(e, `${e.field}: ${hit.pattern}`);
  }
  for (const e of mine.filter(e => e.scope === 'unknown')) {
    push(e, e.unevaluated?.length ? 'unknown scope (pattern DocGuard does not evaluate)'
      : e.kind === 'claude-rule' ? 'unknown scope (unreadable frontmatter: Claude Code loads it for every file)' : 'unknown scope (see PSR004)');
  }
  return out;
}

/**
 * Validate a path argument or pointer target: project-relative, no `..`, no
 * absolute path, and no symlink leaving the project (FR-006).
 * @returns {string|null} the normalized POSIX path, or null when refused.
 */
export function safeProjectPath(projectDir, input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  const raw = input.trim().replace(/\\/g, '/');
  if (isAbsolute(input) || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) return null;
  const norm = posix.normalize(raw).replace(/^\.\//, '').replace(/\/$/, '');
  if (norm === '..' || norm.startsWith('../') || norm.split('/').includes('..')) return null;
  // A path that exists must stay inside the project after following links.
  try {
    const root = realpathSync(projectDir);
    let cursor = root;
    for (const part of norm.split('/')) {
      cursor = resolve(cursor, part);
      let st;
      try { st = lstatSync(cursor); } catch { break; } // does not exist from here on
      if (st.isSymbolicLink()) {
        const rel = relative(root, realpathSync(cursor));
        if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return null;
      }
    }
  } catch { return null; }
  return norm === '.' ? '' : norm;
}

/**
 * Instruction files present on disk, including untracked and git-ignored ones,
 * for `rules --for`: a machine-local rule still loads. Symlinks are not
 * followed; dependency, build and VCS directories, other dot-directories than
 * the harness ones, and `.claude/worktrees` (whole checkouts) are skipped;
 * `.docguardignore` applies. Bounded to MAX_WALK_ENTRIES.
 *
 * @returns {{ files: string[], complete: boolean }}
 */
export function instructionFilesOnDisk(projectDir) {
  const root = resolve(projectDir);
  const ignored = buildIgnoreFilter(loadDocguardIgnore(projectDir));
  const out = [];
  let visited = 0;
  let complete = true;
  const walk = (abs, rel) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { complete = false; return; }
    for (const entry of entries) {
      if (++visited > MAX_WALK_ENTRIES) { complete = false; return; }
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || ignored(childRel)) continue;
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(entry.name) || childRel === '.claude/worktrees') continue;
        if (entry.name.startsWith('.') && !HARNESS_DIRS.has(entry.name)) continue;
        walk(resolve(abs, entry.name), childRel);
      } else if (entry.isFile() && instructionKind(childRel)) out.push(childRel);
    }
  };
  walk(root, '');
  return { files: out.sort(), complete };
}
