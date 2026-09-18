import { docRolePath, resolveDocRole } from '../shared-doc-roles.mjs';
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
 *
 * v0.29: migrated to structured findings (DCV001–DCV006). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings, so counts, exit codes, and
 * existing tests are unaffected; guard just renders richer output.
 */

import { existsSync, readFileSync, readdirSync, statSync, lstatSync } from 'node:fs';
import { resolve, join, relative, basename, extname, isAbsolute } from 'node:path';
import { resolveSourceRoots } from '../shared-source.mjs';
import { shouldIgnore, walkFiles as sharedWalkFiles, buildIgnoreFilter, mergeIgnoreFile, DEFAULT_IGNORE_DIRS } from '../shared-ignore.mjs';
import { resolveDocDirs } from '../shared.mjs';
import { parseJsTs, walk } from '../scanners/js-ast.mjs';
import { detectIaC, hasInfrastructureHeading, buildIaCWarning } from '../scanners/iac.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';

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
  '.dockerignore', '.python-version', '.tool-versions', '.ruby-version',
  '.gitkeep', '.keep',
  // DocGuard's own files — self-explanatory (embedded _comment / schema),
  // and flagging them creates a warning the moment a team adopts the tool
  // (e.g. `guard --update-baseline` writing the baseline instantly produced
  // a DCV001 about the baseline file itself).
  '.docguard.json', '.docguardignore', '.docguard.baseline.json',
]);

// Generated tool artifacts (caches, coverage data, lock-data) that land at the
// repo root but are NOT configuration a human authors or documents. Treating
// them as "undocumented config files" is a false positive (field test:
// a downstream project flagged pytest's `.coverage` SQLite data file). Matched by
// exact name OR prefix (`.coverage.<host>.<pid>` is coverage.py's parallel form).
const GENERATED_DOTFILE_PREFIXES = ['.coverage', '.eslintcache', '.stylelintcache', '.tsbuildinfo'];
function isGeneratedArtifact(name) {
  // `.bak` is written by DocGuard's own safeWrite before it overwrites a file.
  // Reporting it as an undocumented config file made the tool flag its own
  // backup (field report: `specs --write` -> DCV001 on
  // `.docguard-specs.json.bak`).
  if (name.endsWith('.bak')) return true;
  return GENERATED_DOTFILE_PREFIXES.some(p => name === p || name.startsWith(p + '.'));
}

/**
 * Validate that code artifacts are referenced in documentation.
 * @param {string} projectDir - Project root directory
 * @param {object} config - DocGuard config
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateDocsCoverage(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;

  // Collect all doc content for searching
  const allDocContent = collectDocContent(projectDir, config);
  if (!allDocContent) {
    // Literal legacy shape (no findings key) — tests deepEqual this exact object.
    return { errors: [], warnings: [], passed: 0, total: 0 };
  }

  // IaC detection runs once and informs both Check 3 (suppression) and
  // Check 6 (consolidated warning). One scan, two consumers.
  const iac = detectIaC(projectDir);

  // ── Check 1: Project-specific config/dotfiles referenced in docs ──
  const configChecks = checkConfigFiles(projectDir, allDocContent, config);
  total += configChecks.total;
  passed += configChecks.passed;
  findings.push(...configChecks.findings);

  // ── Check 2: package.json bin entries documented ──
  const binChecks = checkPackageBins(projectDir, allDocContent);
  total += binChecks.total;
  passed += binChecks.passed;
  findings.push(...binChecks.findings);

  // ── Check 3: Source directory structure matches ARCHITECTURE.md ──
  const dirChecks = checkSourceDirs(projectDir, allDocContent, config, iac);
  total += dirChecks.total;
  passed += dirChecks.passed;
  findings.push(...dirChecks.findings);

  // ── Check 4: Config filenames referenced in source code but not documented ──
  const codeConfigChecks = checkCodeReferencedConfigs(projectDir, allDocContent, config);
  total += codeConfigChecks.total;
  passed += codeConfigChecks.passed;
  findings.push(...codeConfigChecks.findings);

  // ── Check 5: README section completeness (Standard README spec) ──
  const readmeChecks = checkReadmeSections(projectDir);
  total += readmeChecks.total;
  passed += readmeChecks.passed;
  findings.push(...readmeChecks.findings);

  // ── Check 6: IaC-aware Infrastructure documentation ──
  const iacChecks = checkIaCDocumentation(projectDir, iac, config);
  total += iacChecks.total;
  passed += iacChecks.passed;
  findings.push(...iacChecks.findings);

  return resultFromFindings(findings, { passed, total });
}

// ── Check Functions ─────────────────────────────────────────────────────────

/**
 * Check 1: Project-specific config/dotfiles are mentioned in docs.
 * Skips universally common files (.gitignore, .eslintrc, etc.).
 * Honors config.ignore (FR-015 — applies user-configured ignore patterns
 * consistently across all docs-coverage checks).
 */
