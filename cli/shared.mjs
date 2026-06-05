/**
 * Shared constants for DocGuard CLI — colors, profiles, version.
 * Extracted from docguard.mjs to break circular dependencies.
 * All commands import from here instead of docguard.mjs.
 */

/**
 * Current .docguard.json schema version that this CLI version writes via
 * `docguard init`. Bump this when adding fields that need migration (e.g.
 * v0.12 adds `severity` overrides per validator).
 *
 * The post-guard nudge fires when an existing project's stored
 * `.docguard.json.version` is BEHIND this constant — pointing users at
 * `docguard upgrade` to migrate.
 */
export const CURRENT_SCHEMA_VERSION = '0.5';

/**
 * Allowed severity values for per-validator `severity` overrides in
 * `.docguard.json`. Affects EXIT-CODE behavior of `docguard guard`:
 *   - 'high':   warnings from this validator fail CI (exit 1)
 *   - 'medium': default — warnings exit 2 (informational)
 *   - 'low':    warnings ignored for exit code (exit 0)
 *
 * Display (the per-validator status lines and the summary) is unchanged
 * regardless of severity — severity is a CI/operational knob, not a UI one.
 */
export const SEVERITY_LEVELS = new Set(['high', 'medium', 'low']);

/**
 * Resolve a validator's effective severity from config.
 * Returns 'medium' (default) if no override is set or the override is bogus.
 */
export function resolveSeverity(config, validatorKey) {
  const s = config && config.severity && config.severity[validatorKey];
  if (typeof s === 'string' && SEVERITY_LEVELS.has(s.toLowerCase())) {
    return s.toLowerCase();
  }
  return 'medium';
}

// ── Canonical section heading matching ─────────────────────────────────────
/**
 * Required canonical sections used to be matched by literal substring, so an
 * arc42/C4 doc with "## 5.4 Layer boundaries" or "## Building Block View"
 * scored as if the section were absent — the validator made well-structured
 * docs look WORSE than the skeleton (field report). These synonyms + section-
 * number tolerance let equivalent headings count. Synonyms only ever ADD
 * matches; the literal canonical heading always still passes.
 *
 * Keyed by the normalized canonical heading (lowercase, alphanumerics + spaces).
 */
export const SECTION_SYNONYMS = {
  'system overview':       ['system context', 'system summary', 'introduction and goals', 'context and scope', 'overview and goals'],
  'component map':         ['components', 'component overview', 'building block view', 'building blocks', 'containers', 'module overview'],
  'tech stack':            ['technology stack', 'technologies', 'technical stack'],
  'entities':              ['entity definitions', 'data model', 'domain model', 'data entities'],
  'authentication':        ['auth', 'authn', 'authentication and authorization', 'identity'],
  'secrets management':    ['secrets', 'secret management', 'secrets handling', 'credentials', 'credential management'],
  'test categories':       ['test types', 'categories of tests', 'test strategy', 'testing strategy', 'test approach'],
  'coverage rules':        ['coverage', 'coverage targets', 'coverage goals', 'coverage requirements', 'coverage policy'],
  'environment variables': ['env vars', 'environment', 'configuration', 'config variables'],
  'setup steps':           ['setup', 'getting started', 'installation', 'setup instructions', 'local setup', 'quick start'],
  'layer boundaries':      ['layers', 'layering', 'module boundaries', 'layer boundary', 'boundaries'],
  'external dependencies': ['dependencies', 'external systems', 'third party dependencies', 'integrations', 'external interfaces'],
  'revision history':      ['changelog', 'change history', 'history', 'revisions', 'document history', 'change log'],
};

/** Normalize a markdown heading: drop #, leading arc42-style numbers, punctuation. */
function normalizeHeadingText(line) {
  return line
    .replace(/^#{1,6}\s*/, '')             // strip leading #s
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '')   // strip leading "5.4 " / "3. " section numbers
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')           // non-alphanumeric → single space
    .trim();
}

/**
 * True if `content` has an H2–H6 heading equivalent to `canonicalHeading` —
 * the exact text, a known synonym, or the same text behind an arc42-style
 * section number (e.g. "## 5.4 Layer boundaries" satisfies "## Layer Boundaries").
 *
 * @param {string} content - markdown file contents
 * @param {string} canonicalHeading - e.g. '## Component Map' or 'Component Map'
 */
