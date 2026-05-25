/**
 * Docs-Coverage Validator — Detects code features not referenced in docs.
 *
 * Generic validator for ANY project type. Scans the project for
 * "documentable artifacts" and checks if at least one canonical doc
 * or README references them.
 *
 * What it catches:
 *  - Config/dotfiles at root not mentioned in docs
 *  - Config filenames referenced in source code (resolve/readFile calls) but not documented
 *  - package.json bin entries not documented
 *  - Source directories not referenced in ARCHITECTURE.md
 *  - README.md missing standard sections (inspired by Standard README spec)
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, basename, extname } from 'node:path';
import { resolveSourceRoots } from '../shared-source.mjs';
import { shouldIgnore } from '../shared-ignore.mjs';
import { detectIaC, hasInfrastructureHeading, buildIaCWarning } from '../scanners/iac.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', '.nuxt', 'dist', 'build', 'out',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  '.turbo', '.vercel', '.svelte-kit', 'cdk.out', '.claude',
  'target', '.gradle',
]);

// Dotfiles that are universally common and don't need documentation
const COMMON_DOTFILES = new Set([
  '.gitignore', '.gitattributes', '.git', '.DS_Store',
  '.editorconfig', '.prettierrc', '.prettierignore',
  '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.cjs',
  '.eslintignore', '.nvmrc', '.node-version', '.npmrc', '.npmignore',
  '.env', '.env.local', '.env.development', '.env.production',
  '.vscode', '.idea', '.github', '.husky',
  '.babelrc', '.browserslistrc', '.stylelintrc',
]);

/**
 * Validate that code artifacts are referenced in documentation.
 * @param {string} projectDir - Project root directory
 * @param {object} config - DocGuard config
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateDocsCoverage(projectDir, config) {
  const warnings = [];
  let passed = 0;
  let total = 0;

  // Collect all doc content for searching
  const allDocContent = collectDocContent(projectDir);
  if (!allDocContent) {
    return { errors: [], warnings, passed: 0, total: 0 };
  }

  // IaC detection runs once and informs both Check 3 (suppression) and
  // Check 6 (consolidated warning). One scan, two consumers.
  const iac = detectIaC(projectDir);

  // ── Check 1: Project-specific config/dotfiles referenced in docs ──
  const configChecks = checkConfigFiles(projectDir, allDocContent, config);
  total += configChecks.total;
  passed += configChecks.passed;
  warnings.push(...configChecks.warnings);

  // ── Check 2: package.json bin entries documented ──
  const binChecks = checkPackageBins(projectDir, allDocContent);
  total += binChecks.total;
  passed += binChecks.passed;
  warnings.push(...binChecks.warnings);

  // ── Check 3: Source directory structure matches ARCHITECTURE.md ──
  const dirChecks = checkSourceDirs(projectDir, allDocContent, config, iac);
  total += dirChecks.total;
  passed += dirChecks.passed;
  warnings.push(...dirChecks.warnings);

  // ── Check 4: Config filenames referenced in source code but not documented ──
  const codeConfigChecks = checkCodeReferencedConfigs(projectDir, allDocContent, config);
  total += codeConfigChecks.total;
  passed += codeConfigChecks.passed;
  warnings.push(...codeConfigChecks.warnings);

  // ── Check 5: README section completeness (Standard README spec) ──
  const readmeChecks = checkReadmeSections(projectDir);
  total += readmeChecks.total;
  passed += readmeChecks.passed;
  warnings.push(...readmeChecks.warnings);

  // ── Check 6: IaC-aware Infrastructure documentation ──
  const iacChecks = checkIaCDocumentation(projectDir, iac);
  total += iacChecks.total;
  passed += iacChecks.passed;
  warnings.push(...iacChecks.warnings);

  return { errors: [], warnings, passed, total };
}

// ── Check Functions ─────────────────────────────────────────────────────────

/**
 * Check 1: Project-specific config/dotfiles are mentioned in docs.
 * Skips universally common files (.gitignore, .eslintrc, etc.).
 * Honors config.ignore (FR-015 — applies user-configured ignore patterns
 * consistently across all docs-coverage checks).
 */
