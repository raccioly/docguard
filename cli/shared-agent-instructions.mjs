/**
 * The agent-instruction document role (specs/094-agent-instruction-role).
 *
 * One place decides which files are agent instructions, which of them every
 * session loads (root-level), which only point at another file, and which
 * were installed by a tool rather than written by the project. Every reader
 * that used to keep its own list of AGENTS.md / CLAUDE.md / GEMINI.md asks
 * here instead.
 *
 * Kinds come from `instructionKind` (checked against each harness's
 * documentation for docguard.path-scoped-rules) plus GEMINI.md, DocGuard's
 * generic `.agent/skills/` install directory and `requiredFiles.agentFile`.
 *
 * @implements docguard.agent-instruction-role#FR-001
 * @implements docguard.agent-instruction-role#FR-002
 * @implements docguard.agent-instruction-role#FR-004
 * @implements docguard.agent-instruction-role#FR-006
 */

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claudeImportsIn, instructionFilesOnDisk, instructionKind, MAX_IMPORT_HOPS, MAX_INSTRUCTION_FILES, safeProjectPath,
} from './scanners/instruction-scopes.mjs';
import { listTrackedFiles } from './shared-git.mjs';
import { buildIgnoreFilter, isNonProductPath, loadDocguardIgnore } from './shared-ignore.mjs';

/** Files a harness loads from the project root for every session. */
export const ROOT_AGENT_FILES = Object.freeze([
  'AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md',
]);

/** A pointer's body, once headings, comments and blank lines are removed, is at most this many lines. */
export const POINTER_MAX_BODY_LINES = 6;
/** ...and at most this many of them say something other than naming the file it points to. */
export const POINTER_MAX_OWN_LINES = 2;
const NAMES_A_FILE = /(^|\s)@\S+\.[A-Za-z0-9]+|\]\([^)\s]+\)|`[^`\s]+\.mdc?`/;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MANIFEST_DIR = '.specify/integrations';

const __dirname = dirname(fileURLToPath(import.meta.url));
let docguardSkillNames = null;
/** Skill directory names DocGuard ships (and installs into harness skill directories). */
function shippedSkillNames() {
  if (docguardSkillNames) return docguardSkillNames;
  try {
    docguardSkillNames = new Set(readdirSync(resolve(__dirname, '..', 'extensions', 'spec-kit-docguard', 'skills'), { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name));
  } catch { docguardSkillNames = new Set(); }
  return docguardSkillNames;
}

/** The role kind of a project-relative POSIX path, or null. */
export function agentInstructionKind(path) {
  const kind = instructionKind(path);
  if (kind && kind !== 'cursor-ignored') return kind;
  if (basename(path) === 'GEMINI.md') return 'gemini-memory';
  if (/^\.agent\/skills\/[^/]+\/SKILL\.md$/.test(path)) return 'generic-skill';
  return null;
}

const isRegularFile = abs => { try { return lstatSync(abs).isFile(); } catch { return false; } };
const isDirectory = abs => { try { return lstatSync(abs).isDirectory(); } catch { return false; } };

/** The skill directory name of a SKILL.md path, or null. */
function skillName(path) {
  const m = path.match(/(?:^|\/)skills\/([^/]+)\/SKILL\.md$/);
  return m ? m[1] : null;
}

function safeManifestPath(path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || path.includes('\\')) return null;
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return null;
  const norm = posix.normalize(path.replace(/^\.\//, ''));
  if (norm === '..' || norm.startsWith('../') || norm.split('/').includes('..')) return null;
  return norm;
}

/**
 * Spec Kit integration manifests: path → [{ integration, version, hash }].
 * A manifest that is a symlink, too large or not JSON vendors nothing and is
 * reported as a limitation, never as a finding.
 */
export function readIntegrationManifests(projectDir) {
  const vendored = new Map();
  const limitations = [];
  let entries = [];
  try { entries = readdirSync(resolve(projectDir, MANIFEST_DIR), { withFileTypes: true }); } catch { return { vendored, limitations }; }
  for (const entry of entries.filter(e => e.name.endsWith('.manifest.json')).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${MANIFEST_DIR}/${entry.name}`;
    let data;
    try {
      if (!entry.isFile()) throw new Error('not a regular file');
      const abs = resolve(projectDir, rel);
      if (lstatSync(abs).size > MAX_MANIFEST_BYTES) throw new Error('larger than 1 MiB');
      data = JSON.parse(readFileSync(abs, 'utf-8'));
      if (!data || typeof data !== 'object' || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) throw new Error('no files map');
    } catch (err) {
      limitations.push(`${rel} could not be read (${err.message.split('\n')[0]}); its files are treated as authored`);
      continue;
    }
    const integration = typeof data.integration === 'string' ? data.integration : entry.name.replace(/\.manifest\.json$/, '');
    const version = typeof data.version === 'string' ? data.version : null;
    for (const [raw, hash] of Object.entries(data.files)) {
      const path = safeManifestPath(raw);
      if (!path) continue;
      const list = vendored.get(path) || [];
      list.push({ integration, version, hash: typeof hash === 'string' && /^[0-9a-f]{64}$/i.test(hash) ? hash.toLowerCase() : null });
      vendored.set(path, list);
    }
  }
  return { vendored, limitations };
}

