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
import { resolve, join, relative, extname, sep } from 'node:path';
import { loadIgnorePatterns } from '../shared.mjs';
import { collectPackageJsons } from '../shared-source.mjs';
import { walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { contractFields } from '../shared-result-contract.mjs';

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
 * The forms in which a document states THIS package's version, shared by the comparison and by the
 * decision whether there is anything to compare, so the two cannot disagree (spec 097 FR-006):
 *   - `<package>@x.y.z`, an install line that names the package (a bare `@1.2.3` over-matched
 *     `node@18.2.0`, `@types/node@1.2.3` and prose);
 *   - a URL that names the package and carries a version (`.../<package>/releases/download/v0.7.2/...`,
 *     `/tags/v0.7.2`, `/archive/0.7.2`), never a URL for another project;
 *   - a `version: x.y.z` line that opens its line (so `minimum_pre_commit_version: 3.2.0` is not one),
 *     in a document that names the package, that is, a document about it.
 * A project without a package name has no way to say which package, so it keeps the broad reading.
 *
 * @returns {Array<{ re: RegExp, accept: (content: string, match: RegExpExecArray) => boolean }>}
 */
function actionableVersionPatterns(currentName) {
  const lower = currentName ? currentName.toLowerCase() : null;
  const tokenAround = (content, index) => {
    let start = index;
    while (start > 0 && !/[\s"'`(<>]/.test(content[start - 1])) start--;
    let end = index;
    while (end < content.length && !/[\s"'`)<>]/.test(content[end])) end++;
    return content.slice(start, end).toLowerCase();
  };
  const patterns = [
    { re: /(?:archive|tags|releases|download)\/v?(\d+\.\d+\.\d+)/g, accept: (content, m) => !lower || tokenAround(content, m.index).includes(lower) },
    { re: /version:\s*["']?(\d+\.\d+\.\d+)["']?/g, accept: (content, m) => {
      if (!lower) return true;
      const lineStart = content.lastIndexOf('\n', m.index - 1) + 1;
      return /^\s*(?:[-*]\s+)?$/.test(content.slice(lineStart, m.index)) && content.toLowerCase().includes(lower);
    } },
  ];
  if (currentName) {
    const escaped = currentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patterns.push({ re: new RegExp(`${escaped}@v?(\\d+\\.\\d+\\.\\d+)`, 'g'), accept: () => true });
  }
  return patterns;
}

/** Every version a document states for the package, in the forms above. */
function* statedVersions(content, name) {
  for (const { re, accept } of actionableVersionPatterns(name)) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) if (accept(content, m)) yield m[1];
  }
}

/** The first document that states a version in a form the comparison reads, as { file, version }, or null. */
function firstVersionStatement(projectDir, name) {
  const isIgnored = loadIgnorePatterns(projectDir);
  for (const extFile of findExtensionYmls(projectDir)) {
    try {
      const m = readFileSync(extFile, 'utf-8').match(/version:\s*["']?(\d+\.\d+\.\d+)["']?/);
      if (m) return { file: relative(projectDir, extFile).split(sep).join('/'), version: m[1] };
    } catch { /* unreadable */ }
  }
  for (const mdFile of findMarkdownFiles(projectDir)) {
    const rel = relative(projectDir, mdFile);
    const lower = rel.toLowerCase();
    if (lower.includes('changelog') || lower.includes('drift-log') || isIgnored(rel)) continue;
    let content;
    try { content = readFileSync(mdFile, 'utf-8'); } catch { continue; }
    for (const version of statedVersions(content, name)) return { file: rel.split(sep).join('/'), version };
  }
  return null;
}

/**
 * A consistency check applies only when both statements of the fact exist (spec 097 FR-006): the
 * manifest declares a version AND a document the comparison reads states one. Where no document states
 * a version nothing can drift, so the validator does not apply and asks nothing of the project.
 */
function withStatement(projectDir, manifestEvidence, name) {
  const statement = firstVersionStatement(projectDir, name || null);
  return statement
    ? { applies: true, evidence: `${manifestEvidence}, and ${statement.file} states a version (${statement.version})` }
    : { applies: false, noStatement: true, evidence: `${manifestEvidence}, and no document states a version for this package in a form Metadata-Sync compares (a \`<package>@x.y.z\` install command, a URL that names the package and carries a version, or a \`version:\` line in a document about it), so there is nothing that can drift` };
}

/**
 * Whether Metadata-Sync's kind of check belongs to the project: it applies to a
 * package somebody installs, whose version the documents quote. It does not apply
 * to a package marked `"private": true` (nobody installs it, so no document quotes
 * a version to keep current), nor to a project that declares no version, nor to one whose
 * documents state no version (see `withStatement`).
 *
 * Which version it reads, and the evidence always names it:
 *   - the root package.json, when it declares a version;
 *   - otherwise a workspace package, only when exactly one workspace package is
 *     published (not private): a workspace package is not the project's version
 *     when several are published or none is. The root of a monorepo usually has
 *     no version of its own, so one published package is the only unambiguous
 *     candidate.
 * Only this decision follows that rule; the check itself keeps reading the version
 * it always read, so no finding changes under `standard`.
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}) {
  const rootPath = resolve(projectDir, 'package.json');
  let root = null;
  try { root = JSON.parse(readFileSync(rootPath, 'utf-8')); } catch { /* absent or unreadable: no root version */ }
  if (root?.version) {
    return root.private === true
      ? { applies: false, evidence: `package.json declares version ${root.version} but is marked "private": true, so nobody installs it and no document quotes its version`, private: true }
      : withStatement(projectDir, `package.json declares version ${root.version}`, root.name);
  }
  const versioned = collectPackageJsons(projectDir, config)
    .filter(({ dir, pkg }) => resolve(dir) !== resolve(projectDir) && pkg.version)
    .map(({ dir, pkg }) => ({ file: `${relative(projectDir, dir).split(sep).join('/')}/package.json`, pkg }));
  if (versioned.length) {
    const published = versioned.filter(({ pkg }) => pkg.private !== true);
    if (published.length === 1) {
      const { file, pkg } = published[0];
      return withStatement(projectDir, `the root package.json declares no version; ${file} (${pkg.name || 'unnamed'}, version ${pkg.version}) is the only published workspace package, so its version is the project's`, pkg.name);
    }
    const listed = (published.length ? published : versioned).map(v => v.file).join(', ');
    return {
      applies: false,
      private: published.length === 0,
      evidence: published.length === 0
        ? `the root package.json declares no version and every workspace package that declares one is marked "private": true (${listed}), so nobody installs a versioned package`
        : `the root package.json declares no version and ${published.length} workspace packages are published (${listed}), so no single version is the project's`,
    };
  }
  const other = OTHER_VERSIONED_MANIFESTS.find(f => existsSync(resolve(projectDir, f)));
  if (other) return { applies: true, evidence: `${other} exists, a manifest that carries a version Metadata-Sync does not read`, otherManifest: other };
  return { applies: false, evidence: 'no package.json with a version field, and no other versioned manifest (pyproject.toml, Cargo.toml, pom.xml and similar)' };
}

function metadataContract(projectDir, config, performed, found) {
  return contractFields({
    performed, found, ran: `compared ${performed} version reference(s) with the version package.json declares`,
    decide: () => applies(projectDir, config),
    empty: (decision) => {
      if (!decision.applies && decision.noStatement) return { emptyCause: 'nothing-of-this-kind', note: `Metadata-Sync compared nothing because ${decision.evidence}.`, howToConfigure: 'Nothing to configure: with no document stating the version there is nothing to keep in step. If a document does state it (a URL with a version, a `version:` line, `<package>@x.y.z`), Metadata-Sync compares it with package.json from then on.' };
      if (!decision.applies && decision.private !== undefined) return { emptyCause: 'nothing-of-this-kind', note: `Metadata-Sync compared nothing because ${decision.evidence}.`, howToConfigure: 'Nothing to configure for a package nobody installs. If it is published, remove `"private": true` from the package.json that carries the version and Metadata-Sync keeps the documents that name it in step.' };
      if (!decision.applies) return { note: 'Metadata-Sync found no versioned manifest, so there is no version string to compare with the documents.', howToConfigure: 'Nothing to configure unless the project is versioned: then declare `version` in package.json and Metadata-Sync keeps the documents that name it in step.' };
      if (decision.otherManifest) return { emptyCause: 'layout-not-recognized', note: `Metadata-Sync reads the version from package.json only, and this project's version lives in ${decision.otherManifest}, so it compared no document with it.`, howToConfigure: `Metadata-Sync reads package.json and extension.yml versions, not ${decision.otherManifest}: that is a limit of DocGuard, and the project is not asked to add a package.json or change its manifest. Until DocGuard reads ${decision.otherManifest}, keep version references in the documents in step by hand; to have them checked, ask for ${decision.otherManifest} to be supported by opening an issue on the DocGuard repository.` };
      return { emptyCause: 'needs-content', note: `${decision.evidence}, but no reference was close enough to compare: Metadata-Sync flags a reference of the same major version that is older than package.json, so a newer or other-major version in a document was not compared.`, howToConfigure: 'Check the version a document states against package.json: a reference to another major version, or to a newer one, is not flagged. Make it match package.json, or remove it if it is not this package\'s version.' };
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
    for (const foundVersion of statedVersions(content, currentName)) {
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
  sharedWalkFiles(dir, callback);
}