function checkConfigFiles(projectDir, allDocContent, config = {}) {
  const warnings = [];
  let passed = 0;
  let total = 0;

  let entries;
  try { entries = readdirSync(projectDir); } catch { return { warnings, passed, total }; }

  const lowerDocContent = allDocContent.toLowerCase();

  for (const entry of entries) {
    const isDotFile = entry.startsWith('.');
    const isProjectConfig = entry.endsWith('.config.js') ||
      entry.endsWith('.config.ts') ||
      entry.endsWith('.config.mjs') ||
      entry.endsWith('.config.cjs') ||
      entry.endsWith('.json') && !['package.json', 'package-lock.json', 'tsconfig.json'].includes(entry);

    if (!isDotFile && !isProjectConfig) continue;
    if (COMMON_DOTFILES.has(entry)) continue;
    if (entry === 'tsconfig.json' || entry === 'package-lock.json') continue;

    // Skip directories — this check is for configuration FILES, not dirs.
    // Build-cache dotdirs (.nuxt, .next, .turbo, etc.) are handled by IGNORE_DIRS.
    try {
      if (statSync(join(projectDir, entry)).isDirectory()) continue;
    } catch { continue; }

    // Honor user-configured ignore patterns (FR-015 / IR-5).
    // Same dual-form check as checkSourceDirs: relative path and trailing-slash
    // form so dotfile-style patterns and dir-style patterns both apply.
    if (shouldIgnore(entry, config) || shouldIgnore(entry + '/', config)) continue;

    total++;
    if (lowerDocContent.includes(entry.toLowerCase())) {
      passed++;
    } else {
      warnings.push(
        `Config file "${entry}" exists but is not mentioned in any documentation. Document its purpose in ARCHITECTURE.md or README.md`
      );
    }
  }

  return { warnings, passed, total };
}

/**
 * Check 2: package.json bin entries (CLI commands users run) are documented.
 */
function checkPackageBins(projectDir, allDocContent) {
  const warnings = [];
  let passed = 0;
  let total = 0;

  const pkgPath = resolve(projectDir, 'package.json');
  if (!existsSync(pkgPath)) return { warnings, passed, total };

  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')); } catch { return { warnings, passed, total }; }

  const bins = typeof pkg.bin === 'string'
    ? { [pkg.name]: pkg.bin }
    : (pkg.bin || {});

  const lowerDocContent = allDocContent.toLowerCase();

  for (const [binName] of Object.entries(bins)) {
    total++;
    if (lowerDocContent.includes(binName.toLowerCase())) {
      passed++;
    } else {
      warnings.push(
        `package.json defines CLI command "${binName}" but it's not mentioned in any documentation`
      );
    }
  }

  return { warnings, passed, total };
}

/**
 * Check 3: Source directories are referenced in ARCHITECTURE.md.
 *
 * Honors config.ignore (FR-006). When IaC is detected and the Infrastructure
 * heading is missing, per-directory warnings inside the IaC package roots
 * are suppressed — Check 6 emits one consolidated warning per IaC tool
 * instead (FR-011).
 */
function checkSourceDirs(projectDir, allDocContent, config = {}, iac = { isIaC: false, tools: [] }) {
  const warnings = [];
  let passed = 0;
  let total = 0;

  const archPath = resolve(projectDir, 'docs-canonical/ARCHITECTURE.md');
  if (!existsSync(archPath)) return { warnings, passed, total };

  let archContent;
  try { archContent = readFileSync(archPath, 'utf-8'); } catch { return { warnings, passed, total }; }

  const lowerArchContent = archContent.toLowerCase();
  const infraDocumented = hasInfrastructureHeading(archContent);

  // Only suppress per-dir warnings when IaC exists AND no Infrastructure
  // heading is present — Check 6 will fire the consolidated message instead.
  const suppressIaCDirs = iac.isIaC && !infraDocumented;

  // Flatten every IaC tool's package dirs into a single Set for fast lookup.
  const iacPackageDirs = [];
  for (const tool of iac.tools) iacPackageDirs.push(...tool.packageDirs);

  // Monorepo-aware: honor config.sourceRoot + workspaces instead of a hardcoded list.
  for (const rootDir of resolveSourceRoots(projectDir, config)) {
    const root = relative(projectDir, rootDir) || basename(rootDir);
    let entries;
    try { entries = readdirSync(rootDir); } catch { continue; }

    for (const entry of entries) {
      const fullPath = join(rootDir, entry);
      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) continue;
      } catch { continue; }

      if (IGNORE_DIRS.has(entry) || entry.startsWith('.') || entry === '__tests__' || entry === '__test__') continue;

      const relPath = relative(projectDir, fullPath);

      // Honor user-configured ignore patterns (FR-006 / IR-5).
      // Patterns like `**/cdk.out/**` are written to match files INSIDE the
      // directory; appending '/' lets us match the directory itself too.
      if (shouldIgnore(relPath, config) || shouldIgnore(relPath + '/', config)) continue;

      // Suppress per-dir warnings for IaC-relevant subdirs inside an IaC
      // package — the consolidated Check 6 warning covers them. Includes CDK
      // (bin/, lib/, stacks/, constructs/), Terraform (modules/, environments/),
      // Pulumi (stacks/), SAM (events/, src/), Serverless (handlers/, src/).
      if (suppressIaCDirs && isInsideIaCPackage(relPath, iacPackageDirs)
          && IAC_SUBDIR_NAMES.has(entry)) {
        continue;
      }

      total++;
      const searchName = entry.toLowerCase();
      if (lowerArchContent.includes(searchName) || lowerArchContent.includes(root + '/' + entry)) {
        passed++;
      } else {
        warnings.push(
          `Source directory "${root}/${entry}/" is not referenced in ARCHITECTURE.md`
        );
      }
    }
  }

  return { warnings, passed, total };
}