/**
 * Spec Kit's own command skills (`speckit-<command>`), which every Spec Kit
 * integration installs. Older Spec Kit layouts (and the generic `.agent/`
 * one) record no manifest, so a project with a `.specify/` directory treats
 * these names as Spec Kit's. Checked against Spec Kit 1.1.3's commands.
 */
export const SPEC_KIT_CORE_SKILLS = Object.freeze(new Set([
  'speckit-analyze', 'speckit-checklist', 'speckit-clarify', 'speckit-constitution', 'speckit-converge',
  'speckit-implement', 'speckit-plan', 'speckit-specify', 'speckit-tasks', 'speckit-taskstoissues',
]));

/**
 * Skills Spec Kit registered for its extensions (`.specify/extensions/.registry`):
 * each `registered_skills` name, and each `registered_commands` id rendered as
 * a skill directory (`speckit.docguard.guard` → `speckit-docguard-guard`).
 * @returns {{ skills: Map<string, {extension, version}>, limitations: string[] }}
 */
export function readExtensionRegistry(projectDir) {
  const skills = new Map();
  const rel = '.specify/extensions/.registry';
  const abs = resolve(projectDir, rel);
  let data;
  try {
    const st = lstatSync(abs);
    if (!st.isFile()) throw new Error('not a regular file');
    if (st.size > MAX_MANIFEST_BYTES) throw new Error('larger than 1 MiB');
    data = JSON.parse(readFileSync(abs, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { skills, limitations: [] };
    return { skills, limitations: [`${rel} could not be read (${err.message.split('\n')[0]}); extension skills are treated as authored`] };
  }
  const extensions = data && typeof data.extensions === 'object' && !Array.isArray(data.extensions) ? data.extensions : {};
  for (const [extension, entry] of Object.entries(extensions)) {
    if (!entry || typeof entry !== 'object') continue;
    const version = typeof entry.version === 'string' ? entry.version : null;
    const names = [];
    if (Array.isArray(entry.registered_skills)) names.push(...entry.registered_skills);
    const commands = entry.registered_commands && typeof entry.registered_commands === 'object' ? entry.registered_commands : {};
    for (const list of Object.values(commands)) if (Array.isArray(list)) names.push(...list.map(c => (typeof c === 'string' ? c.replace(/\./g, '-') : c)));
    for (const name of names) {
      if (typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && !skills.has(name)) skills.set(name, { extension, version });
    }
  }
  return { skills, limitations: [] };
}

/**
 * The tool named by a `<!-- generated by <tool> ... -->` comment in the first
 * lines of a file (after frontmatter), or null. A tool that writes such a
 * header owns the file and rewrites it on refresh.
 */
export function generatedBy(content) {
  const head = String(content).replace(/^---\n[\s\S]*?\n---\n?/, '').split('\n').slice(0, 5).join('\n');
  const m = head.match(/<!--\s*(?:auto-)?generated\s+by\s+([A-Za-z0-9@._/-]+)/i);
  if (!m) return null;
  // "edit freely, then delete this line" hands ownership to the project.
  if (/delete this line|edit freely/i.test(head.slice(m.index, head.indexOf('-->', m.index) + 3))) return null;
  return m[1];
}

/** Body lines of an instruction file: no frontmatter, headings, HTML comments or blank lines. */
function bodyLines(content) {
  let text = String(content).replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/<!--[\s\S]*?-->/g, '');
  return text.split('\n').map(l => l.trim()).filter(l => l && !/^#{1,6}\s/.test(l));
}

/** Files a short instruction file names: `@path` imports, Markdown links, backticked `.md`/`.mdc` paths. */
function namedFiles(path, content) {
  const named = [];
  const from = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const add = (raw, via) => {
    const clean = String(raw).replace(/^\.\//, '').replace(/[#?].*$/, '');
    if (!clean || /^[a-z]+:/i.test(clean) || clean.startsWith('~') || clean.startsWith('/')) return;
    for (const candidate of [posix.normalize(posix.join(from, clean)), posix.normalize(clean)]) {
      if (candidate === '..' || candidate.startsWith('../')) continue;
      named.push({ path: candidate, via });
    }
  };
  for (const { path: p } of claudeImportsIn(content)) add(p, 'import');
  const prose = String(content).replace(/^\s{0,3}(`{3,}|~{3,})[\s\S]*?^\s{0,3}\1/gm, '');
  for (const m of prose.matchAll(/\]\(([^)\s]+)\)/g)) add(m[1], 'link');
  for (const m of prose.matchAll(/`([^`\s]+\.mdc?)`/g)) add(m[1], 'path');
  return named;
}

const memo = new WeakMap();

/**
 * Every document in the role. Root files count when they exist on disk (as
 * the readers this replaces did); other files must be tracked, not ignored
 * and not under test, fixture or example paths.
 *
 * @returns {{ docs: { path, kind, root, pointer, vendored }[], limitations: string[] }}
 */
export function agentInstructionDocs(projectDir, config = {}) {
  const key = config && typeof config === 'object' ? config : {};
  const byDir = memo.get(key) || new Map();
  const abs = resolve(projectDir);
  if (byDir.has(abs)) return byDir.get(abs);
  const result = computeDocs(abs, key);
  byDir.set(abs, result);
  memo.set(key, byDir);
  return result;
}

function computeDocs(projectDir, config) {
  const limitations = [];
  const ignored = buildIgnoreFilter([...(config.ignore || []), ...loadDocguardIgnore(projectDir)]);
  const configured = (Array.isArray(config.requiredFiles?.agentFile) ? config.requiredFiles.agentFile
    : config.requiredFiles?.agentFile ? [config.requiredFiles.agentFile] : [])
    .map(p => (typeof p === 'string' ? safeProjectPath(projectDir, p) : null)).filter(Boolean);

  let candidates = listTrackedFiles(projectDir);
  if (candidates === null) {
    limitations.push('git unavailable: listed instruction files from the working tree instead of tracked files');
    candidates = instructionFilesOnDisk(projectDir).files;
  }
  const found = new Map();
  const consider = (path, kind, root) => {
    if (found.has(path) || ignored(path)) return;
    if (!root && isNonProductPath(path, config)) return;
    if (!isRegularFile(resolve(projectDir, path))) return;
    found.set(path, { path, kind, root });
  };
  for (const path of ROOT_AGENT_FILES) consider(path, agentInstructionKind(path), true);
  for (const path of configured) consider(path, 'configured', true);
  const others = candidates.filter(p => agentInstructionKind(p)).sort();
  let skipped = 0;
  for (const path of others) {
    if (found.size >= MAX_INSTRUCTION_FILES && !found.has(path)) { skipped++; continue; }
    consider(path, agentInstructionKind(path), false);
  }
  if (skipped) limitations.push(`${skipped} instruction files past the first ${MAX_INSTRUCTION_FILES} were not listed`);

  const manifests = readIntegrationManifests(projectDir);
  limitations.push(...manifests.limitations);
  const registry = readExtensionRegistry(projectDir);
  limitations.push(...registry.limitations);
  const specKitProject = isDirectory(resolve(projectDir, '.specify'));
  const shipped = shippedSkillNames();
  const contents = new Map();
  const read = path => {
    if (!contents.has(path)) { try { contents.set(path, readFileSync(resolve(projectDir, path), 'utf-8')); } catch { contents.set(path, ''); } }
    return contents.get(path);
  };

  const docs = [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
  for (const doc of docs) {
    const fromManifest = manifests.vendored.get(doc.path);
    if (fromManifest) {
      const first = fromManifest[0];
      doc.vendored = { source: `spec-kit:${first.integration}`, reason: 'install manifest', integration: first.integration, version: first.version,
        hashes: fromManifest.map(m => m.hash).filter(Boolean), installs: fromManifest };
    } else if (!doc.root && generatedBy(read(doc.path))) {
      doc.vendored = { source: `generated:${generatedBy(read(doc.path))}`, reason: 'generated-by header' };
    } else if (!doc.root && registry.skills.has(skillName(doc.path))) {
      const { extension, version } = registry.skills.get(skillName(doc.path));
      doc.vendored = { source: `spec-kit-extension:${extension}`, reason: 'extension registry', extension, version };
    } else if (!doc.root && specKitProject && SPEC_KIT_CORE_SKILLS.has(skillName(doc.path))) {
      doc.vendored = { source: 'spec-kit', reason: 'Spec Kit core skill name' };
    } else if (!doc.root && shipped.has(skillName(doc.path))) {
      doc.vendored = { source: 'docguard', reason: 'DocGuard-shipped skill name' };
    } else {
      doc.vendored = null;
    }
  }

  // Pointers: a short body that imports a file or names another role document.
  const inRole = new Map(docs.map(d => [d.path, d]));
  const direct = new Map();
  for (const doc of docs) {
    doc.pointer = null;
    const content = read(doc.path);
    const body = bodyLines(content);
    if (body.length > POINTER_MAX_BODY_LINES) continue;
    // A short file with instructions of its own (commands, rules) is not a pointer.
    if (body.filter(line => !NAMES_A_FILE.test(line)).length > POINTER_MAX_OWN_LINES) continue;
    const named = namedFiles(doc.path, content).filter(n => n.path !== doc.path);
    const roleHit = named.find(n => inRole.has(n.path));
    const imported = named.find(n => n.via === 'import');
    if (!roleHit && !imported) continue;
    direct.set(doc.path, roleHit || { path: null, via: imported.via });
  }
  for (const [path, first] of direct) {
    let target = first.path;
    const seen = new Set([path]);
    for (let hop = 0; target && direct.has(target) && hop < MAX_IMPORT_HOPS; hop++) {
      if (seen.has(target)) { target = null; break; }
      seen.add(target);
      target = direct.get(target).path;
    }
    if (target && (seen.has(target) || direct.has(target))) target = null;
    inRole.get(path).pointer = { target, via: first.via };
  }
  return { docs, limitations };
}

/** Root-level, non-vendored role documents: what every harness session loads. */
export function rootAgentDocs(projectDir, config = {}) {
  return agentInstructionDocs(projectDir, config).docs.filter(d => d.root && !d.vendored).map(d => d.path);
}

/** sha256 of a file's bytes, or null when it cannot be read. */
export function fileSha256(projectDir, path, { normalizeLineEndings = false } = {}) {
  try {
    let bytes = readFileSync(resolve(projectDir, path));
    if (normalizeLineEndings) bytes = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
    return createHash('sha256').update(bytes).digest('hex');
  } catch { return null; }
}