export function docHasSection(content, canonicalHeading) {
  const key = normalizeHeadingText(canonicalHeading);
  if (!key) return false;
  const accepted = [key, ...(SECTION_SYNONYMS[key] || [])];
  const headings = content.match(/^#{2,6}\s+.+$/gm) || [];
  for (const line of headings) {
    const norm = normalizeHeadingText(line);
    for (const phrase of accepted) {
      if (norm.includes(phrase)) return true;
    }
  }
  return false;
}

/**
 * Parse a dotted-decimal version string into a tuple of integers for
 * comparison. Tolerates extra suffixes (e.g. `0.4-beta` → [0, 4]).
 * Returns null when the string is unparseable.
 */
export function parseVersion(v) {
  if (!v || typeof v !== 'string') return null;
  const m = v.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
}

/**
 * Compare two version strings. Returns -1 if a<b, 0 if equal, 1 if a>b.
 * Unparseable inputs sort as equal (no nag).
 */
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

// ── Colors (ANSI escape codes, zero deps) ──────────────────────────────────
export const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

// ── Compliance Profiles ───────────────────────────────────────────────────
export const PROFILES = {
  starter: {
    description: 'Minimal CDD — architecture + changelog, no Spec Kit framework scaffold (pass --spec-kit to add it). For side projects and prototypes.',
    requiredFiles: {
      canonical: [
        'docs-canonical/ARCHITECTURE.md',
      ],
      agentFile: ['AGENTS.md', 'CLAUDE.md'],
      changelog: 'CHANGELOG.md',
      driftLog: 'DRIFT-LOG.md',
    },
    validators: {
      structure: true,
      docsSync: true,
      drift: false,
      changelog: true,
      architecture: false,
      testSpec: false,
      security: false,
      environment: false,
      freshness: false,
    },
  },
  standard: {
    description: 'Full CDD — all 5 canonical docs. For team projects.',
    // Uses the defaults — no overrides needed
  },
  enterprise: {
    description: 'Strict CDD — all docs, all validators, freshness enforced. For regulated/enterprise projects.',
    validators: {
      structure: true,
      docsSync: true,
      drift: true,
      changelog: true,
      architecture: true,
      testSpec: true,
      security: true,
      environment: true,
      freshness: true,
    },
  },
  // F3 (field report): non-web-centric profiles. The default doc set assumes an
  // HTTP API + database; for a CLI or library that structure fights the project.
  // These drop the HTTP/DB-shaped requirements. (A bespoke CLI-REFERENCE doc type
  // is a separate, larger follow-up; until then API-REFERENCE doubles as the
  // library's module-API reference.)
  cli: {
    description: 'CLI / command-line tool — no HTTP API or database assumed.',
    requiredFiles: {
      canonical: [
        'docs-canonical/ARCHITECTURE.md',
        'docs-canonical/TEST-SPEC.md',
        'docs-canonical/SECURITY.md',
        'docs-canonical/ENVIRONMENT.md',
      ],
      agentFile: ['AGENTS.md', 'CLAUDE.md'],
      changelog: 'CHANGELOG.md',
      driftLog: 'DRIFT-LOG.md',
    },
  },
  library: {
    description: 'Library / package — public API matters; no HTTP server or DB assumed.',
    requiredFiles: {
      canonical: [
        'docs-canonical/ARCHITECTURE.md',
        'docs-canonical/API-REFERENCE.md',
        'docs-canonical/TEST-SPEC.md',
      ],
      agentFile: ['AGENTS.md', 'CLAUDE.md'],
      changelog: 'CHANGELOG.md',
      driftLog: 'DRIFT-LOG.md',
    },
  },
  'enterprise-ai': {
    description: 'EU AI Act compliance — Annex IV documentation requirements, ALCOA+ alignment, strict freshness. For AI/ML projects under regulatory scrutiny.',
    requiredFiles: {
      canonical: [
        'docs-canonical/ARCHITECTURE.md',
        'docs-canonical/DATA-MODEL.md',
        'docs-canonical/SECURITY.md',
        'docs-canonical/TEST-SPEC.md',
        'docs-canonical/ENVIRONMENT.md',
      ],
      agentFile: ['AGENTS.md', 'CLAUDE.md'],
      changelog: 'CHANGELOG.md',
      driftLog: 'DRIFT-LOG.md',
    },
    validators: {
      structure: true,
      docsSync: true,
      drift: true,
      changelog: true,
      architecture: true,
      testSpec: true,
      security: true,
      environment: true,
      freshness: true,
      docQuality: true,
      todoTracking: true,
      schemaSync: true,
    },
    // Stricter freshness threshold — 14 days instead of 30
    freshness: { maxDaysStale: 14 },
    // SECURITY.md must have Risk Assessment section
    requiredSections: {
      'SECURITY.md': ['Risk Assessment', 'Threat Model'],
    },
  },
};

// ── .docguardignore Support ───────────────────────────────────────────────
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

/**
 * Load ignore patterns from .docguardignore (like .gitignore).
 * Returns a function that checks if a relative path should be ignored.
 *
 * Format: one pattern per line, # comments, blank lines skipped.
 * Supports simple glob: * (any chars), ** (any path segments).
 *
 * @param {string} projectDir - Project root
 * @returns {(relPath: string) => boolean} - Returns true if file should be ignored
 */
export function loadIgnorePatterns(projectDir) {
  const ignorePath = resolve(projectDir, '.docguardignore');
  if (!existsSync(ignorePath)) return () => false;

  let content;
  try { content = readFileSync(ignorePath, 'utf-8'); } catch { return () => false; }

  const patterns = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(pattern => {
      // Convert glob to regex:
      // ** → match any path segments
      // * → match any chars except /
      // . → literal dot
      const escaped = pattern
        .replace(/\./g, '\\.')
        .replace(/\*\*/g, '§§')     // temp placeholder
        .replace(/\*/g, '[^/]*')
        .replace(/§§/g, '.*');
      return new RegExp(`^${escaped}$|/${escaped}$|^${escaped}/|/${escaped}/`);
    });

  return (relPath) => patterns.some(regex => regex.test(relPath));
}
