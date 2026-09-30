/**
 * Shared changed-file to generated-section applicability rules.
 * @implements docguard.document-lifecycle#FR-010
 * @implements docguard.sync-section-scope#FR-001
 */

// Keyed by the `source=code` section IDs the memory plan emits
// (cli/scanners/memory-plan.mjs); a test keeps the two sets equal. The table
// was keyed `endpoints-table`, `entities-table`, `env-vars-table`, … while the
// plan emits `endpoints`, `entities`, `env-vars`, …, so eight of ten sections
// never narrowed (docguard.sync-section-scope).
//
// Matchers are conservative on purpose. Routes, entities and env reads can
// live in any code file, so their sections refresh on any code change; the
// narrowing that holds is "a docs-only or unrelated change refreshes nothing".
// Skipping a refresh the code needed is worse than an unneeded one.
const CODE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|swift)$/i;
const MANIFEST = /(?:^|\/)(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|Gemfile|requirements[^/]*\.txt)$/;
const API_CONTRACT = /\.(?:ya?ml|json)$/i;
const TEST_FILE = /(?:^|\/)(?:__tests__|tests?|specs?)\/|\.(?:test|spec)\.[^/]+$|(?:^|\/)test_[^/]+\.py$|_test\.go$/;
const code = p => CODE.test(p);

export const SECTION_FILE_MATCHERS = {
  'tech-stack':       p => MANIFEST.test(p),
  'integrations':     p => MANIFEST.test(p),
  'component-map':    p => code(p),
  'frontend-modules': p => code(p),
  'feature-areas':    p => code(p),
  'test-inventory':   p => TEST_FILE.test(p),
  'endpoints':        p => code(p) || (API_CONTRACT.test(p) && /openapi|swagger/i.test(p)),
  'entities':         p => code(p) || /\.(?:prisma|sql|graphql|gql)$/i.test(p),
  'screens':          p => /\.(?:[jt]sx|vue|svelte)$/i.test(p) || /(?:^|\/)(?:screens|pages|app)\//.test(p),
  'env-vars':         p => code(p) || /(?:^|\/)\.env(?:\.[^/]+)?$/.test(p),
};

export function sectionTouchedByChanges(sectionId, changedFiles) {
  if (!changedFiles || changedFiles.length === 0) return true;
  const matcher = SECTION_FILE_MATCHERS[sectionId];
  if (!matcher) return true;
  return changedFiles.some(matcher);
}

export function mechanicalSectionsForChanges(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return [];
  return Object.keys(SECTION_FILE_MATCHERS)
    .filter(section => sectionTouchedByChanges(section, changedFiles))
    .sort();
}
