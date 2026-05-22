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

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
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

  // ── Check 1: Project-specific config/dotfiles referenced in docs ──
  const configChecks = checkConfigFiles(projectDir, allDocContent);
  total += configChecks.total;
  passed += configChecks.passed;
  warnings.push(...configChecks.warnings);

  // ── Check 2: package.json bin entries documented ──
  const binChecks = checkPackageBins(projectDir, allDocContent);
  total += binChecks.total;
  passed += binChecks.passed;
  warnings.push(...binChecks.warnings);

  // ── Check 3: Source directory structure matches ARCHITECTURE.md ──
  const dirChecks = checkSourceDirs(projectDir, allDocContent, config);
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

  return { errors: [], warnings, passed, total };
}

// ── Check Functions ─────────────────────────────────────────────────────────

/**
 * Check 1: Project-specific config/dotfiles are mentioned in docs.
 * Skips universally common files (.gitignore, .eslintrc, etc.).
 */
function checkConfigFiles(projectDir, allDocContent) {
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
 */
function checkSourceDirs(projectDir, allDocContent, config = {}) {
  const warnings = [];
  let passed = 0;
  let total = 0;

  const archPath = resolve(projectDir, 'docs-canonical/ARCHITECTURE.md');
  if (!existsSync(archPath)) return { warnings, passed, total };

  let archContent;
  try { archContent = readFileSync(archPath, 'utf-8'); } catch { return { warnings, passed, total }; }

  const lowerArchContent = archContent.toLowerCase();

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

  for (const section of recommendedSections) {
    total++;
    if (section.patterns.some(p => lowerContent.includes(p))) {
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
