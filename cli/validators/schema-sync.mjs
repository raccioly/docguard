import { docRolePath, resolveDocRole } from '../shared-doc-roles.mjs';
/**
 * Schema Sync Validator — Ensures database schemas are documented in DATA-MODEL.md
 *
 * Detects schema definition files from popular ORMs/frameworks and validates
 * that table/model names appear in DATA-MODEL.md documentation.
 *
 * Supported: Prisma, Drizzle and Mongoose (docguard.js-ts-extraction#FR-010),
 * TypeORM and Sequelize (docguard.typeorm-models#FR-007) and Python ORM models
 * (Django, SQLAlchemy, SQLModel; docguard.python-extraction#FR-008) from the
 * scanners generate uses, so both report the same models; Knex and Rails
 * table names by pattern.
 *
 * Zero NPM runtime dependencies — pure Node.js built-ins only.
 * @implements docguard.typeorm-models#FR-007 {scope=file}
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';
import { collectPackageJsons, resolveSourceRoots, summarizeTiers } from '../shared-source.mjs';
import { scanPythonModels } from '../scanners/python-models.mjs';
import { DEFAULT_IGNORE_DIRS, isNonProductPath, relPosix, shouldIgnore, walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { contractFields } from '../shared-result-contract.mjs';
import { scanOrmEntities } from '../scanners/schemas.mjs';

const IGNORE_DIRS = new Set([
  ...DEFAULT_IGNORE_DIRS,
  '.amplify-hosting', '.serverless',
]);

/**
 * Schema detection configurations for each supported framework.
 * Each entry has a file pattern to detect and a regex to extract model/table names.
 */
