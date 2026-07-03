/**
 * Schema Sync Validator — Ensures database schemas are documented in DATA-MODEL.md
 *
 * Detects schema definition files from popular ORMs/frameworks and validates
 * that table/model names appear in DATA-MODEL.md documentation.
 *
 * Supported: Prisma, Drizzle, Sequelize, TypeORM, Knex, Django, Rails
 *
 * Zero NPM runtime dependencies — pure Node.js built-ins only.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, extname, basename } from 'node:path';
import { resolveSourceRoots } from '../shared-source.mjs';
import { walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
  '.amplify-hosting', '.serverless',
]);

/**
 * Schema detection configurations for each supported framework.
 * Each entry has a file pattern to detect and a regex to extract model/table names.
 */
const SCHEMA_DETECTORS = [
  {
    name: 'Prisma',
    filePattern: /schema\.prisma$/,
    searchDirs: ['prisma'],
    // Matches: model User { ... }
    modelPattern: /^\s*model\s+(\w+)\s*\{/gm,
  },
  {
    name: 'Drizzle',
    filePattern: /\.(ts|js|mjs)$/,
    searchDirs: ['drizzle', 'src/db', 'src/schema', 'db'],
    // Matches: export const users = pgTable('users', ...) or mysqlTable, sqliteTable
    modelPattern: /(?:pg|mysql|sqlite)Table\s*\(\s*['"](\w+)['"]/g,
  },
  {
    name: 'TypeORM',
    filePattern: /\.entity\.(ts|js)$/,
    searchDirs: ['src/entities', 'src/entity', 'entities'],
    // Matches: @Entity('users') or @Entity() class User
    modelPattern: /@Entity\s*\(\s*(?:['"](\w+)['"])?\s*\)\s*(?:export\s+)?class\s+(\w+)/g,
  },
  {
    name: 'Sequelize',
    filePattern: /\.(ts|js)$/,
    searchDirs: ['models', 'src/models'],
    // Matches: sequelize.define('User', ...) or Model.init(...)
    modelPattern: /(?:sequelize\.define|\.init)\s*\(\s*['"](\w+)['"]/g,
  },
  {
    name: 'Knex',
    filePattern: /\.(ts|js)$/,
    searchDirs: ['migrations', 'db/migrations'],
    // Matches: knex.schema.createTable('users', ...)
    modelPattern: /createTable\s*\(\s*['"](\w+)['"]/g,
  },
  {
    name: 'Django',
    filePattern: /models\.py$/,
    searchDirs: ['', 'app', 'apps'],
    // Matches: class User(models.Model):
    modelPattern: /class\s+(\w+)\s*\(\s*(?:models\.)?Model\s*\)/g,
  },
  {
    name: 'Rails',
    filePattern: /\d+_\w+\.rb$/,
    searchDirs: ['db/migrate'],
    // Matches: create_table :users do
    modelPattern: /create_table\s+:(\w+)/g,
  },
];

/**
 * Main validator entry point.
 *
 * v0.29: migrated to structured findings (SCH001–SCH002). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings array.
 */
export function validateSchemaSync(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;

  // Check if DATA-MODEL.md exists
  const dataModelPath = resolve(projectDir, 'docs-canonical', 'DATA-MODEL.md');
  if (!existsSync(dataModelPath)) {
    // No DATA-MODEL.md — nothing to sync against
    // Only warn if we detect schema files
    const detectedModels = detectAllModels(projectDir, config);
    if (detectedModels.length > 0) {
      total++;
      findings.push(mkFinding({
        code: 'SCH001',
        validator: 'schemaSync',
        severity: 'warn',
        message: `Found ${detectedModels.length} database model(s) (${detectedModels.map(m => m.name).slice(0, 5).join(', ')}${detectedModels.length > 5 ? '...' : ''}) ` +
          `but no DATA-MODEL.md exists. Run \`docguard init\` to create one, then document your schema`,
        location: 'docs-canonical/DATA-MODEL.md',
        suggestion: { kind: 'fix', text: 'Create DATA-MODEL.md, then document the detected models in it', command: 'docguard init' },
      }));
    }
    return resultFromFindings(findings, { passed, total });
  }

  const dataModelContent = readFileSync(dataModelPath, 'utf-8').toLowerCase();

  // Detect all models/tables across schemas
  const detectedModels = detectAllModels(projectDir, config);

  if (detectedModels.length === 0) {
    // No schema files found — silently pass
    return resultFromFindings(findings, { passed, total });
  }

  // Check each model appears in DATA-MODEL.md
  for (const model of detectedModels) {
    total++;

    // Check if model name appears in DATA-MODEL.md (case-insensitive)
    const modelLower = model.name.toLowerCase();
    // Check both singular and pluralized forms
    const found =
      dataModelContent.includes(modelLower) ||
      dataModelContent.includes(modelLower + 's') ||
      (modelLower.endsWith('s') && dataModelContent.includes(modelLower.slice(0, -1)));

    if (found) {
      passed++;
    } else {
      findings.push(mkFinding({
        code: 'SCH002',
        validator: 'schemaSync',
        severity: 'warn',
        message: `${model.framework} model "${model.name}" (${model.file}) not documented in DATA-MODEL.md. ` +
          `Add it to the Entity Definitions section`,
        location: model.file,
        suggestion: { kind: 'fix', text: 'Document the model in the Entity Definitions section of docs-canonical/DATA-MODEL.md' },
      }));
    }
  }

  return resultFromFindings(findings, { passed, total });
}

// ──── Model Detection ──────────────────────────────────────────────────────

/**
 * Detect all database models/tables across all supported frameworks.
 */
function detectAllModels(projectDir, config = {}) {
  const models = [];

  for (const detector of SCHEMA_DETECTORS) {
    const files = findSchemaFiles(projectDir, detector, config);

    for (const filePath of files) {
      let content;
      try { content = readFileSync(filePath, 'utf-8'); } catch { continue; }

      const relPath = relative(projectDir, filePath);

      // Reset regex and extract model names
      detector.modelPattern.lastIndex = 0;
      let match;
      while ((match = detector.modelPattern.exec(content)) !== null) {
        // Some patterns have the name in group 1 or 2
        const name = match[1] || match[2];
        if (name && !isCommonUtilityModel(name)) {
          models.push({
            name,
            framework: detector.name,
            file: relPath,
          });
        }
      }
    }
  }

  return models;
}

/**
 * Find schema files for a given detector configuration.
 */
function findSchemaFiles(projectDir, detector, config = {}) {
  const files = [];

  // Monorepo-aware: resolve each searchDir against the project root AND every
  // configured source root (config.sourceRoot + workspaces), so schemas under
  // e.g. backend/src/models are found — not just root-relative paths.
  const bases = [resolve(projectDir), ...resolveSourceRoots(projectDir, config)];
  const seenDirs = new Set();

  for (const base of bases) {
    for (const searchDir of detector.searchDirs) {
      const dir = resolve(base, searchDir);
      if (seenDirs.has(dir) || !existsSync(dir)) continue;
      seenDirs.add(dir);
      scanSchemaDir(dir, detector.filePattern, files);
    }
  }

  return files;
}

// v0.29 consolidation: traversal delegates to the shared canonical walker.
function scanSchemaDir(dir, filePattern, files) {
  sharedWalkFiles(dir, (full) => {
    if (filePattern.test(basename(full))) files.push(full);
  }, { ignoreDirs: IGNORE_DIRS });
}

/**
 * Filter out common utility models that don't need documentation.
 */
function isCommonUtilityModel(name) {
  const utilities = new Set([
    'migration', 'migrations', 'seed', 'seeds',
    'knex_migrations', 'knex_migrations_lock',
    'schema_migrations', 'ar_internal_metadata',
    'SequelizeMeta', 'typeorm_metadata',
    '_prisma_migrations',
  ]);
  return utilities.has(name);
}