/**
 * Subdirectory names recognized as IaC-relevant across all supported tools.
 * When IaC is detected and the Infrastructure heading is missing, these dirs
 * inside the IaC package are suppressed from Check 3 to avoid double-warning.
 */
const IAC_SUBDIR_NAMES = new Set([
  // CDK
  'bin', 'lib', 'stacks', 'constructs',
  // Terraform
  'modules', 'environments',
  // SAM / Serverless / Pulumi
  'handlers', 'events', 'src',
]);

/**
 * True if `relPath` is inside any of the IaC package directories.
 * Both inputs are project-relative POSIX paths.
 */
function isInsideIaCPackage(relPath, packageDirs) {
  if (!packageDirs || packageDirs.length === 0) return false;
  const normalized = relPath.split('\\').join('/');
  return packageDirs.some(pkgDir => {
    const p = pkgDir === '.' ? '' : pkgDir.split('\\').join('/');
    if (p === '') return true;
    return normalized === p || normalized.startsWith(p + '/');
  });
}

/**
 * Check 6: IaC projects should document their Infrastructure layer.
 *
 * Emits ONE consolidated warning per detected IaC tool when ARCHITECTURE.md
 * has no Infrastructure heading. Suppresses the generic per-directory
 * warnings that would otherwise fire for bin/, lib/, modules/, handlers/, etc.
 */
function checkIaCDocumentation(projectDir, iac) {
  const warnings = [];
  if (!iac || !iac.isIaC) return { warnings, passed: 0, total: 0 };

  const archPath = resolve(projectDir, 'docs-canonical/ARCHITECTURE.md');
  if (!existsSync(archPath)) {
    // No ARCHITECTURE.md at all — structure validator will catch that.
    // Don't double-warn here.
    return { warnings, passed: 0, total: 0 };
  }

  let archContent;
  try { archContent = readFileSync(archPath, 'utf-8'); } catch { return { warnings, passed: 0, total: 0 }; }

  if (hasInfrastructureHeading(archContent)) {
    // One pass per tool — counted as total per IaC tool present.
    return { warnings, passed: iac.tools.length, total: iac.tools.length };
  }

  // One actionable warning per detected IaC tool. Most projects use one tool,
  // but a multi-tool monorepo gets one targeted message each.
  for (const tool of iac.tools) {
    warnings.push(buildIaCWarning(tool));
  }
  return { warnings, passed: 0, total: iac.tools.length };
}

/**
 * Check 4: Config files that code actually READS are documented.
 *
 * Scans source code for resolve(dir, '.configname') and existsSync('.configname')
 * patterns — these are configs the project USES. Avoids matching config names
 * sitting in arrays (scan patterns for detecting other projects' configs).
 */
