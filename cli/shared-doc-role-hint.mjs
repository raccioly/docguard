/**
 * What a fix text says about a document the project may already keep somewhere
 * else (specs/097-strict-by-default FR-007, T018c). A validator whose document is
 * missing at the path its role resolves to names the mapping first, because
 * "create docs-canonical/X.md" is wrong advice for a project that maps the role
 * to another file (`docs.roles`, spec 093) or keeps the document where DocGuard's
 * name matching finds it. DocGuard reads the document where it is; nothing moves.
 *
 * @implements docguard.strict-by-default#FR-007
 */
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOC_ROLES, detectCanonicalLayout, docRolePath, isFeatureSpecDirectory, resolveDocRole } from './shared-doc-roles.mjs';

/**
 * @param {string} projectDir
 * @param {object} config
 * @param {string} role a key of DOC_ROLES
 * @returns {{ path: string, mapped: boolean, exists: boolean, elsewhere: string|null, lead: string }}
 *   `lead` is a sentence (or '') to put before any "create the document" advice:
 *   it names the mapping that already exists, or the document that could be mapped.
 */
// Words that say a document is the one for a role, matched against the normalized file name and the name of
// its folder (letters and digits only, so "03-architecture" and "Architecture_Docs" both read as architecture).
const ROLE_KEYWORDS = {
  architecture: ['architecture'], dataModel: ['datamodel', 'dataschema'], security: ['security'],
  testSpec: ['testspec', 'testing', 'testplan', 'teststrategy'], environment: ['environment'],
  apiReference: ['apireference', 'apispec'], requirements: ['requirements'],
};
const normalize = text => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', '__pycache__', 'target']);

/**
 * Markdown documents that look like the role's document by a stated rule: the name of the file, or of the
 * folder it sits in, contains a keyword of the role ("architecture" for architecture). A decision record or
 * a Spec Kit feature folder is never one. Looks four folders deep.
 */
function looseCandidates(projectDir, role) {
  const keywords = ROLE_KEYWORDS[role] || [];
  const found = [];
  const walk = (rel, depth) => {
    if (depth > 4 || found.length > 5) return;
    let entries;
    try { entries = readdirSync(resolve(projectDir, rel || '.'), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || SKIP_DIRS.has(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!isFeatureSpecDirectory(child)) walk(child, depth + 1); continue; }
      if (!/\.(md|markdown|mdx)$/i.test(entry.name)) continue;
      const stem = normalize(entry.name.replace(/\.[^.]+$/, ''));
      const parent = normalize(rel.split('/').pop() || '');
      if (/adr|decision/.test(stem) || /adr|decision/.test(parent)) continue;
      if (keywords.some(k => stem.includes(k) || parent.includes(k))) found.push(child);
    }
  };
  walk('', 0);
  return found;
}

/**
 * @param {string} projectDir
 * @param {object} config
 * @param {string} role a key of DOC_ROLES
 * @returns {{ path: string, mapped: boolean, exists: boolean, elsewhere: string|null, lead: string, tail: string }}
 *   `lead` (before any "create the document" advice) names a mapping that exists or a document that could be
 *   mapped; `tail` (after it) says how to map a document by hand, with the exact snippet, when none was found.
 *   Both are '' when the document exists.
 */
export function roleDocument(projectDir, config, role) {
  const path = docRolePath(config, role);
  const mapped = config.docs?.roles?.[role] !== undefined && path !== DOC_ROLES[role];
  const exists = existsSync(resolveDocRole(projectDir, config, role));
  let elsewhere = null;
  let candidates = [];
  if (!exists && !mapped) {
    for (const hit of detectCanonicalLayout(projectDir)) {
      const found = hit.roles[role];
      if (found && found !== path && existsSync(resolve(projectDir, found))) { elsewhere = found; break; }
    }
    if (!elsewhere) candidates = looseCandidates(projectDir, role).filter(c => c !== path);
    if (!elsewhere && candidates.length === 1) elsewhere = candidates[0];
  }
  const snippet = file => `\`"docs": { "roles": { "${role}": "${file}" } }\``;
  let lead = '';
  let tail = '';
  if (mapped && !exists) lead = `\`docs.roles\` in .docguard.json maps ${role} to ${path}, and that file does not exist: create it there, or point the mapping at the document the project already keeps. `;
  else if (elsewhere) lead = `${elsewhere} looks like this document: map it through \`docs.roles\` with ${snippet(elsewhere)} in .docguard.json instead of creating a second one. `;
  else if (!exists) {
    const names = candidates.length > 1 ? ` (candidates: ${candidates.slice(0, 3).join(', ')})` : '';
    tail = ` If the project already keeps this document under another name or in another folder${names}, map it instead of creating a second one: ${snippet('<path/to/your-document.md>')} in .docguard.json (\`docs.roles\`).`;
  }
  return { path, mapped, exists, elsewhere, lead, tail };
}
