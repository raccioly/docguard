/**
 * Metadata Sync Validator — Detects stale version references across docs.
 *
 * Cross-checks package.json version against extension.yml and all .md files.
 * Flags outdated version strings (e.g., README references v0.7.2 but package.json is 0.8.0).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { loadIgnorePatterns } from '../shared.mjs';
import { collectPackageJsons } from '../shared-source.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
]);

/**
 * Validate version/metadata consistency across project files.
 * @param {string} projectDir - Project root directory
 * @param {object} config - DocGuard config
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateMetadataSync(projectDir, config) {
  const warnings = [];
  let passed = 0;
  let total = 0;

  // ── Get source of truth: package.json version ──
  // Prefer the root package version; in a monorepo where the root is just a
  // workspace manifest with no version, fall back to a source-root package.
  const pkgPath = resolve(projectDir, 'package.json');
  let currentVersion = null;
  if (existsSync(pkgPath)) {
    try { currentVersion = JSON.parse(readFileSync(pkgPath, 'utf-8')).version || null; } catch { /* ignore */ }
  }
  if (!currentVersion) {
    for (const { pkg } of collectPackageJsons(projectDir, config)) {
      if (pkg.version) { currentVersion = pkg.version; break; }
    }
  }
  if (!currentVersion) return { errors: [], warnings, passed: 0, total: 0 };

  // Parse into components for smart comparison
  const vParts = currentVersion.split('.');
  const major = parseInt(vParts[0], 10);
  const minor = parseInt(vParts[1], 10);
  const patch = parseInt(vParts[2], 10);

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
          warnings.push(
            `${relPath} has version "${versionMatch[1]}" but package.json is "${currentVersion}"`
          );
        } else {
          passed++;
        }
      }
    } catch { /* skip unreadable */ }
  }

  // ── Check 2: Version references in markdown files ──
  const isIgnored = loadIgnorePatterns(projectDir);
  const mdFiles = findMarkdownFiles(projectDir);
  // Version patterns to find: v0.7.2, @0.7.2, /v0.7.2/, docguard-cli@0.7.2
  const versionRegex = /(?:v|@|\/v?)(\d+\.\d+\.\d+)/g;

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
      // URLs with version: /v0.7.2/, /tags/v0.7.2, @0.7.2
      /(?:archive|tags|releases|download)\/v?(\d+\.\d+\.\d+)/g,
      // npm install/npx commands: docguard-cli@0.7.2
      /@(\d+\.\d+\.\d+)/g,
      // YAML-style: version: "0.7.2" or version: 0.7.2
      /version:\s*["']?(\d+\.\d+\.\d+)["']?/g,
    ];

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
          warnings.push(
            `${relPath} references "v${foundVersion}" in an actionable context (URL/install/declaration) but current version is "${currentVersion}"`
          );
        } else if (fMajor === major && fMinor === minor && foundVersion === currentVersion) {
          total++;
          passed++;
        }
      }
    }
  }

  return { errors: [], warnings, passed, total };
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

function walkFiles(dir, callback) {
  if (!existsSync(dir)) return;
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walkFiles(fullPath, callback);
      } else if (stat.isFile()) {
        callback(fullPath);
      }
    } catch { /* skip */ }
  }
}
