/** Explicit document roles let existing repository layouts serve as canonical input. */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, isAbsolute, join } from 'node:path';
export const DOC_ROLES = Object.freeze({
  architecture: 'docs-canonical/ARCHITECTURE.md', dataModel: 'docs-canonical/DATA-MODEL.md',
  security: 'docs-canonical/SECURITY.md', testSpec: 'docs-canonical/TEST-SPEC.md',
  environment: 'docs-canonical/ENVIRONMENT.md', apiReference: 'docs-canonical/API-REFERENCE.md',
  requirements: 'docs-canonical/REQUIREMENTS.md',
});
export function docRolePath(config = {}, role) {
  if (!Object.hasOwn(DOC_ROLES, role)) throw new Error('Unknown document role: ' + role);
  const value = config.docs?.roles?.[role] ?? DOC_ROLES[role];
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error('Invalid document path for role: ' + role);
  const path = value.replace(/\\/g, '/');
  if (config.docs?.roles?.[role] !== undefined && !path.toLowerCase().endsWith('.md')) throw new Error('Mapped document roles currently require Markdown (.md): ' + role);
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split('/').some(p => p === '..' || p.toLowerCase() === '.local' || p.toLowerCase() === '.git')) throw new Error('Document role path must stay within the project: ' + role);
  return path.startsWith('./') ? path.slice(2) : path;
}
export function resolveDocRole(projectDir, config, role) {
  const rel = docRolePath(config, role);
  // Opt-in mappings must not follow links into another repository/private data.
  if (config.docs?.roles?.[role] !== undefined) {
    let current = resolve(projectDir);
    for (const part of rel.split('/')) {
      current = join(current, part);
      try { if (lstatSync(current).isSymbolicLink()) throw new Error('Document role path contains a symlink: ' + role); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
  return resolve(projectDir, rel);
}
export function applyDocRoles(projectDir, config) {
  const roles = config.docs?.roles;
  if (roles === undefined) return config;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) throw new Error('docs.roles must be an object');
  const replacements = new Map();
  for (const role of Object.keys(roles)) {
    resolveDocRole(projectDir, config, role);
    replacements.set(DOC_ROLES[role], docRolePath(config, role));
  }
  const requiredFiles = { ...config.requiredFiles, canonical: [...new Set([...(config.requiredFiles?.canonical || []).map(p => replacements.get(p) || p), ...replacements.values()])] };
  const documentTypes = { ...config.documentTypes };
  for (const [oldPath, newPath] of replacements) {
    const old = documentTypes[oldPath] || {};
    if (oldPath !== newPath) delete documentTypes[oldPath];
    documentTypes[newPath] = { ...old, ...documentTypes[newPath], required: true, category: 'canonical' };
  }
  return { ...config, requiredFiles, documentTypes };
}
export function remapDocPath(config, path) {
  const role = Object.keys(DOC_ROLES).find(key => DOC_ROLES[key] === path);
  return role ? docRolePath(config, role) : path;
}

export function mappedRolesForPath(config = {}, path) {
  const target = String(path).replace(/\\/g, '/').replace(/^\.\//, '');
  return Object.keys(DOC_ROLES).filter(role => {
    const configured = config.docs?.roles?.[role];
    return configured !== undefined && docRolePath(config, role) === target && target !== DOC_ROLES[role];
  });
}

export function isMappedDocPath(config = {}, path) {
  return mappedRolesForPath(config, path).length > 0;
}

/**
 * Authorize a whole-document write to custom role targets. New files are safe;
 * existing files must explicitly grant full ownership and one file cannot be
 * the whole-document target of several roles.
 * @implements docguard.language-repository-coverage#FR-010
 * @implements docguard.language-repository-coverage#FR-011
 */
export function assertMappedFullDocumentWrites(projectDir, config = {}, roles = Object.keys(DOC_ROLES)) {
  const selected = roles.filter(role => Object.hasOwn(DOC_ROLES, role) && config.docs?.roles?.[role] !== undefined
    && docRolePath(config, role) !== DOC_ROLES[role]);
  const paths = new Map();
  for (const role of selected) {
    const rel = docRolePath(config, role);
    if (!paths.has(rel)) paths.set(rel, []);
    paths.get(rel).push(role);
  }
  for (const [rel, owners] of paths) {
    const allOwners = mappedRolesForPath(config, rel);
    if (allOwners.length > 1) {
      throw new Error(`Mapped document ${rel} serves multiple roles (${allOwners.join(', ')}); whole-document generation is unavailable. Use unique source=code sections instead.`);
    }
    const role = owners[0];
    const full = resolveDocRole(projectDir, config, role);
    if (!existsSync(full)) continue;
    const content = readFileSync(full, 'utf8');
    if (!/^[ \t]*<!--\s*docguard:generated\s+true\s*-->[ \t]*$/mi.test(content)) {
      throw new Error(`Mapped document ${rel} is not fully owned by DocGuard. Add unique source=code sections for bounded writes; --force cannot overwrite its prose.`);
    }
  }
}

/** Roles whose document lives somewhere other than its default path. */
export function mappedRoleNames(config = {}) {
  return Object.entries(config.docs?.roles || {})
    .filter(([role, path]) => path !== DOC_ROLES[role])
    .map(([role]) => role)
    .sort();
}

/** Default paths of the roles a mapped layout has moved. */
export function mappedDefaultPaths(config = {}) {
  return new Set(mappedRoleNames(config).map(role => DOC_ROLES[role]));
}

export function assertDefaultDocWrites(config) {
  const mapped = mappedRoleNames(config);
  if (mapped.length) {
    throw new Error('Custom docs.roles currently support validation and read-only planning. '
      + `Automatic document generation/repair is unavailable for mapped layouts (${mapped.join(', ')}); `
      + 'review and edit the existing documents directly. '
      + 'To scaffold DocGuard\'s own layout instead, remove docs.roles from .docguard.json '
      + 'and create docs-canonical/ before re-running.');
  }
}

/** Markdown extensions a canonical document realistically uses. */
const DOC_EXTENSIONS = new Set(['.md', '.markdown', '.mdx']);

/**
 * Names a role is known by in the wild, normalised.
 *
 * Matching the exact default filename only (`DATA-MODEL.md`) missed every real
 * project: the same document ships as `data_model.md`, `datamodel.md`,
 * `Data Model.md`, or `API.md` instead of `API-REFERENCE.md`. Separators, case
 * and extension are all noise, so names are normalised to letters and digits
 * before comparison and every plausible spelling collapses to one key.
 *
 * Kept deliberately tight. A directory has to hold at least two roles before it
 * counts as canonical, so a lone root-level `SECURITY.md` — GitHub's security
 * policy, not a design document — never triggers a match on its own.
 */
const ROLE_SYNONYMS = Object.freeze({
  architecture: ['architecture', 'arch', 'systemdesign', 'design', 'systemarchitecture', 'technicaldesign', 'hld'],
  dataModel:    ['datamodel', 'data', 'schema', 'dataschema', 'entities', 'erd', 'domainmodel', 'database'],
  security:     ['security', 'threatmodel', 'securitymodel', 'securitydesign'],
  testSpec:     ['testspec', 'tests', 'testing', 'testplan', 'teststrategy', 'qa', 'testcases'],
  environment:  ['environment', 'env', 'setup', 'configuration', 'config', 'installation', 'install'],
  apiReference: ['apireference', 'api', 'apidocs', 'apispec', 'endpoints', 'rest', 'openapi'],
  requirements: ['requirements', 'reqs', 'prd', 'spec', 'functionalrequirements', 'userstories'],
});

const NORMALISED_ROLE = new Map();
for (const [role, names] of Object.entries(ROLE_SYNONYMS)) {
  for (const name of names) {
    // First writer wins, so an earlier role keeps an ambiguous name.
    if (!NORMALISED_ROLE.has(name)) NORMALISED_ROLE.set(name, role);
  }
}

/** Normalise a filename to comparable letters and digits, or null if not a doc. */
export function normaliseDocName(filename) {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return null;
  if (!DOC_EXTENSIONS.has(filename.slice(dot).toLowerCase())) return null;
  const stem = filename.slice(0, dot).toLowerCase().replace(/[^a-z0-9]/g, '');
  return stem || null;
}

/** The canonical role a filename denotes, or null. */
export function roleForFilename(filename) {
  const stem = normaliseDocName(filename);
  return stem ? (NORMALISED_ROLE.get(stem) ?? null) : null;
}

/**
 * Resolve a set of known document names to the files that actually exist.
 *
 * The literal-path approach — `existsSync(resolve(dir, 'ROADMAP.md'))` for each
 * name — fails two ways. It misses every spelling not in the list (`PLAN.md`,
 * `TASKS.md`, `docs/ROADMAP.md`), and it is only case-insensitive by accident:
 * on macOS the probe matches `roadmap.md`, on Linux it does not, so the same
 * repository is judged differently by platform.
 *
 * Reading each directory and normalising what is there fixes both: matching is
 * explicitly case- and separator-insensitive everywhere, and one alias table
 * covers the spellings people use.
 *
 * @param {string} projectDir
 * @param {string[]} aliases  normalised names to accept (see normaliseDocName)
 * @param {string[]} dirs     project-relative directories to search ('' = root)
 * @returns {string[]} project-relative POSIX paths, de-duplicated, existing
 */
export function findDocsByName(projectDir, aliases, dirs) {
  const want = new Set(aliases);
  const out = [];
  for (const dir of dirs) {
    const abs = dir ? resolve(projectDir, dir) : resolve(projectDir);
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const stem = normaliseDocName(entry.name);
      if (!stem || !want.has(stem)) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (!out.includes(rel)) out.push(rel);
    }
  }
  return out;
}

/**
 * Find directories that already hold canonical documents.
 *
 * DocGuard assumed `docs-canonical/` and asked afterwards. A project keeping the
 * same documents in `docs/canonical/` therefore looked EMPTY: `init` reported
 * "no canonical docs", offered to reverse-engineer them from code, and would
 * scaffold a second canonical directory beside the real one. The documents were
 * there the whole time; nothing ever looked.
 *
 * Detection is by role BASENAME, because the filenames are the convention that
 * survives relocation — the directory is the part people change.
 *
 * Returns candidates ranked by how many roles each directory holds, so a caller
 * can confirm the strongest one rather than guess. Never throws: an unreadable
 * subtree simply contributes nothing.
 *
 * @param {string} projectDir
 * @param {{maxDepth?: number, skip?: Set<string>}} [opts]
 * @returns {Array<{dir: string, roles: Record<string,string>, count: number}>}
 */
/**
 * A Spec Kit feature directory: `specs/003-enhanced-transcripts/` and the like.
 * These hold ONE feature's spec and data model, so a directory that happens to
 * carry two role-named files is still that feature's folder, never the
 * project's canonical documentation root. Adopting one would point every
 * validator at a single versioned feature.
 */
export function isFeatureSpecDirectory(relDir) {
  if (typeof relDir !== 'string' || !relDir) return false;
  const segments = relDir.split('/');
  return segments.some((segment, index) => /^\d{3,}[-_]/.test(segment)
    && (index === 0 || ['specs', 'spec', 'features'].includes(segments[index - 1].toLowerCase())));
}

export function detectCanonicalLayout(projectDir, opts = {}) {
  const maxDepth = opts.maxDepth ?? 4;
  const skip = opts.skip ?? new Set([
    'node_modules', '.git', '.local', 'dist', 'build', 'coverage',
    'vendor', '__pycache__', '.venv', 'venv', '.next', 'target', '.testguard',
  ]);

  const byBasename = roleForFilename;

  const found = new Map(); // dir -> { role -> relative path }

  const walk = (absDir, relDir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const name = entry.name;
      if (entry.isDirectory()) {
        if (skip.has(name) || name.startsWith('.')) continue;
        walk(join(absDir, name), relDir ? `${relDir}/${name}` : name, depth + 1);
        continue;
      }
      const role = byBasename(name);
      if (!role) continue;
      const key = relDir || '.';
      if (!found.has(key)) found.set(key, {});
      found.get(key)[role] = relDir ? `${relDir}/${name}` : name;
    }
  };
  walk(resolve(projectDir), '', 0);

  return [...found.entries()]
    .map(([dir, roles]) => ({ dir, roles, count: Object.keys(roles).length }))
    // A Spec Kit feature folder is one feature's paperwork, not the project's
    // canonical root, however many role-named files it happens to hold.
    .filter(hit => !isFeatureSpecDirectory(hit.dir))
    // Strongest first; the conventional directory wins an exact tie so an
    // already-conventional project is never told to "relocate" to itself.
    .sort((a, b) => b.count - a.count
      || (a.dir === 'docs-canonical' ? -1 : b.dir === 'docs-canonical' ? 1 : a.dir.localeCompare(b.dir)));
}
