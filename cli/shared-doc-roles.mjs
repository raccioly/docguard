/** Explicit document roles let existing repository layouts serve as canonical input. */
import { existsSync, lstatSync, readFileSync } from 'node:fs';
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

export function assertDefaultDocWrites(config) {
  if (Object.entries(config.docs?.roles || {}).some(([role, path]) => path !== DOC_ROLES[role])) {
    throw new Error('Custom docs.roles currently support validation and read-only planning. Automatic document generation/repair is unavailable for mapped layouts; review and edit the existing documents directly.');
  }
}