function checkConfigFiles(projectDir, allDocContent, config = {}) {
  const findings = [];
  let passed = 0;
  let total = 0;

  let entries;
  try { entries = readdirSync(projectDir); } catch { return { findings, passed, total }; }

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
    if (isGeneratedArtifact(entry)) continue;
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
      findings.push(mkFinding({
        code: 'DCV001',
        validator: 'docsCoverage',
        severity: 'warn',
        message: `Config file "${entry}" exists but is not mentioned in scanned supported Markdown or extension YAML documentation. Document its purpose in ARCHITECTURE.md or README.md`,
        location: entry,
        suggestion: { kind: 'fix', text: 'Explain what this config file does in ARCHITECTURE.md or README.md' },
      }));
    }
  }

  return { findings, passed, total };
}

/**
 * Check 2: package.json bin entries (CLI commands users run) are documented.
 */
function checkPackageBins(projectDir, allDocContent) {
  const findings = [];
  let passed = 0;
  let total = 0;

  const pkgPath = resolve(projectDir, 'package.json');
  if (!existsSync(pkgPath)) return { findings, passed, total };

  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')); } catch { return { findings, passed, total }; }

  const bins = typeof pkg.bin === 'string'
    ? { [pkg.name]: pkg.bin }
    : (pkg.bin || {});

  const lowerDocContent = allDocContent.toLowerCase();

  for (const [binName] of Object.entries(bins)) {
    total++;
    if (lowerDocContent.includes(binName.toLowerCase())) {
      passed++;
    } else {
      findings.push(mkFinding({
        code: 'DCV002',
        validator: 'docsCoverage',
        severity: 'warn',
        message: `package.json defines CLI command "${binName}" but it's not mentioned in any documentation`,
        location: 'package.json',
        suggestion: { kind: 'fix', text: `Document the "${binName}" command in README.md (e.g. under Usage)` },
      }));
    }
  }

  return { findings, passed, total };
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
  const findings = [];
  let passed = 0;
  let total = 0;

  const archPath = resolveDocRole(projectDir, config, 'architecture');
  if (!existsSync(archPath)) return { findings, passed, total };

  let archContent;
  try { archContent = readFileSync(archPath, 'utf-8'); } catch { return { findings, passed, total }; }

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
        findings.push(mkFinding({
          code: 'DCV003',
          validator: 'docsCoverage',
          severity: 'warn',
          message: `Source directory "${root}/${entry}/" is not referenced in ARCHITECTURE.md`,
          location: relPath,
          suggestion: { kind: 'fix', text: 'Add this directory to the Component Map in docs-canonical/ARCHITECTURE.md' },
        }));
      }
    }
  }

  return { findings, passed, total };
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
function checkIaCDocumentation(projectDir, iac, config = {}) {
  const findings = [];
  if (!iac || !iac.isIaC) return { findings, passed: 0, total: 0 };

  const archPath = resolveDocRole(projectDir, config, 'architecture');
  if (!existsSync(archPath)) {
    // No ARCHITECTURE.md at all — structure validator will catch that.
    // Don't double-warn here.
    return { findings, passed: 0, total: 0 };
  }

  let archContent;
  try { archContent = readFileSync(archPath, 'utf-8'); } catch { return { findings, passed: 0, total: 0 }; }

  if (hasInfrastructureHeading(archContent)) {
    // One pass per tool — counted as total per IaC tool present.
    return { findings, passed: iac.tools.length, total: iac.tools.length };
  }

  // One actionable warning per detected IaC tool. Most projects use one tool,
  // but a multi-tool monorepo gets one targeted message each.
  for (const tool of iac.tools) {
    findings.push(mkFinding({
      code: 'DCV006',
      validator: 'docsCoverage',
      severity: 'warn',
      message: buildIaCWarning(tool),
      location: docRolePath(config, 'architecture'),
      suggestion: { kind: 'fix', text: `Add an "Infrastructure" section to ARCHITECTURE.md covering the ${tool.label} layout` },
    }));
  }
  return { findings, passed: 0, total: iac.tools.length };
}

