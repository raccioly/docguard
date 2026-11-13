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

// Words that say a document is the one for a role, matched against the normalized file name and the name of
// its folder (letters and digits only, so "03-architecture" and "Architecture_Docs" both read as architecture).
const ROLE_KEYWORDS = {
  architecture: ['architecture'], dataModel: ['datamodel', 'dataschema'], security: ['security'],
  testSpec: ['testspec', 'testing', 'testplan', 'teststrategy'], environment: ['environment'],
  apiReference: ['apireference', 'apispec'], requirements: ['requirements'],
};
const normalize = text => text.toLowerCase().replace(/[^a-z0-9]/g, '');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'vendor', '__pycache__', 'target']);

// A document that stands for its whole folder: "overview", "system-overview", "index", "README", "summary".
const OVERVIEW_STEM = /overview$|^(?:index|readme|summary)$/;

/**
 * Markdown documents that could be the role's document, ranked, by a stated rule (the file name, or the name
 * of its folder, contains a keyword of the role: "architecture" for architecture; a decision record or a
 * Spec Kit feature folder never counts). Looks four folders deep and reads everything it reaches, so no cap
 * can hide the best candidate.
 *
 *   1. `named`: the file's own name contains the role's word. A name that is exactly the word comes first.
 *   2. `overview`: the file only sits in a folder with the role's word, and its own name is an overview or
 *      an index. Other files of that folder are not candidates: nothing says they are this document.
 *
 * `folders` are the folders named for the role that were looked in, for the sentence that says so.
 */
function looseCandidates(projectDir, role) {
  const keywords = ROLE_KEYWORDS[role] || [];
  const ranked = [];
  const folders = new Set();
  const walk = (rel, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = readdirSync(resolve(projectDir, rel || '.'), { withFileTypes: true }); } catch { return; }
    const parent = normalize(rel.split('/').pop() || '');
    const inRoleFolder = keywords.some(k => parent.includes(k)) && !/adr|decision/.test(parent);
    if (inRoleFolder) folders.add(rel);
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink() || SKIP_DIRS.has(entry.name)) continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { if (!isFeatureSpecDirectory(child)) walk(child, depth + 1); continue; }
      if (!/\.(md|markdown|mdx)$/i.test(entry.name)) continue;
      const stem = normalize(entry.name.replace(/\.[^.]+$/, ''));
      if (/adr|decision/.test(stem)) continue;
      if (keywords.some(k => stem.includes(k))) ranked.push({ file: child, tier: 'named', exact: keywords.includes(stem) });
      else if (inRoleFolder && OVERVIEW_STEM.test(stem)) ranked.push({ file: child, tier: 'overview', exact: false });
    }
  };
  walk('', 0);
  const order = c => (c.tier === 'named' ? (c.exact ? 0 : 1) : 2);
  ranked.sort((x, y) => order(x) - order(y) || x.file.localeCompare(y.file));
  return { ranked, folders: [...folders].sort() };
}

/** The one candidate the rule can name, or null when it cannot tell which file is the document. */
function decide(ranked) {
  const named = ranked.filter(c => c.tier === 'named');
  if (named.length) {
    const exact = named.filter(c => c.exact);
    if (exact.length === 1) return exact[0].file;
    return named.length === 1 ? named[0].file : null;
  }
  const overviews = ranked.filter(c => c.tier === 'overview');
  return overviews.length === 1 ? overviews[0].file : null;
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
  let ranked = [];
  let folders = [];
  if (!exists && !mapped) {
    for (const hit of detectCanonicalLayout(projectDir)) {
      const found = hit.roles[role];
      if (found && found !== path && existsSync(resolve(projectDir, found))) { elsewhere = found; break; }
    }
    if (!elsewhere) {
      ({ ranked, folders } = looseCandidates(projectDir, role));
      ranked = ranked.filter(c => c.file !== path);
      elsewhere = decide(ranked);
    }
  }
  const snippet = file => `\`"docs": { "roles": { "${role}": "${file}" } }\``;
  let lead = '';
  let tail = '';
  if (mapped && !exists) lead = `\`docs.roles\` in .docguard.json maps ${role} to ${path}, and that file does not exist: create it there, or point the mapping at the document the project already keeps. `;
  else if (elsewhere) lead = `${elsewhere} looks like this document: map it through \`docs.roles\` with ${snippet(elsewhere)} in .docguard.json instead of creating a second one. `;
  else if (!exists) {
    // It could not tell which file is the document: none is named as the one, but what it saw is said.
    const named = ranked.filter(c => c.tier === 'named').map(c => c.file);
    const listed = named.length > 1 ? ` DocGuard found these by name (candidates, best first: ${named.slice(0, 5).join(', ')}${named.length > 5 ? `, and ${named.length - 5} more` : ''}) and cannot tell which one is the document.` : '';
    const looked = folders.length && !named.length ? ` DocGuard looked in ${folders.slice(0, 3).map(f => `${f}/`).join(', ')} (named for it) and cannot tell which file is the document.` : '';
    tail = ` If the project already keeps this document under another name or in another folder, map it instead of creating a second one: ${snippet('<path/to/your-document.md>')} in .docguard.json (\`docs.roles\`).${listed}${looked}`;
  }
  return { path, mapped, exists, elsewhere, lead, tail };
}
