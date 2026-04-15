/**
 * Traceability Validator — Checks that canonical docs are linked to source code
 * 
 * Two modes:
 *   1. Source Traceability: Canonical docs reference actual source files
 *   2. Requirement Traceability (V-Model): Requirement IDs in docs trace to tests
 *
 * Requirement traceability is opt-in by convention — if no requirement IDs are
 * found (REQ-001, FR-001, etc.), the check silently passes. Once you add IDs,
 * DocGuard automatically enforces traceability.
 *
 * Inspired by ISO/IEC/IEEE 29119, IEEE 1016, and V-Model methodology.
 * V-Model concepts informed by spec-kit-v-model (github.com/leocamello/spec-kit-v-model).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, basename, extname } from 'node:path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
  '.amplify-hosting', '.serverless',
]);

/**
 * Mapping of canonical docs to source code patterns they should trace to.
 */
const TRACE_MAP = {
  'ARCHITECTURE.md': {
    sourcePatterns: [
      { label: 'Entry points', glob: /^(index|main|app|server)\.[jt]sx?$/ },
      { label: 'Config files', glob: /^(package\.json|tsconfig.*|next\.config|vite\.config)/ },
      { label: 'Route handlers', glob: /(routes?|api|pages|app)\// },
    ],
  },
  'DATA-MODEL.md': {
    sourcePatterns: [
      { label: 'Schema definitions', glob: /(schema|model|entity|migration|prisma)/i },
      { label: 'Type definitions', glob: /types?\.[jt]sx?$/ },
      { label: 'Database configs', glob: /(drizzle|knex|sequelize|typeorm)/i },
    ],
  },
  'TEST-SPEC.md': {
    sourcePatterns: [
      { label: 'Test files', glob: /\.(test|spec)\.(mjs|cjs|[jt]sx?)$/ },
      { label: 'Test config', glob: /(jest|vitest|playwright|cypress)\.config/ },
      { label: 'E2E tests', glob: /(e2e|integration)\// },
    ],
  },
  'SECURITY.md': {
    sourcePatterns: [
      { label: 'Auth modules', glob: /(auth|login|session|jwt|oauth|middleware)/i },
      { label: 'Secret configs', glob: /\.(env|env\.example|env\.local)$/ },
      { label: 'Gitignore', glob: /^\.gitignore$/ },
    ],
  },
  'ENVIRONMENT.md': {
    sourcePatterns: [
      { label: 'Env files', glob: /\.env/ },
      { label: 'Docker configs', glob: /(Dockerfile|docker-compose|\.dockerignore)/ },
      { label: 'CI/CD configs', glob: /\.(github|gitlab-ci|circleci)/ },
    ],
  },
  'API-REFERENCE.md': {
    sourcePatterns: [
      { label: 'Route handlers', glob: /(routes?|controllers?|handlers?)\// },
      { label: 'OpenAPI spec', glob: /(openapi|swagger)\.(json|ya?ml)/ },
      { label: 'API middleware', glob: /middleware\// },
    ],
  },
};

// ──── Default requirement ID patterns ────
// Users can override via config.traceability.requirementPattern
// Includes spec-kit standard IDs: FR-xxx, SC-xxx, T-xxx
const DEFAULT_REQ_PATTERNS = [
  /\b(REQ)-(\d{2,4})\b/g,
  /\b(FR)-(\d{2,4})\b/g,
  /\b(NFR)-(\d{2,4})\b/g,
  /\b(US)-(\d{2,4})\b/g,
  /\b(STORY)-(\d{2,4})\b/g,
  /\b(AC)-(\d{2,4})\b/g,
  /\b(UC)-(\d{2,4})\b/g,
  /\b(SYS)-(\d{2,4})\b/g,
  /\b(ARCH)-(\d{2,4})\b/g,
  /\b(MOD)-(\d{2,4})\b/g,
  /\b(SC)-(\d{2,4})\b/g,     // Spec Kit: Success Criteria
  /\b(T)(\d{3,4})\b/g,       // Spec Kit: Task IDs (T001, T002)
];

/**
 * Validate traceability — ensures canonical docs have corresponding source artifacts,
 * and requirement IDs trace through to test files.
 * Respects config.requiredFiles.canonical — only checks docs the user requires.
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateTraceability(projectDir, config) {
  const errors = [];
  const warnings = [];
  let passed = 0;
  let total = 0;

  const docsDir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(docsDir)) {
    // No docs-canonical dir at all — structure validator handles this
    return { errors, warnings, passed: 0, total: 0 };
  }

  // Build set of required doc basenames from config
  const requiredDocs = new Set(
    (config.requiredFiles?.canonical || []).map(f => basename(f))
  );

  // Scan project files once
  const projectFiles = [];
  scanDir(projectDir, projectDir, projectFiles);

  // ── Part 1: Source Traceability (existing) ──
  for (const [docName, traceInfo] of Object.entries(TRACE_MAP)) {
    // Skip docs not in the user's required list
    if (!requiredDocs.has(docName)) continue;

    total++;
    const docPath = resolve(docsDir, docName);
    const docExists = existsSync(docPath);

    if (!docExists) {
      warnings.push(`${docName} — required but missing, no traceability possible`);
      continue;
    }

    // Count matching source files
    let totalSources = 0;
    for (const pattern of traceInfo.sourcePatterns) {
      const matches = projectFiles.filter(f => pattern.glob.test(f));
      totalSources += matches.length;
    }

    if (totalSources > 0) {
      passed++;
    } else {
      warnings.push(`${docName} — exists but no matching source code found (unlinked doc)`);
    }
  }

  // ── Detect orphaned files (exist but not required) ──
  try {
    const existingDocs = readdirSync(docsDir).filter(f => f.endsWith('.md'));
    for (const docFile of existingDocs) {
      if (!requiredDocs.has(docFile) && TRACE_MAP[docFile]) {
        warnings.push(`${docFile} — file exists in docs-canonical/ but is not in your requiredFiles config. Consider deleting it or adding it to .docguard.json requiredFiles.canonical`);
      }
    }
  } catch { /* ignore */ }

  // ── Part 2: Requirement ID Traceability (V-Model) ──
  const reqResult = validateRequirementTraceability(projectDir, config, projectFiles);
  errors.push(...reqResult.errors);
  warnings.push(...reqResult.warnings);
  passed += reqResult.passed;
  total += reqResult.total;

  return { errors, warnings, passed, total };
}

// ──── Requirement ID Traceability ────────────────────────────────────────────

/**
 * Scan docs for requirement IDs and verify they appear in test files.
 *
 * Behavior:
 *   - If no requirement IDs found anywhere → silently passes (0 checks)
 *   - If IDs found → validates each has a matching test reference
 *   - Reports untraced requirements and orphaned test refs
 */
function validateRequirementTraceability(projectDir, config, projectFiles) {
  const errors = [];
  const warnings = [];
  let passed = 0;
  let total = 0;

  // Get requirement patterns (user-configurable or defaults)
  const customPattern = config.traceability?.requirementPattern;
  const patterns = customPattern
    ? [new RegExp(customPattern, 'g')]
    : DEFAULT_REQ_PATTERNS;

  // ── Step 1: Collect requirement IDs from documentation ──
  const reqIds = new Map(); // reqId → { file, line }
  const docSearchPaths = getRequirementDocPaths(projectDir, config);

  for (const docPath of docSearchPaths) {
    if (!existsSync(docPath)) continue;

    const content = readFileSync(docPath, 'utf-8');

    // Fast early-return: skip expensive string split if no requirement patterns exist
    const hasMatch = patterns.some(p => { p.lastIndex = 0; return p.test(content); });
    if (!hasMatch) continue;

    const lines = content.split('\n');
    const docName = relative(projectDir, docPath);

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        // Reset regex lastIndex for each line
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(lines[i])) !== null) {
          const reqId = match[0]; // e.g., "REQ-001"
          if (!reqIds.has(reqId)) {
            reqIds.set(reqId, { file: docName, line: i + 1 });
          }
        }
      }
    }
  }

  // If no requirement IDs found, silently pass — this project doesn't use them
  if (reqIds.size === 0) {
    return { errors, warnings, passed, total };
  }

  // ── Step 2: Scan test files for requirement ID references ──
  const testFiles = projectFiles.filter(f =>
    /\.(test|spec)\.(mjs|cjs|[jt]sx?)$/.test(f) ||
    /__tests__\//.test(f) ||
    /tests?\//.test(f)
  );

  const testRefs = new Map(); // reqId → [{ file, line }]

  for (const relPath of testFiles) {
    const fullPath = resolve(projectDir, relPath);
    if (!existsSync(fullPath)) continue;

    let content;
    try { content = readFileSync(fullPath, 'utf-8'); } catch { continue; }

    // Fast early-return: skip expensive string split if no requirement patterns exist
    const hasMatch = patterns.some(p => { p.lastIndex = 0; return p.test(content); });
    if (!hasMatch) continue;

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(lines[i])) !== null) {
          const reqId = match[0];
          if (!testRefs.has(reqId)) testRefs.set(reqId, []);
          testRefs.get(reqId).push({ file: relPath, line: i + 1 });
        }
      }
    }
  }

  // ── Step 3: Report traceability results ──

  // Check each documented requirement has at least one test reference
  for (const [reqId, location] of reqIds) {
    total++;
    if (testRefs.has(reqId)) {
      passed++;
    } else {
      warnings.push(
        `Requirement ${reqId} (${location.file}:${location.line}) has no test coverage. ` +
        `Add @req ${reqId} comment to the test that verifies this requirement`
      );
    }
  }

  // Check for orphaned test refs (tests referencing non-existent requirements)
  for (const [reqId, refs] of testRefs) {
    if (!reqIds.has(reqId)) {
      total++;
      warnings.push(
        `Test references ${reqId} (${refs[0].file}:${refs[0].line}) but no requirement ` +
        `with this ID exists in documentation. Remove the reference or add the requirement to docs`
      );
    }
  }

  return { errors, warnings, passed, total };
}

