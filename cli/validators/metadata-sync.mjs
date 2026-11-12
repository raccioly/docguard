/**
 * Metadata Sync Validator — Detects stale version references across docs.
 *
 * Cross-checks package.json version against extension.yml and all .md files.
 * Flags outdated version strings (e.g., README references v0.7.2 but package.json is 0.8.0).
 *
 * v0.29: migrated to structured findings (MDS001–MDS002). Messages are
 * byte-identical to the legacy strings; the `fixes` array is preserved for
 * the fix applier.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { loadIgnorePatterns } from '../shared.mjs';
import { collectPackageJsons } from '../shared-source.mjs';
import { walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { contractFields } from '../shared-result-contract.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
]);

const OTHER_VERSIONED_MANIFESTS = ['pyproject.toml', 'setup.py', 'setup.cfg', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'mix.exs', 'pubspec.yaml', 'Gemfile'];

/** The version package.json (root, or a workspace package) declares, and its name. */
function readPackageVersion(projectDir, config) {
  let version = null;
  let name = null;
  const pkgPath = resolve(projectDir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pj = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      version = pj.version || null;
      name = pj.name || null;
    } catch { /* ignore */ }
  }
  if (!version) {
    for (const { pkg } of collectPackageJsons(projectDir, config)) {
      if (pkg.version) { version = pkg.version; name = name || pkg.name || null; break; }
    }
  }
  return { version, name };
}