function checkCodeReferencedConfigs(projectDir, allDocContent, config = {}) {
  const warnings = [];
  let passed = 0;
  let total = 0;

  const lowerDocContent = allDocContent.toLowerCase();
  const foundConfigs = new Set();

  // Only match config filenames inside function calls that actually USE the file:
  // resolve(dir, '.docguardignore'), existsSync('.env.example'), readFileSync('vitest.config.ts')
  const usageRegex = /(?:resolve|join|existsSync|readFileSync|accessSync|writeFileSync)\s*\([^)]*['"`]([^'"`\n]{2,})['"`]/g;

  const scanFile = (filePath) => {
    const ext = extname(filePath);
    if (!['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(ext)) return;
    let content;
    try { content = readFileSync(filePath, 'utf-8'); } catch { return; }

    usageRegex.lastIndex = 0;
    let match;
    while ((match = usageRegex.exec(content)) !== null) {
      const name = match[1];
      // Must be a dotfile (.something) or *.config.* — not a path
      if (name.includes('/') || name.startsWith('..')) continue;
      const isDotConfig = name.startsWith('.') && name.length > 2;
      const isNamedConfig = /^[\w-]+\.config\.\w+$/.test(name);
      if (!isDotConfig && !isNamedConfig) continue;
      // Skip bare extensions
      if (/^\.[a-z]{1,4}$/i.test(name)) continue;
      foundConfigs.add(name);
    }
  };

  for (const rootDir of resolveSourceRoots(projectDir, config)) {
    walkFiles(rootDir, scanFile);
  }

  for (const configName of foundConfigs) {
    if (COMMON_DOTFILES.has(configName)) continue;
    total++;
    if (lowerDocContent.includes(configName.toLowerCase())) {
      passed++;
    } else {
      warnings.push(
        `Code references config file "${configName}" but no documentation mentions it. Add it to README.md or ARCHITECTURE.md`
      );
    }
  }

  return { warnings, passed, total };
}

/**
 * Check 5: README section completeness.
 * Inspired by Standard README (https://github.com/RichardLitt/standard-readme)
 * and Make a README (https://www.makeareadme.com/).
 */
function checkReadmeSections(projectDir) {
  const warnings = [];
  let passed = 0;
  let total = 0;

  const readmePath = resolve(projectDir, 'README.md');
  if (!existsSync(readmePath)) return { warnings, passed, total };

  let content;
  try { content = readFileSync(readmePath, 'utf-8'); } catch { return { warnings, passed, total }; }

  const lowerContent = content.toLowerCase();

  // Required sections — every well-documented project should have these
  const requiredSections = [
    { name: 'Installation', patterns: ['install', 'getting started', 'setup', 'quickstart', 'quick start'] },
    { name: 'Usage', patterns: ['usage', 'how to use', 'examples', 'getting started'] },
    { name: 'License', patterns: ['license', 'licence'] },
  ];

  // Recommended — count toward score but don't warn
  const recommendedSections = [
    { name: 'Contributing', patterns: ['contributing', 'contribution', 'how to contribute'] },
    { name: 'Description', patterns: ['## what', '## about', '## description', '## overview'] },
  ];

  for (const section of requiredSections) {
    total++;
    if (section.patterns.some(p => lowerContent.includes(p))) {
      passed++;
    } else {
      warnings.push(`README.md is missing a "${section.name}" section (Standard README spec)`);
    }
  }

  // Recommended sections are a BONUS — present = +1 to both passed and total,
  // missing = no-op. Counting missing recommended toward `total` without a
  // corresponding warning would be a silent fail (caught by B-4 nudge).
  for (const section of recommendedSections) {
    if (section.patterns.some(p => lowerContent.includes(p))) {
      total++;
      passed++;
    }
  }

  return { warnings, passed, total };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Collect all documentation content into a single searchable string.
 */
function collectDocContent(projectDir) {
  const docPaths = [];

  const rootDocs = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'STANDARD.md'];
  for (const doc of rootDocs) {
    const p = resolve(projectDir, doc);
    if (existsSync(p)) docPaths.push(p);
  }

  const canonDir = resolve(projectDir, 'docs-canonical');
  if (existsSync(canonDir)) {
    try {
      for (const entry of readdirSync(canonDir)) {
        if (entry.endsWith('.md')) docPaths.push(resolve(canonDir, entry));
      }
    } catch { /* skip */ }
  }

  const extDir = resolve(projectDir, 'extensions');
  if (existsSync(extDir)) {
    walkFiles(extDir, (f) => {
      if (f.endsWith('.md') || f.endsWith('.yml') || f.endsWith('.yaml')) {
        docPaths.push(f);
      }
    });
  }

  for (const docsDir of ['docs', 'docs-implementation']) {
    const d = resolve(projectDir, docsDir);
    if (existsSync(d)) {
      walkFiles(d, (f) => {
        if (f.endsWith('.md')) docPaths.push(f);
      });
    }
  }

  if (docPaths.length === 0) return null;
  const parts = [];
  for (const p of docPaths) {
    try { parts.push(readFileSync(p, 'utf-8')); } catch { /* skip */ }
  }
  return parts.join('\n');
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