/**
 * Check 4: Distinguish direct file IO from config-like path expressions.
 * Parsed calls exclude comments and example strings. Unparsed text supplies
 * review candidates only; it cannot establish file IO or documentation need.
 */
function checkCodeReferencedConfigs(projectDir, allDocContent, config = {}) {
  const findings = [];
  let passed = 0;
  let total = 0;
  const lowerDocContent = allDocContent.toLowerCase();
  const foundConfigs = new Map();
  const methods = new Set(['resolve', 'join', 'existsSync', 'accessSync', 'readFileSync', 'writeFileSync']);
  const directIO = new Set(['readFileSync', 'writeFileSync']);

  const scanFile = (filePath) => {
    if (!['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'].includes(extname(filePath))) return;
    let content;
    try { content = readFileSync(filePath, 'utf-8'); } catch { return; }
    if (!/(?:resolve|join|existsSync|accessSync|readFileSync|writeFileSync)\s*\(/.test(content)) return;
    // Parsing cannot yield a config candidate without a matching literal prefix.
    // Keep every escaped source conservatively: escapes may encode that prefix.
    if (!/['"\x60](?:\.(?![./])|[\w-]+\.config\.)|\\/.test(content)) return;
    const source = relative(projectDir, filePath).split('\\').join('/');
    const record = (name, method, line, parsed) => {
      if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || name.startsWith('..')) return;
      if (!(name.startsWith('.') && name.length > 2) && !/^[\w-]+\.config\.\w+$/.test(name)) return;
      if (/^\.[a-z]{1,4}$/i.test(name) || COMMON_DOTFILES.has(name)) return;
      const direct = parsed && directIO.has(method);
      // Prefer concrete IO when the same name also occurs in a path expression.
      if (!foundConfigs.has(name) || (direct && !foundConfigs.get(name).direct)) {
        foundConfigs.set(name, { direct, parsed, method, source: source + ':' + line });
      }
    };
    const { ast, ok } = parseJsTs(content, filePath);
    if (ok && !ast.errors?.length) {
      walk(ast, node => {
        if (node.type !== 'CallExpression') return;
        const callee = node.callee;
        const method = callee.type === 'Identifier' ? callee.name
          : callee.type === 'MemberExpression' && !callee.computed ? callee.property.name : null;
        if (!methods.has(method)) return;
        // IO and existence checks use argument one as the path; join/resolve
        // may supply a filename in any segment. No dynamic-path evaluation.
        const args = ['join', 'resolve'].includes(method) ? node.arguments : node.arguments.slice(0, 1);
        for (const arg of args) {
          const value = arg.type === 'StringLiteral' ? arg.value
            : arg.type === 'TemplateLiteral' && arg.expressions.length === 0 ? arg.quasis[0].value.cooked : null;
          record(value, method, node.loc.start.line, true);
        }
      });
    } else {
      const pattern = /\b(resolve|join|existsSync|accessSync|readFileSync|writeFileSync)\s*\([^)]*?['"\x60]([^'"\x60\n]{2,})['"\x60]/g;
      for (const match of content.matchAll(pattern)) {
        record(match[2], match[1], content.slice(0, match.index).split('\n').length, false);
      }
    }
  };

  for (const rootDir of resolveSourceRoots(projectDir, config)) {
    walkFiles(rootDir, scanFile);
  }

  for (const [configName, evidence] of foundConfigs) {
    total++;
    if (lowerDocContent.includes(configName.toLowerCase())) {
      passed++;
    } else {
      const scope = 'scanned supported Markdown or extension YAML documentation';
      const context = evidence.parsed ? evidence.method + ' call' : 'unparsed source text (parser unavailable or failed)';
      findings.push(mkFinding({
        code: 'DCV004',
        validator: 'docsCoverage',
        severity: 'warn',
        confidence: evidence.direct ? 'high' : 'low',
        message: evidence.direct
          ? 'Direct ' + context + ' references config file "' + configName + '" at ' + evidence.source + ', but it is not mentioned in ' + scope + '.'
          : 'Config-like path "' + configName + '" appears in ' + context + ' at ' + evidence.source + '; file use and documentation need are unverified. No mention was found in ' + scope + '.',
        // Preserve the published filename location; source context is in the message.
        location: configName,
        suggestion: evidence.direct
          ? { kind: 'fix', text: 'Describe this config file (purpose and format) in a supported documentation file' }
          : { kind: 'review', text: 'Inspect this source reference: it may be a directory, generated output, or example. Document it only if appropriate.' },
      }));
    }
  }

  return { findings, passed, total };
}

/**
 * Check 5: README section completeness.
 * Inspired by Standard README (https://github.com/RichardLitt/standard-readme)
 * and Make a README (https://www.makeareadme.com/).
 */
function checkReadmeSections(projectDir) {
  const findings = [];
  let passed = 0;
  let total = 0;

  const readmePath = resolve(projectDir, 'README.md');
  if (!existsSync(readmePath)) return { findings, passed, total };

  let content;
  try { content = readFileSync(readmePath, 'utf-8'); } catch { return { findings, passed, total }; }

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
      findings.push(mkFinding({
        code: 'DCV005',
        validator: 'docsCoverage',
        severity: 'warn',
        message: `README.md is missing a "${section.name}" section (Standard README spec)`,
        location: 'README.md',
        suggestion: { kind: 'fix', text: `Add a "${section.name}" section to README.md` },
      }));
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

  return { findings, passed, total };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Collect all documentation content into a single searchable string.
 */
function collectDocContent(projectDir, config = {}) {
  const docPaths = new Set();
  const visited = new Set();
  const isIgnored = buildIgnoreFilter(mergeIgnoreFile(projectDir, { ...config }).ignore);

  // Check every ancestor before traversal: the shared walker follows symlinks.
  // Explicit homes must remain scoped inside the project, including private aliases.
  const safePath = (path) => {
    const normalized = path.replace(/\\/g, '/');
    if (isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) || normalized.includes('\0')) return null;
    const parts = normalized.split('/').filter(p => p && p !== '.');
    if (!parts.length || parts.some(p => p === '..' || ['.local', '.git'].includes(p.toLowerCase())
        || /^\.env(?:\.|$)/i.test(p) || DEFAULT_IGNORE_DIRS.has(p) || IGNORE_DIRS.has(p))) return null;
    let current = resolve(projectDir);
    let rel = '';
    try {
      for (const part of parts) {
        rel = rel ? rel + '/' + part : part;
        if (isIgnored(rel) || isIgnored(rel + '/')) return null;
        current = join(current, part);
        if (lstatSync(current).isSymbolicLink()) return null;
      }
      return current;
    } catch { return null; }
  };
  const addDoc = (rel) => {
    const abs = safePath(rel);
    if (abs && lstatSync(abs).isFile()) docPaths.add(abs);
  };
  const walkDocs = (rel) => {
    const dir = safePath(rel);
    if (!dir || visited.has(dir)) return;
    visited.add(dir);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = relative(projectDir, join(dir, entry.name)).split('\\').join('/');
      if (entry.isDirectory() && !entry.name.startsWith('.')) walkDocs(path);
      else if (entry.isFile() && (/\.md$/i.test(entry.name)
          || (path.startsWith('extensions/') && /\.ya?ml$/i.test(entry.name)))) addDoc(path);
    }
  };

  for (const doc of ['README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'STANDARD.md']) addDoc(doc);
  for (const dir of resolveDocDirs(projectDir, config)) walkDocs(dir);
  // Resolve roles directly so raw callers get the same boundaries as loadConfig.
  for (const role of Object.keys(config.docs?.roles || {})) {
    const abs = resolveDocRole(projectDir, config, role);
    addDoc(relative(projectDir, abs));
  }

  if (docPaths.size === 0) return null;
  const parts = [];
  for (const p of docPaths) {
    try { parts.push(readFileSync(p, 'utf-8')); } catch { /* skip */ }
  }
  return parts.join('\n');
}

// v0.29 consolidation: traversal delegates to the shared canonical walker.
function walkFiles(dir, callback) {
  sharedWalkFiles(dir, callback, { ignoreDirs: IGNORE_DIRS });
}