/**
 * Get all file paths where requirement IDs might be defined.
 * Checks: docs-canonical/*.md, spec.md, REQUIREMENTS.md, specs/[feature]/spec.md
 */
function getRequirementDocPaths(projectDir, config) {
  const paths = [];

  // docs-canonical/ directory
  const docsDir = resolve(projectDir, 'docs-canonical');
  if (existsSync(docsDir)) {
    try {
      for (const f of readdirSync(docsDir)) {
        if (extname(f).toLowerCase() === '.md') {
          paths.push(join(docsDir, f));
        }
      }
    } catch { /* ignore */ }
  }

  // Root-level docs
  const rootDocs = ['REQUIREMENTS.md', 'spec.md', 'README.md'];
  for (const doc of rootDocs) {
    const p = resolve(projectDir, doc);
    if (existsSync(p)) paths.push(p);
  }

  // User-configured requirement docs
  const configDocs = config.traceability?.requirementDocs || [];
  for (const doc of configDocs) {
    const p = resolve(projectDir, doc);
    if (existsSync(p) && !paths.includes(p)) paths.push(p);
  }

  // Spec Kit artifacts: .specify/specs/*/spec.md (v3+) and specs/*/spec.md (legacy)
  const specKitDirs = [
    resolve(projectDir, '.specify', 'specs'),  // v3+ standard
    resolve(projectDir, 'specs'),               // legacy
  ];
  for (const specsDir of specKitDirs) {
    if (existsSync(specsDir)) {
      try {
        for (const feature of readdirSync(specsDir)) {
          const specPath = join(specsDir, feature, 'spec.md');
          if (existsSync(specPath) && !paths.includes(specPath)) paths.push(specPath);
        }
      } catch { /* ignore */ }
    }
  }

  return paths;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function scanDir(rootDir, dir, files) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    if (entry.startsWith('.') && entry !== '.env' && entry !== '.env.example'
        && entry !== '.gitignore' && !entry.startsWith('.github')) continue;

    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      scanDir(rootDir, full, files);
    } else {
      files.push(relative(rootDir, full));
    }
  }
}
