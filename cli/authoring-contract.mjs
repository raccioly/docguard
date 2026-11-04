/**
 * The authoring contract: one registry of the sections each canonical
 * document carries (specs/082-authoring-contract). STR003, the Doc Quality
 * score, explain's STR003 text, the `fix` prompts and the Spec Kit
 * `docguard-fix` skill all read it, so what DocGuard tells an author to write
 * is what its validators accept. Before it, seven copies had drifted: the skill
 * asked for "Technology Choices" where STR003 requires Tech Stack.
 *
 * Keyed by default path; consumers map a project's own file with
 * `remapDocPath`. `when` exempts a section by project type, as STR003 always
 * has. Recommended sections are guidance only and never checked.
 *
 * @implements docguard.authoring-contract#FR-001
 */

const needsDatabase = ptc => ptc.needsDatabase !== false;
const needsEnvVars = ptc => ptc.needsEnvVars !== false;

export const CANONICAL_SECTIONS = Object.freeze({
  'docs-canonical/ARCHITECTURE.md': [
    { heading: 'System Overview', required: true, write: '2-3 sentences on what the project does and who uses it' },
    { heading: 'Component Map', required: true, write: 'a table of each module or directory and its responsibility' },
    { heading: 'Tech Stack', required: true, write: 'the languages, frameworks and key libraries, and why each was chosen' },
    { heading: 'Layer Boundaries', write: 'which layers may import from which' },
    { heading: 'Data Flow', write: 'how a request or command moves through the system' },
  ],
  'docs-canonical/DATA-MODEL.md': [
    { heading: 'Entities', required: true, when: needsDatabase, whenText: 'when the project has a database', write: 'each table, collection or schema, with its fields, types and constraints' },
    { heading: 'Relationships', write: 'how the entities reference each other' },
    { heading: 'Indexes', write: 'every index and the query it serves' },
  ],
  'docs-canonical/SECURITY.md': [
    { heading: 'Authentication', required: true, write: 'the auth mechanism (OAuth, JWT, API key), or that there is none and why' },
    { heading: 'Secrets Management', required: true, write: 'every secret by name (never its value) and where it is stored' },
    { heading: 'Authorization', write: 'the roles and what each may do' },
    { heading: 'Security Boundaries', write: 'which input is trusted and which is not' },
  ],
  'docs-canonical/TEST-SPEC.md': [
    { heading: 'Test Categories', required: true, write: 'the test framework, and the unit, integration and end-to-end suites with where each lives' },
    { heading: 'Coverage Rules', required: true, write: 'current coverage, the target thresholds and the critical flows that must be tested' },
    { heading: 'Test Commands', write: 'the exact commands that run each suite, and how CI runs them' },
  ],
  'docs-canonical/ENVIRONMENT.md': [
    { heading: 'Environment Variables', required: true, when: needsEnvVars, whenText: 'when the code reads any', write: 'every variable the code reads, with its purpose and default' },
    { heading: 'Setup Steps', required: true, write: 'the prerequisites and exact commands from clone to running' },
    { heading: 'Configuration Files', write: 'each configuration file and what it controls' },
  ],
});

/** The sections that apply to a document for this project type. */
export function sectionsFor(defaultPath, ptc = {}) {
  return (CANONICAL_SECTIONS[defaultPath] || []).filter(s => !s.when || s.when(ptc));
}

/** `{ defaultPath: ['## Heading', …] }` of required sections, the form STR003 and the score check. */
export function requiredSectionMap(ptc = {}) {
  return Object.fromEntries(Object.keys(CANONICAL_SECTIONS).map(path => [
    path, sectionsFor(path, ptc).filter(s => s.required).map(s => `## ${s.heading}`),
  ]));
}

/**
 * A profile's extra required sections (`requiredSections` in a profile or
 * `.docguard.json`), keyed by default path. A bare file name is a canonical
 * document's.
 * @implements docguard.authoring-contract#FR-006
 */
export function profileSections(config = {}) {
  const out = {};
  for (const [file, headings] of Object.entries(config.requiredSections || {})) {
    if (!Array.isArray(headings)) continue;
    const path = file.includes('/') ? file : `docs-canonical/${file}`;
    out[path] = headings.map(h => String(h).replace(/^#+\s*/, '')).filter(Boolean);
  }
  return out;
}

/** The "write these sections" lines for one document: required first, then recommended. */
export function authoringLines(defaultPath, ptc = {}) {
  return sectionsFor(defaultPath, ptc).map(s => `- ${s.heading}${s.required ? '' : ' (recommended)'}: ${s.write}`);
}

/** STR003's contract in one sentence, for `explain`. */
export function requiredSectionsSentence() {
  return Object.keys(CANONICAL_SECTIONS).map(path => {
    const required = CANONICAL_SECTIONS[path].filter(s => s.required);
    return `${path.replace('docs-canonical/', '')} (${required.map(s => s.heading + (s.whenText ? `, ${s.whenText}` : '')).join('; ')})`;
  }).join(', ');
}

/** The generated block the Spec Kit `docguard-fix` skill carries (FR-003). */
export function skillSectionBlock() {
  const lines = ['<!-- docguard:authoring-contract — generated by `npm run docs:reference` from cli/authoring-contract.mjs; edit the registry, not this block -->'];
  for (const path of Object.keys(CANONICAL_SECTIONS)) {
    const all = CANONICAL_SECTIONS[path];
    const required = all.filter(s => s.required).map(s => s.heading + (s.whenText ? ` (${s.whenText})` : ''));
    const recommended = all.filter(s => !s.required).map(s => s.heading);
    lines.push(`   - **${path.replace('docs-canonical/', '')}**: ${required.join(', ')}${recommended.length ? `; recommended: ${recommended.join(', ')}` : ''}`);
  }
  lines.push('<!-- /docguard:authoring-contract -->');
  return lines.join('\n');
}
