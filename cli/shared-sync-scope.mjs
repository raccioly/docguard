/** Shared changed-file to generated-section applicability rules. */

export const SECTION_FILE_MATCHERS = {
  'tech-stack':        (p) => /package\.json$|pyproject\.toml$|Cargo\.toml$|go\.mod$|pom\.xml$|Gemfile$/.test(p),
  'frontend-modules':  (p) => /(^|\/)(src\/)?(stores|hooks|contexts|features)\//.test(p),
  'endpoints-table':   (p) => /(^|\/)(routes|controllers|handlers|app\/api)\//.test(p)
                              || /\.(yaml|yml|json)$/i.test(p) && /openapi|swagger/i.test(p),
  'entities-table':    (p) => /(^|\/)(models|schemas|entities)\//.test(p) || /\.prisma$/.test(p),
  'relationships':     (p) => /(^|\/)(models|schemas|entities)\//.test(p) || /\.prisma$/.test(p),
  'screens-table':     (p) => /(^|\/)(screens|pages|app)\//.test(p) || /\.(tsx|jsx)$/.test(p),
  'flows':             (p) => /(^|\/)(screens|pages|app|routes)\//.test(p),
  'integrations-table':(p) => /package\.json$|pyproject\.toml$|requirements.*\.txt$|Cargo\.toml$/.test(p),
  'features-table':    (p) => /(^|\/)(features|domains)\//.test(p),
  'features':          (p) => /(^|\/)(features|domains)\//.test(p),
  'env-vars-table':    (p) => /\.env(\..+)?$|(^|\/)config\//.test(p)
                              || /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|rb)$/.test(p),
  'setup':             (p) => /\.env(\..+)?$|(^|\/)config\//.test(p),
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