/**
 * Whether Metadata-Sync's kind of check belongs to the project: it applies to a
 * project that declares a version, in package.json (the one it reads) or in
 * another ecosystem's manifest (which it does not read, see the cause). A
 * project that declares no version has no version string to keep in step with
 * its documents.
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}) {
  const { version } = readPackageVersion(projectDir, config);
  if (version) return { applies: true, evidence: `package.json declares version ${version}` };
  const other = OTHER_VERSIONED_MANIFESTS.find(f => existsSync(resolve(projectDir, f)));
  if (other) return { applies: true, evidence: `${other} exists, a manifest that carries a version Metadata-Sync does not read`, otherManifest: other };
  return { applies: false, evidence: 'no package.json with a version field, and no other versioned manifest (pyproject.toml, Cargo.toml, pom.xml and similar)' };
}

function metadataContract(projectDir, config, performed, found) {
  return contractFields({
    performed, found, ran: `compared ${performed} version reference(s) with the version package.json declares`,
    decide: () => applies(projectDir, config),
    empty: (decision) => {
      if (!decision.applies) return { note: 'Metadata-Sync found no versioned manifest, so there is no version string to compare with the documents.', howToConfigure: 'Nothing to configure unless the project is versioned: then declare `version` in package.json and Metadata-Sync keeps the documents that name it in step.' };
      if (decision.otherManifest) return { emptyCause: 'layout-not-recognized', note: `Metadata-Sync reads the version from package.json only, and this project's version lives in ${decision.otherManifest}, so it compared no document with it.`, howToConfigure: `Metadata-Sync cannot read ${decision.otherManifest}. Declare the same version in a package.json "version" field next to it and keep it in step with ${decision.otherManifest}, or keep version references out of the documents.` };
      return { emptyCause: 'needs-content', note: 'package.json declares a version but no Markdown file or extension.yml names it in a URL, a `version:` line or a `<package>@x.y.z` install command, so Metadata-Sync compared nothing.', howToConfigure: 'Name the version where readers copy it from, for example `npm install <name>@<version>` in README.md; Metadata-Sync then flags the reference when package.json moves on.' };
    },
  });
}

/**
 * Validate version/metadata consistency across project files.
 * @param {string} projectDir - Project root directory
 * @param {object} config - DocGuard config
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateMetadataSync(projectDir, config) {
  const findings = [];
  const fixes = [];
  let passed = 0;
  let total = 0;

  // ── Get source of truth: package.json version ──
  // Prefer the root package version; in a monorepo where the root is just a
  // workspace manifest with no version, fall back to a source-root package.
  const { version: currentVersion, name: currentName } = readPackageVersion(projectDir, config);
  // Literal legacy shape (no findings/fixes keys) plus the contract fields.
  if (!currentVersion) return { errors: [], warnings: [], passed: 0, total: 0, ...metadataContract(projectDir, config, 0, false) };

  // Parse into components for smart comparison. `|| 0` guards two-part versions
  // (e.g. "1.2"): without it vParts[2] is undefined → parseInt → NaN, and every
  // `fPatch < patch` comparison silently becomes false, disabling the check.
  const vParts = currentVersion.split('.');
  const major = parseInt(vParts[0], 10) || 0;
  const minor = parseInt(vParts[1], 10) || 0;
  const patch = parseInt(vParts[2], 10) || 0;

  // ── Check 1: extension.yml version sync ──
  const extFiles = findExtensionYmls(projectDir);
  for (const extFile of extFiles) {
    total++;
    const relPath = relative(projectDir, extFile);
    try {
      const content = readFileSync(extFile, 'utf-8');
      const versionMatch = content.match(/version:\s*["']?(\d+\.\d+\.\d+)["']?/);
      if (versionMatch) {
        if (versionMatch[1] !== currentVersion) {
          findings.push(mkFinding({
            code: 'MDS001',
            validator: 'metadataSync',
            severity: 'warn',
            message: `${relPath} has version "${versionMatch[1]}" but package.json is "${currentVersion}"`,
            location: relPath,
            suggestion: { kind: 'fix', text: `Update the version field to ${currentVersion}`, command: 'docguard fix --write' },
          }));
          fixes.push({ type: 'replace-version', file: relPath, found: versionMatch[1], actual: currentVersion });
        } else {
          passed++;
        }
      }
    } catch { /* skip unreadable */ }
  }

  // ── Check 2: Version references in markdown files ──
  const isIgnored = loadIgnorePatterns(projectDir);
  const mdFiles = findMarkdownFiles(projectDir);

  for (const mdFile of mdFiles) {
    const relPath = relative(projectDir, mdFile);
    // Skip CHANGELOG.md and DRIFT-LOG.md — these are historical by definition
    const baseName = relPath.toLowerCase();
    if (baseName.includes('changelog') || baseName.includes('drift-log')) continue;
    // Skip files matched by .docguardignore
    if (isIgnored(relPath)) continue;

    let content;
    try { content = readFileSync(mdFile, 'utf-8'); } catch { continue; }

    // Only flag version references in actionable contexts:
    // - URLs (download, install, archive links)
    // - version: declarations (YAML-style)
    // - npm install / npx commands
    // - Badge URLs
    // NOT in prose text like "In v0.2.0 we added..." or roadmap discussions
    const actionablePatterns = [
      // URLs with version: /v0.7.2/, /tags/v0.7.2, /releases/0.7.2
      /(?:archive|tags|releases|download)\/v?(\d+\.\d+\.\d+)/g,
      // YAML-style: version: "0.7.2" or version: 0.7.2
      /version:\s*["']?(\d+\.\d+\.\d+)["']?/g,
    ];
    // npm/npx refs to THIS package only (e.g. docguard-cli@0.7.2), anchored to
    // the package name. A bare /@(\d+\.\d+\.\d+)/ used to over-match unrelated
    // versions — node@18.2.0, @types/node@1.2.3, or "@1.2.3" in prose.
    if (currentName) {
      const escaped = currentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      actionablePatterns.push(new RegExp(`${escaped}@v?(\\d+\\.\\d+\\.\\d+)`, 'g'));
    }

    for (const pattern of actionablePatterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const foundVersion = match[1];
        const fParts = foundVersion.split('.');
        const fMajor = parseInt(fParts[0], 10);
        const fMinor = parseInt(fParts[1], 10);
        const fPatch = parseInt(fParts[2], 10);

        // Only flag if same major but older version (same package, stale ref)
        const isOlder = fMajor === major && (
          fMinor < minor ||
          (fMinor === minor && fPatch < patch)
        );

        if (isOlder && foundVersion !== currentVersion) {
          total++;
          findings.push(mkFinding({
            code: 'MDS002',
            validator: 'metadataSync',
            severity: 'warn',
            message: `${relPath} references "v${foundVersion}" in an actionable context (URL/install/declaration) but current version is "${currentVersion}"`,
            location: relPath,
            suggestion: { kind: 'fix', text: `Replace the stale ${foundVersion} reference with ${currentVersion}`, command: 'docguard fix --write' },
          }));
          if (!fixes.some(f => f.file === relPath && f.found === foundVersion)) {
            fixes.push({ type: 'replace-version', file: relPath, found: foundVersion, actual: currentVersion });
          }
        } else if (fMajor === major && fMinor === minor && foundVersion === currentVersion) {
          total++;
          passed++;
        }
      }
    }
  }

  return { ...resultFromFindings(findings, { passed, total }), fixes, ...metadataContract(projectDir, config, total, findings.length > 0) };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findExtensionYmls(dir) {
  const results = [];
  const extDir = resolve(dir, 'extensions');
  if (existsSync(extDir)) {
    walkFiles(extDir, (f) => {
      if (f.endsWith('extension.yml') || f.endsWith('extension.yaml')) {
        results.push(f);
      }
    });
  }
  // Also check root
  const rootExt = resolve(dir, 'extension.yml');
  if (existsSync(rootExt)) results.push(rootExt);
  return results;
}

function findMarkdownFiles(dir) {
  const seen = new Set();
  const mdFiles = [];
  const searchDirs = [
    dir,
    resolve(dir, 'docs-canonical'),
    resolve(dir, 'extensions'),
  ];

  for (const searchDir of searchDirs) {
    if (!existsSync(searchDir)) continue;
    walkFiles(searchDir, (f) => {
      if (f.endsWith('.md') && !seen.has(f)) {
        seen.add(f);
        mdFiles.push(f);
      }
    });
  }

  return mdFiles;
}

// v0.29 consolidation: traversal delegates to the shared canonical walker.
function walkFiles(dir, callback) {
  sharedWalkFiles(dir, callback, { ignoreDirs: IGNORE_DIRS });
}
