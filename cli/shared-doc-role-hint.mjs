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
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOC_ROLES, detectCanonicalLayout, docRolePath, resolveDocRole } from './shared-doc-roles.mjs';

/**
 * @param {string} projectDir
 * @param {object} config
 * @param {string} role a key of DOC_ROLES
 * @returns {{ path: string, mapped: boolean, exists: boolean, elsewhere: string|null, lead: string }}
 *   `lead` is a sentence (or '') to put before any "create the document" advice:
 *   it names the mapping that already exists, or the document that could be mapped.
 */
export function roleDocument(projectDir, config, role) {
  const path = docRolePath(config, role);
  const mapped = config.docs?.roles?.[role] !== undefined && path !== DOC_ROLES[role];
  const exists = existsSync(resolveDocRole(projectDir, config, role));
  let elsewhere = null;
  if (!exists && !mapped) {
    for (const hit of detectCanonicalLayout(projectDir)) {
      const found = hit.roles[role];
      if (found && found !== path && existsSync(resolve(projectDir, found))) { elsewhere = found; break; }
    }
  }
  let lead = '';
  if (mapped && !exists) lead = `\`docs.roles\` in .docguard.json maps ${role} to ${path}, and that file does not exist: create it there, or point the mapping at the document the project already keeps. `;
  else if (elsewhere) lead = `${elsewhere} looks like this document: map it through \`docs.roles\` with \`"docs": { "roles": { "${role}": "${elsewhere}" } }\` in .docguard.json instead of creating a second one. `;
  return { path, mapped, exists, elsewhere, lead };
}
