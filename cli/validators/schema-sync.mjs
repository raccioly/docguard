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
 */
export function validateSchemaSync(projectDir, config) {
  const results = { errors: [], warnings: [], passed: 0, total: 0 };

  // Check if DATA-MODEL.md exists
  const dataModelPath = resolve(projectDir, 'docs-canonical', 'DATA-MODEL.md');
  if (!existsSync(dataModelPath)) {
    // No DATA-MODEL.md — nothing to sync against
    // Only warn if we detect schema files
    const detectedModels = detectAllModels(projectDir);
    if (detectedModels.length > 0) {
      results.total++;
      results.warnings.push(
        `Found ${detectedModels.length} database model(s) (${detectedModels.map(m => m.name).slice(0, 5).join(', ')}${detectedModels.length > 5 ? '...' : ''}) ` +
        `but no DATA-MODEL.md exists. Run \`docguard init\` to create one, then document your schema`
      );
    }
    return results;
  }

  const dataModelContent = readFileSync(dataModelPath, 'utf-8').toLowerCase();

  // Detect all models/tables across schemas
  const detectedModels = detectAllModels(projectDir);

  if (detectedModels.length === 0) {
    // No schema files found — silently pass
    return results;
  }

  // Check each model appears in DATA-MODEL.md
  for (const model of detectedModels) {
    results.total++;

    // Check if model name appears in DATA-MODEL.md (case-insensitive)
    const modelLower = model.name.toLowerCase();
    // Check both singular and pluralized forms
    const found =
      dataModelContent.includes(modelLower) ||
      dataModelContent.includes(modelLower + 's') ||
      (modelLower.endsWith('s') && dataModelContent.includes(modelLower.slice(0, -1)));

    if (found) {
      results.passed++;
    } else {
      results.warnings.push(
        `${model.framework} model "${model.name}" (${model.file}) not documented in DATA-MODEL.md. ` +
        `Add it to the Entity Definitions section`
      );
    }
  }

  return results;
}

// ──── Model Detection ──────────────────────────────────────────────────────

/**
 * Detect all database models/tables across all supported frameworks.
 */
function detectAllModels(projectDir) {
  const models = [];

  for (const detector of SCHEMA_DETECTORS) {
    const files = findSchemaFiles(projectDir, detector);

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
function findSchemaFiles(projectDir, detector) {
  const files = [];

  for (const searchDir of detector.searchDirs) {
    const dir = resolve(projectDir, searchDir);
    if (!existsSync(dir)) continue;

    scanSchemaDir(dir, detector.filePattern, files);
  }

  return files;
}

function scanSchemaDir(dir, filePattern, files) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue;
    if (entry.startsWith('.')) continue;

    const full = join(dir, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }

    if (stat.isDirectory()) {
      scanSchemaDir(full, filePattern, files);
    } else if (filePattern.test(entry)) {
      files.push(full);
    }
  }
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