// Prisma, Drizzle, Mongoose, TypeORM and Sequelize come from scanOrmEntities(),
// the discovery and parse `generate` uses, so guard and the generated
// DATA-MODEL.md name the same entities (docguard.js-ts-extraction#FR-010,
// docguard.typeorm-models#FR-007). The detectors below cover the ORMs that
// scanner does not read.
const SCHEMA_DETECTORS = [
  {
    name: 'Knex',
    filePattern: /\.(ts|js)$/,
    searchDirs: ['migrations', 'db/migrations'],
    // Matches: knex.schema.createTable('users', ...)
    modelPattern: /createTable\s*\(\s*['"](\w+)['"]/g,
  },
  {
    name: 'Rails',
    filePattern: /\d+_\w+\.rb$/,
    searchDirs: ['db/migrate'],
    // Matches: create_table :users do
    modelPattern: /create_table\s+:(\w+)/g,
  },
];

// Database libraries Schema-Sync does not read models of: a project that depends on one has a data model
// that this validator cannot see.
const UNREAD_DATABASE_DEPENDENCIES = [
  'pg', 'postgres', 'mysql', 'mysql2', 'sqlite3', 'better-sqlite3', 'mongodb', 'kysely', 'objection', 'bookshelf',
  '@mikro-orm/core', '@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb', 'dynamoose', 'slonik', '@libsql/client',
];

/** Evidence of a database whose schema lives where Schema-Sync does not read: a SQL file or a database dependency. */
function unreadSchemaEvidence(projectDir, config) {
  let sql = null;
  sharedWalkFiles(projectDir, (full) => {
    if (sql || !full.toLowerCase().endsWith('.sql')) return;
    const rel = relPosix(projectDir, full);
    if (shouldIgnore(rel, config) || isNonProductPath(rel, config)) return;
    try { if (/create\s+table/i.test(readFileSync(full, 'utf-8').slice(0, 200_000))) sql = rel; } catch { /* unreadable */ }
  }, { ignoreDirs: IGNORE_DIRS });
  if (sql) return `${sql} defines tables in SQL`;
  for (const { pkg } of collectPackageJsons(projectDir, config)) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const lib = UNREAD_DATABASE_DEPENDENCIES.find(name => deps[name]);
    if (lib) return `package.json depends on the database library ${lib}`;
  }
  return null;
}

/**
 * Whether Schema-Sync's kind of check belongs to the project: it applies when
 * the project defines database models it reads (Prisma, Drizzle, Mongoose,
 * TypeORM, Sequelize, Python models, Knex and Rails migrations), and when it
 * shows a database whose schema it does not read (SQL files that create tables,
 * a database library dependency). A project with neither has no data model; a
 * missing DATA-MODEL.md is not the reason.
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}, models = detectAllModels(projectDir, config)) {
  if (models.length > 0) return { applies: true, evidence: `${models.length} database model(s) detected (${[...new Set(models.map(m => m.framework))].join(', ')})` };
  const unread = unreadSchemaEvidence(projectDir, config);
  if (unread) return { applies: true, evidence: unread, unread: true };
  return { applies: false, evidence: 'no model of Prisma, Drizzle, Mongoose, TypeORM, Sequelize, Knex, Rails or Python ORMs, no SQL file that creates tables and no database library dependency' };
}

function schemaContract(projectDir, config, performed, found, models) {
  const doc = docRolePath(config, 'dataModel');
  return contractFields({
    performed, found, ran: `compared ${performed} database model(s) with ${doc}`,
    decide: () => applies(projectDir, config, models),
    empty: (decision) => decision.applies
      ? { emptyCause: 'layout-not-recognized', note: `Schema-Sync found ${decision.evidence}, but no model in a form it reads, so it compared no table with ${doc}.`, howToConfigure: `Schema-Sync reads Prisma, Drizzle, Mongoose, TypeORM and Sequelize models, Python (Django, SQLAlchemy, SQLModel) models, Knex migrations under migrations/ or db/migrations/ and Rails migrations under db/migrate/. It has no setting for another location or format: keep the schema in one of those forms (for example a Knex migration with createTable) and list each table in ${doc}.` }
      : { note: 'Schema-Sync found no database model, no SQL file that creates tables and no database library dependency, so there is no data model to document.', howToConfigure: `Nothing to configure unless the project stores data: then define the models in a form Schema-Sync reads and describe them in ${doc}.` },
  });
}

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
  const dataModelPath = resolveDocRole(projectDir, config, 'dataModel');
  if (!existsSync(dataModelPath)) {
    // No DATA-MODEL.md — nothing to sync against
    // Only warn if we detect schema files
    const detectedModels = detectAllModels(projectDir, config);
    if (detectedModels.length > 0) {
      total++;
      findings.push(mkFinding({
        code: 'SCH001',
        validator: 'schemaSync',
        parserTier: modelsTier(detectedModels),
        severity: 'warn',
        message: `Found ${detectedModels.length} database model(s) (${detectedModels.map(m => m.name).slice(0, 5).join(', ')}${detectedModels.length > 5 ? '...' : ''}) ` +
          `but no DATA-MODEL.md exists. Run \`docguard init\` to create one, then document your schema`,
        location: docRolePath(config, 'dataModel'),
        suggestion: { kind: 'fix', text: 'Create DATA-MODEL.md, then document the detected models in it', command: 'docguard init' },
      }));
    }
    return { ...resultFromFindings(findings, { passed, total }), ...schemaContract(projectDir, config, total, findings.length > 0, detectedModels) };
  }

  const dataModelContent = readFileSync(dataModelPath, 'utf-8').toLowerCase();

  // Detect all models/tables across schemas
  const detectedModels = detectAllModels(projectDir, config);

  if (detectedModels.length === 0) {
    // No schema files found: nothing was compared, which the contract reports as empty, not as a pass.
    return { ...resultFromFindings(findings, { passed, total }), ...schemaContract(projectDir, config, total, false, detectedModels) };
  }

  // Check each model appears in DATA-MODEL.md
  for (const model of detectedModels) {
    total++;

    // Check if the model name, or its table name (TypeORM, Sequelize), appears
    // in DATA-MODEL.md (case-insensitive), singular or pluralized.
    const found = [model.name, model.table].filter(Boolean).some((name) => {
      const lower = name.toLowerCase();
      return dataModelContent.includes(lower) ||
        dataModelContent.includes(lower + 's') ||
        (lower.endsWith('s') && dataModelContent.includes(lower.slice(0, -1)));
    });

    if (found) {
      passed++;
    } else {
      findings.push(mkFinding({
        code: 'SCH002',
        validator: 'schemaSync',
        parserTier: model.tier || 'not-applicable',
        severity: 'warn',
        message: `${model.framework} model "${model.name}" (${model.file}) not documented in DATA-MODEL.md. ` +
          `Add it to the Entity Definitions section`,
        location: model.file,
        suggestion: { kind: 'fix', text: 'Document the model in the Entity Definitions section of docs-canonical/DATA-MODEL.md' },
      }));
    }
  }

  return { ...resultFromFindings(findings, { passed, total }), ...schemaContract(projectDir, config, total, findings.length > 0, detectedModels) };
}

// ──── Model Detection ──────────────────────────────────────────────────────

/**
 * Detect all database models/tables across all supported frameworks.
 */
function detectAllModels(projectDir, config = {}) {
  const models = [];

  const orm = scanOrmEntities(projectDir, config);
  const ormResults = [['Prisma', orm.prisma], ['Drizzle', orm.drizzle], ['Mongoose', orm.mongoose],
    ['TypeORM', orm.typeorm], ['Sequelize', orm.sequelize]];
  for (const [framework, result] of ormResults) {
    for (const entity of result.entities) {
      if (isCommonUtilityModel(entity.name)) continue;
      models.push({
        name: entity.name, framework, file: entity.file,
        ...(entity.table ? { table: entity.table } : {}),
        ...(entity.tier ? { tier: entity.tier } : {}),
      });
    }
  }

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

  // Python ORM models come from the scanner generate uses: one reading, so
  // guard and generate cannot disagree on the same project.
  const PY_FRAMEWORK = { django: 'Django', sqlalchemy: 'SQLAlchemy', sqlmodel: 'SQLModel' };
  const python = scanPythonModels(projectDir);
  for (const e of python.entities) {
    if (!PY_FRAMEWORK[e.source] || isCommonUtilityModel(e.name) || shouldIgnore(e.file, config)) continue;
    models.push({ name: e.name, framework: PY_FRAMEWORK[e.source], file: e.file, tier: e.tier });
  }

  return models;
}

/** The parser tier behind a set of detected models (Python models carry one). */
function modelsTier(models) {
  const tiered = models.filter(m => m.tier);
  return tiered.length ? summarizeTiers(tiered).tier : 'not-applicable';
}

/**
 * Find schema files for a given detector configuration.
 */
function findSchemaFiles(projectDir, detector, config = {}) {
  // Deduplicate files, not model names: separate schemas may share a name.
  const files = new Set();

  // Monorepo-aware: resolve each searchDir against the project root AND every
  // configured source root (config.sourceRoot + workspaces), so schemas under
  // e.g. backend/src/models are found — not just root-relative paths.
  const bases = [resolve(projectDir), ...resolveSourceRoots(projectDir, config)];
  const seenDirs = new Set();

  for (const base of bases) {
    for (const searchDir of detector.searchDirs) {
      const dir = resolve(base, searchDir);
      const rel = relPosix(projectDir, dir);
      if (seenDirs.has(dir) || !existsSync(dir) ||
          rel.split('/').some(part => IGNORE_DIRS.has(part)) ||
          shouldIgnore(rel + '/', config)) continue;
      seenDirs.add(dir);
      scanSchemaDir(dir, detector.filePattern, files, projectDir, config);
    }
  }

  return [...files];
}

// v0.29 consolidation: traversal delegates to the shared canonical walker.
function scanSchemaDir(dir, filePattern, files, projectDir, config) {
  sharedWalkFiles(dir, (full) => {
    if (filePattern.test(basename(full)) && !shouldIgnore(relPosix(projectDir, full), config)) {
      files.add(full);
    }
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
