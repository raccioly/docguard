/**
 * Deep Schema Scanner
 * Parses schema definitions from ORM/validation libraries.
 * Reads: Prisma, Drizzle, Mongoose, TypeORM (`@Entity` classes) and Sequelize
 * (`define` / `init`) through one discovery (`scanOrmEntities`) that guard's
 * schema check shares; Zod when no ORM entity is found; OpenAPI schemas;
 * Python models (python-models.mjs); Diesel, Go structs, JPA and Rails
 * migrations by pattern. Knex is not read here: guard's schema check reads
 * Knex table names itself.
 *
 * Priority: OpenAPI schemas > ORM schemas > Validation schemas
 * @implements docguard.typeorm-models#FR-008
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import {
  extractJsSchemaBodies, extractDecoratedClasses, extractSequelizeCalls, astTierAvailable,
  splitTopLevel, stripComments, matchingBracket,
} from './js-ast.mjs';
import { scanPythonModels } from './python-models.mjs';
import { readScannable, resolveSourceRoots, getWorkspaceDirs, tierFor } from '../shared-source.mjs';
import { DEFAULT_IGNORE_DIRS as IGNORE_DIRS, shouldIgnore, relPosix, isNonProductPath } from '../shared-ignore.mjs';

/**
 * Deep scan schemas from ORM definitions, validation libraries, and OpenAPI specs.
 * @param {string} dir - Project root
 * @param {object} stack - Detected tech stack
 * @param {object} docTools - Detected doc tools (may include OpenAPI)
 * @returns {object} { entities: [...], relationships: [...], source: string }
 */
export function scanSchemasDeep(dir, stack, docTools, config = {}) {
  // Priority 1: OpenAPI schemas
  if (docTools?.openapi?.found && docTools.openapi.schemas?.length > 0) {
    return {
      entities: docTools.openapi.schemas.map(s => ({
        name: s.name,
        fields: s.fields,
        file: docTools.openapi.path,
        source: 'openapi',
        description: s.description,
      })),
      relationships: extractOpenAPIRelationships(docTools.openapi.schemas),
      source: 'openapi',
    };
  }

  // Priority 2: ORM-specific scanning. Prisma, Drizzle, Mongoose,
  // TypeORM and Sequelize come from the discovery guard's schema check also
  // uses (docguard.js-ts-extraction#FR-010, docguard.typeorm-models#FR-007).
  const entities = [];
  const relationships = [];
  const orm = scanOrmEntities(dir, config);

  // Prisma (enums are reported apart from entities: FR-008)
  entities.push(...orm.prisma.entities);
  relationships.push(...orm.prisma.relationships);

  // Drizzle
  entities.push(...orm.drizzle.entities);
  relationships.push(...orm.drizzle.relationships);

  // TypeORM and Sequelize
  for (const result of [orm.typeorm, orm.sequelize]) {
    entities.push(...result.entities);
    relationships.push(...result.relationships);
  }

  // Zod (if no ORM found, Zod schemas are the data model)
  if (entities.length === 0) {
    const zodResult = scanZodSchemas(dir);
    entities.push(...zodResult.entities);
  }

  // Mongoose
  entities.push(...orm.mongoose.entities);
  relationships.push(...orm.mongoose.relationships);

  // ── Multi-language model scanners (additive; supports polyglot repos) ──
  // Python reports the parser tier that read it (python-models.mjs).
  let scanTier = null;
  for (const scanner of [scanPythonModels, scanRustModels, scanGoModels, scanJpaModels, scanRailsModels]) {
    const result = scanner(dir);
    if (result.scanTier && result.entities.length > 0) scanTier = result.scanTier;
    if (result.entities.length > 0) {
      entities.push(...result.entities);
      relationships.push(...(result.relationships || []));
    }
  }

  // Honor .docguardignore / config.ignore: drop entities whose source file the
  // user excluded (e.g. test/fixtures/**), then drop relationships that point at
  // a dropped entity. Filtering the RESULTS (not the walk) keeps the cache and
  // the per-ORM walkers untouched. entity.file is project-relative already.
  // Every entity cites its file project-relative: the Python, Go, Rust, JPA and
  // Rails walkers produced absolute paths, which leaked machine paths into the
  // generated DATA-MODEL.md and kept those entities out of as-built facts
  // (docguard.generated-docs-consistency#FR-010).
  for (const e of entities) {
    if (!e.file) continue;
    const rel = relPosix(dir, resolve(dir, e.file));
    if (!rel.startsWith('../')) e.file = rel;
  }
  const keptEntities = entities.filter(
    e => !e.file || !shouldIgnore(relPosix(dir, resolve(dir, e.file)), config)
  );
  const keptNames = new Set(keptEntities.map(e => e.name));
  const keptRelationships = keptEntities.length === entities.length
    ? relationships
    : relationships.filter(r => keptNames.has(r.from) && keptNames.has(r.to));

  return {
    entities: keptEntities,
    relationships: keptRelationships,
    enums: orm.prisma.enums.filter(e => !shouldIgnore(relPosix(dir, resolve(dir, e.file)), config)),
    source: keptEntities.length > 0 ? keptEntities[0].source : 'none',
    ...(scanTier ? { scanTier } : {}),
  };
}

// ── Shared ORM entity discovery (docguard.js-ts-extraction#FR-010) ─────────
//
// Guard's schema check (validators/schema-sync.mjs) and generate both read
// Prisma, Drizzle, Mongoose, TypeORM and Sequelize entities through
// scanOrmEntities() (docguard.typeorm-models#FR-007). Two
// independent directory lists used to drift: guard found Drizzle tables under
// `lib/db` while generate reported none.

const JS_SCHEMA_FILE_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
// Conventional top-level schema dirs, searched besides the source roots.
const ORM_SEARCH_DIRS = ['db', 'database', 'schema', 'schemas', 'drizzle', 'models', 'model', 'entities', 'entity'];
const DRIZZLE_CONFIG_FILES = ['drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.mjs', 'drizzle.config.cjs', 'drizzle.config.mts', 'drizzle.config.json'];
// A table builder called with a literal table name: specific to Drizzle.
const DRIZZLE_TABLE_RE = /\b(?:pg|mysql|sqlite)Table\s*\(\s*['"`]\w+['"`]/;
const MONGOOSE_SCHEMA_RE = /\bnew\s+(?:mongoose\s*\.\s*)?Schema\s*(?:<[^>]*>)?\s*\(/;
// TypeORM: an import of `typeorm` and an entity or column decorator. The
// import keeps MikroORM, whose decorator is also `@Entity()`, out.
const TYPEORM_IMPORT_RE = /(?:\bfrom\s*|\brequire\s*\(\s*)['"]typeorm['"]/;
const TYPEORM_DECORATOR_RE = /@\s*(?:Entity|\w*Column)\s*\(/;
const SEQUELIZE_CALL_RE = /\.\s*(?:define|init)\s*\(/;

function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function isFileSync(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

/** Package roots: the project and its workspaces (where ORM configs live). */
function packageRoots(dir) {
  return [...new Set([resolve(dir), ...getWorkspaceDirs(dir)])];
}

/** Dirs to search, deduplicated, with any dir inside another dropped (it is walked once). */
function ormSearchBases(dir, config) {
  const candidates = [
    ...ORM_SEARCH_DIRS.map(d => resolve(dir, d)),
    ...resolveSourceRoots(dir, config),
  ].filter(isDir);
  const unique = [...new Set(candidates)].sort((x, y) => x.length - y.length);
  return unique.filter((base, i) => !unique.slice(0, i).some(outer => base === outer || base.startsWith(outer + sep)));
}

function keepSchemaFile(dir, file, config) {
  const rel = relPosix(dir, file);
  return !isNonProductPath(rel, config) && !shouldIgnore(rel, config);
}

/** Files a glob, directory or file entry of drizzle.config `schema` names. */
function expandSchemaEntry(baseDir, entry) {
  const cleaned = String(entry).replace(/^\.\//, '');
  if (!/[*?]/.test(cleaned)) {
    const abs = resolve(baseDir, cleaned);
    if (isDir(abs)) return freshFiles(abs).filter(f => JS_SCHEMA_FILE_RE.test(f));
    for (const candidate of [abs, ...['.ts', '.js', '.mjs', '.cjs', '.mts'].map(ext => abs + ext)]) if (isFileSync(candidate)) return [candidate];
    return [];
  }
  const segments = cleaned.split('/');
  const staticParts = [];
  for (const seg of segments) { if (/[*?]/.test(seg)) break; staticParts.push(seg); }
  const root = resolve(baseDir, staticParts.join('/'));
  const rest = segments.slice(staticParts.length).join('/');
  const source = rest.split('/').map(seg => seg === '**' ? '(?:.*/)?' : seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '/')
    .join('').replace(/\/$/, '').replace(/\(\?:\.\*\/\)\?\//g, '(?:.*/)?');
  let re;
  try { re = new RegExp(`^${source}$`); } catch { return []; }
  return freshFiles(root).filter(f => JS_SCHEMA_FILE_RE.test(f) && re.test(relPosix(root, f)));
}

/**
 * A fresh walk (not the per-process walkDir cache): guard's schema check runs
 * in long-lived processes (MCP server, `watch`), where a cached listing would
 * hide a schema file added after the first run.
 */
function freshFiles(dir) {
  const out = [];
  _collectFiles(dir, out);
  return out;
}

/** `schema` entries of every drizzle.config.* under the package roots. */
function drizzleConfigFiles(dir) {
  const files = [];
  for (const root of packageRoots(dir)) {
    for (const name of DRIZZLE_CONFIG_FILES) {
      const abs = join(root, name);
      if (!isFileSync(abs)) continue;
      const content = readFileSafe(abs);
      if (!content) continue;
      const m = /["']?\bschema["']?\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|`[^`$]*`)/.exec(content);
      if (!m) continue;
      for (const entry of m[1].matchAll(/(['"`])([^'"`]+)\1/g)) files.push(...expandSchemaEntry(root, entry[2]));
    }
  }
  return files;
}

/**
 * Where Prisma, Drizzle, Mongoose, TypeORM and Sequelize schemas live.
 * - Prisma: `prisma/*.prisma` and `prisma/schema/*.prisma` under the project,
 *   its workspaces and source roots, plus package.json `prisma.schema`.
 * - Drizzle: drizzle.config.* `schema` first; otherwise a search of the
 *   conventional dirs and source roots for files that call a table builder
 *   (`pgTable('users', …)`).
 * - Mongoose: the same search, for files that construct a mongoose Schema.
 * - TypeORM: the same search, for files that import `typeorm` and use an
 *   entity or column decorator (an abstract base class counts).
 * - Sequelize: the same search, for files that mention `sequelize` and call
 *   `define` or `init`.
 * Every file appears once (absolute paths), so `src/db` inside `src` is not
 * scanned twice.
 * @implements docguard.js-ts-extraction#FR-006
 * @implements docguard.js-ts-extraction#FR-007
 * @implements docguard.js-ts-extraction#FR-010
 * @implements docguard.typeorm-models#FR-001
 * @returns {{ prisma: string[], drizzle: string[], mongoose: string[], typeorm: string[], sequelize: string[] }}
 */
export function discoverOrmSchemaFiles(dir, config = {}) {
  const prisma = new Set();
  const prismaDirs = new Set([...packageRoots(dir), ...resolveSourceRoots(dir, config)]);
  for (const root of prismaDirs) {
    for (const sub of ['prisma', join('prisma', 'schema')]) {
      const d = join(root, sub);
      if (!isDir(d)) continue;
      try {
        for (const e of readdirSync(d, { withFileTypes: true })) if (e.isFile() && e.name.endsWith('.prisma')) prisma.add(join(d, e.name));
      } catch { /* unreadable */ }
    }
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
      const declared = pkg?.prisma?.schema;
      if (typeof declared === 'string') {
        const abs = resolve(root, declared);
        if (isFileSync(abs)) prisma.add(abs);
        else if (isDir(abs)) for (const e of readdirSync(abs)) if (e.endsWith('.prisma')) prisma.add(join(abs, e));
      }
    } catch { /* no package.json */ }
  }

  const configured = drizzleConfigFiles(dir);
  const drizzle = new Set(configured.filter(f => keepSchemaFile(dir, f, config)));
  const mongoose = new Set();
  const typeorm = new Set();
  const sequelize = new Set();
  for (const base of ormSearchBases(dir, config)) {
    for (const file of freshFiles(base)) {
      if (!JS_SCHEMA_FILE_RE.test(file) || !keepSchemaFile(dir, file, config)) continue;
      const content = readFileSafe(file);
      if (!content) continue;
      if (configured.length === 0 && DRIZZLE_TABLE_RE.test(content)) drizzle.add(file);
      if (content.includes('mongoose') && MONGOOSE_SCHEMA_RE.test(content)) mongoose.add(file);
      if (content.includes('typeorm') && TYPEORM_IMPORT_RE.test(content) && TYPEORM_DECORATOR_RE.test(content)) typeorm.add(file);
      if (/sequelize/i.test(content) && SEQUELIZE_CALL_RE.test(content)) sequelize.add(file);
    }
  }
  const order = list => [...list].filter(f => keepSchemaFile(dir, f, config)).sort();
  return { prisma: order(prisma), drizzle: order(drizzle), mongoose: order(mongoose), typeorm: order(typeorm), sequelize: order(sequelize) };
}

/**
 * Prisma, Drizzle, Mongoose, TypeORM and Sequelize entities, relationships
 * and (Prisma) enums — the one discovery and parse both guard and generate use.
 * @implements docguard.js-ts-extraction#FR-010
 * @implements docguard.typeorm-models#FR-007
 */
export function scanOrmEntities(dir, config = {}) {
  const files = discoverOrmSchemaFiles(dir, config);
  return {
    prisma: scanPrismaDeep(dir, files.prisma),
    drizzle: scanDrizzleSchemas(dir, files.drizzle),
    mongoose: scanMongooseSchemas(dir, files.mongoose),
    typeorm: scanTypeOrmEntities(dir, files.typeorm),
    sequelize: scanSequelizeModels(dir, files.sequelize),
  };
}

// ── Prisma Deep Parser ──────────────────────────────────────────────────────

/** A Prisma line without its `//` comment (a `//` inside a string is kept). */
function prismaCode(line) {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"' && line[i - 1] !== '\\') inString = !inString;
    if (!inString && line[i] === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

/**
 * Prisma models and enums. A block ends at its matching brace (strings and
 * comments skipped), so attributes that contain braces (`@default("{}")`)
 * never cut a model short. Relation fields and
 * back-references are relationships, not columns; each relation is reported
 * once, from the side that holds `@relation(fields: …)`, and an implicit
 * many-to-many once (docguard.js-ts-extraction#FR-008).
 */
function scanPrismaDeep(dir, schemaFiles = []) {
  const entities = [];
  const relationships = [];
  const enums = [];
  const blocks = [];
  for (const abs of schemaFiles) {
    const content = readFileSafe(abs);
    if (!content) continue;
    const file = relPosix(dir, abs);
    const head = /^[ \t]*(model|enum)\s+(\w+)\s*\{/gm;
    let m;
    while ((m = head.exec(content)) !== null) {
      const open = m.index + m[0].length - 1;
      const close = matchingBracket(content, open);
      if (close < 0) break;
      const lines = content.slice(open + 1, close).split('\n')
        .map(raw => ({ raw, text: prismaCode(raw).trim() }))
        .filter(l => l.text);
      blocks.push({ kind: m[1], name: m[2], file, lines });
      head.lastIndex = close + 1;
    }
  }
  const models = new Set(blocks.filter(b => b.kind === 'model').map(b => b.name));
  const relationFields = [];

  for (const block of blocks) {
    if (block.kind === 'enum') {
      const values = block.lines.map(l => l.text).filter(t => /^\w+/.test(t) && !t.startsWith('@@')).map(t => t.match(/^(\w+)/)[1]);
      enums.push({
        name: block.name, values, file: block.file, source: 'prisma-enum',
        fields: values.map(v => ({ name: v, type: 'enum_value', required: true })),
        description: `Enum with ${values.length} values`,
      });
      continue;
    }
    const fields = [];
    for (const { text, raw } of block.lines) {
      if (text.startsWith('@@')) continue;
      const m = /^(\w+)\s+(\w+)(\([^)]*\))?(\[\])?(\?)?(?:\s+(.*))?$/.exec(text);
      if (!m) continue;
      const [, name, base, , list, optional, modifiers = ''] = m;
      if (models.has(base)) {
        const rel = /@relation\(([^)]*)\)/.exec(modifiers);
        const relName = rel ? ((/^\s*"([^"]+)"/.exec(rel[1]) || /name\s*:\s*"([^"]+)"/.exec(rel[1]) || [])[1] || null) : null;
        relationFields.push({ model: block.name, name, target: base, list: Boolean(list), owner: Boolean(rel && /\bfields\s*:/.test(rel[1])), relName });
        continue;
      }
      fields.push({
        name,
        type: mapPrismaType(base) + (list ? '[]' : ''),
        required: !optional && !list,
        primaryKey: /@id\b/.test(modifiers),
        unique: /@unique\b/.test(modifiers),
        default: extractPrismaDefault(modifiers),
        description: extractInlineComment(raw),
      });
    }
    entities.push({ name: block.name, fields, file: block.file, source: 'prisma', description: '' });
  }

  const otherSide = (f) => relationFields.find(o => o !== f && o.model === f.target && o.target === f.model && o.relName === f.relName);
  for (const f of relationFields) {
    const other = otherSide(f);
    if (f.owner) {
      relationships.push({ from: f.model, to: f.target, type: other && !other.list ? 'one-to-one' : 'many-to-one', field: f.name });
    } else if (f.list && other && other.list && !other.owner) {
      // Implicit many-to-many: one edge, from the alphabetically first side.
      if (f.model < f.target || (f.model === f.target && f.name < other.name)) {
        relationships.push({ from: f.model, to: f.target, type: 'many-to-many', field: f.name });
      }
    } else if (f.list && !other) {
      relationships.push({ from: f.model, to: f.target, type: 'one-to-many', field: f.name });
    }
    // Any other field is the back-reference of an owned relation: already drawn.
  }
  return { entities, relationships, enums };
}

function mapPrismaType(rawType) {
  const type = rawType.replace('?', '').replace('[]', '');
  const map = {
    'String': 'string', 'Int': 'integer', 'BigInt': 'bigint',
    'Float': 'float', 'Decimal': 'decimal', 'Boolean': 'boolean',
    'DateTime': 'datetime', 'Json': 'json', 'Bytes': 'bytes',
  };
  return map[type] || type;
}

function extractPrismaDefault(modifiers) {
  const at = modifiers.indexOf('@default(');
  if (at < 0) return '—';
  const open = at + '@default'.length;
  const close = matchingBracket(modifiers, open);
  return close < 0 ? '—' : modifiers.slice(open + 1, close);
}

function extractInlineComment(line) {
  const code = prismaCode(line);
  const match = line.slice(code.length).match(/^\/\/\/?\s*(.+)$/);
  return match ? match[1].trim() : '';
}

// ── Drizzle Scanner ─────────────────────────────────────────────────────────

/** `name = pgTable('table', {` … balanced body, by pattern (the regex tier). */
function drizzleTablesByPattern(content) {
  const out = [];
  const re = /\b([A-Za-z_$][\w$]*)\s*=\s*(?:pg|mysql|sqlite)Table\s*\(\s*(['"`])(\w+)\2\s*,\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchingBracket(content, open);
    if (close < 0) continue;
    out.push({ kind: 'drizzle', name: m[1], table: m[3], body: content.slice(open + 1, close) });
  }
  return out;
}

/**
 * Drizzle tables with every column. A variable → table map across all schema
 * files resolves `.references(() => users.id)` to the table name, and pgEnum
 * bindings type their columns `enum` (docguard.js-ts-extraction#FR-006).
 */
function scanDrizzleSchemas(dir, schemaFiles = []) {
  const entities = [];
  const relationships = [];
  const tables = [];
  const enumVars = new Set();
  for (const abs of schemaFiles) {
    const content = readFileSafe(abs);
    if (!content) continue;
    for (const m of content.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*(?:pg|mysql)Enum\s*\(/g)) enumVars.add(m[1]);
    // Full-support tier: AST extraction (balanced bodies). The pattern tier
    // reads the same bodies by bracket matching when the file does not parse.
    const found = extractJsSchemaBodies(content, abs) ?? drizzleTablesByPattern(content);
    for (const t of found) if (t.kind === 'drizzle') tables.push({ ...t, file: relPosix(dir, abs) });
  }
  const varToTable = new Map(tables.map(t => [t.name, t.table]));
  for (const t of tables) {
    const fields = parseDrizzleColumns(t.body, enumVars);
    for (const field of fields) {
      if (field._ref) relationships.push({ from: t.table, to: varToTable.get(field._ref) ?? field._ref, type: 'many-to-one', field: field.name });
    }
    entities.push({
      name: t.table,
      fields: fields.map(({ _ref, ...f }) => f),
      file: t.file,
      source: 'drizzle',
      description: '',
    });
  }
  return { entities, relationships };
}

const PROPERTY_RE = /^\s*(?:(['"])([^'"]+)\1|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]*)$/;

function parseDrizzleColumns(body, enumVars = new Set()) {
  const fields = [];
  for (const part of splitTopLevel(stripComments(body), ',')) {
    const prop = PROPERTY_RE.exec(part);
    if (!prop) continue;
    const name = prop[2] ?? prop[3];
    const value = prop[4].trim();
    const call = /^([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/.exec(value);
    if (!call) continue;
    const builder = call[1];
    const close = matchingBracket(value, call[0].length - 1);
    const chain = close < 0 ? '' : value.slice(close + 1);
    const primaryKey = /\.primaryKey\s*\(/.test(chain) || builder === 'serial';
    const field = {
      name,
      type: enumVars.has(builder) ? 'enum' : mapDrizzleType(builder),
      required: /\.notNull\s*\(/.test(chain) || primaryKey,
      primaryKey,
      unique: /\.unique\s*\(/.test(chain),
      default: extractDrizzleDefault(chain),
      description: '',
    };
    const ref = /\.references\s*\(\s*\(\s*\)\s*(?::\s*[\w$.<>[\]]+\s*)?=>\s*\(?\s*([A-Za-z_$][\w$]*)\s*\.\s*[A-Za-z_$][\w$]*/.exec(chain);
    if (ref) field._ref = ref[1];
    fields.push(field);
  }
  return fields;
}

function mapDrizzleType(type) {
  const map = {
    'serial': 'serial', 'bigserial': 'bigserial', 'smallserial': 'smallserial',
    'integer': 'integer', 'int': 'integer', 'bigint': 'bigint',
    'smallint': 'smallint', 'text': 'string', 'varchar': 'string',
    'char': 'string', 'boolean': 'boolean', 'timestamp': 'datetime',
    'date': 'date', 'time': 'time', 'json': 'json', 'jsonb': 'json',
    'real': 'float', 'doublePrecision': 'double', 'double': 'double', 'numeric': 'decimal',
    'decimal': 'decimal', 'uuid': 'uuid', 'blob': 'bytes',
  };
  return map[type] || type;
}

function extractDrizzleDefault(chain) {
  const at = chain.search(/\.default\s*\(/);
  if (at >= 0) {
    const open = chain.indexOf('(', at);
    const close = matchingBracket(chain, open);
    if (close > open) return chain.slice(open + 1, close).trim().replace(/['"`]/g, '');
  }
  if (/\.defaultNow\s*\(/.test(chain)) return 'now()';
  if (/\.defaultRandom\s*\(/.test(chain)) return 'random()';
  if (/\.\$defaultFn\s*\(/.test(chain)) return 'generated';
  return '—';
}

// ── Zod Scanner ─────────────────────────────────────────────────────────────

function scanZodSchemas(dir) {
  const entities = [];

  const schemaDirs = ['src/schema', 'src/schemas', 'schema', 'schemas', 'src/types', 'src/validation', 'src'];
  const zodPattern = /(?:export\s+(?:const|let)\s+)(\w+(?:Schema|Validator|Input|Output))\s*=\s*z\.object\s*\(\s*\{([^}]+)\}\s*\)/g;

  for (const schemaDir of schemaDirs) {
    const fullDir = resolve(dir, schemaDir);
    if (!existsSync(fullDir)) continue;

    walkDir(fullDir, (filePath) => {
      const content = readFileSafe(filePath);
      if (!content || !content.includes('z.object')) return;

      const emit = (rawName, body) => {
        const schemaName = rawName.replace(/Schema$|Validator$/, '');
        entities.push({
          name: schemaName,
          fields: parseZodFields(body),
          file: relative(dir, filePath),
          source: 'zod',
          description: '',
        });
      };

      const ast = extractJsSchemaBodies(content, filePath);
      if (ast) {
        // Keep the legacy naming gate (only *Schema/Validator/Input/Output) so
        // inline z.object() validations aren't treated as data-model entities.
        for (const s of ast) {
          if (s.kind === 'zod' && /(?:Schema|Validator|Input|Output)$/.test(s.name)) emit(s.name, s.body);
        }
      } else {
        let match;
        const regex = new RegExp(zodPattern.source, 'g');
        while ((match = regex.exec(content)) !== null) emit(match[1], match[2]);
      }
    });
  }

  return { entities };
}

function parseZodFields(body) {
  const fields = [];
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Match: fieldName: z.type()
    const fieldMatch = trimmed.match(/(\w+)\s*:\s*z\.\s*(\w+)\s*\(/);
    if (!fieldMatch) continue;

    const fieldName = fieldMatch[1];
    const zodType = fieldMatch[2];

    fields.push({
      name: fieldName,
      type: mapZodType(zodType),
      required: !trimmed.includes('.optional()') && !trimmed.includes('.nullable()'),
      primaryKey: false,
      unique: false,
      default: trimmed.includes('.default(') ? 'has default' : '—',
      description: '',
    });
  }

  return fields;
}

function mapZodType(type) {
  const map = {
    'string': 'string', 'number': 'number', 'boolean': 'boolean',
    'date': 'date', 'bigint': 'bigint', 'array': 'array',
    'object': 'object', 'enum': 'enum', 'union': 'union',
    'literal': 'literal', 'record': 'record', 'tuple': 'tuple',
    'any': 'any', 'unknown': 'unknown', 'null': 'null',
    'undefined': 'undefined', 'void': 'void', 'never': 'never',
    'coerce': 'coerced',
  };
  return map[type] || type;
}

// ── Mongoose Scanner ────────────────────────────────────────────────────────

/** `name = new Schema({` … balanced body, by pattern (the regex tier). */
function mongooseSchemasByPattern(content) {
  const out = [];
  const re = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*new\s+(?:mongoose\s*\.\s*)?Schema\s*(?:<[^>]*>)?\s*\(\s*\{/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchingBracket(content, open);
    if (close < 0) continue;
    out.push({ kind: 'mongoose', name: m[1], body: content.slice(open + 1, close) });
  }
  return out;
}

/**
 * Mongoose schemas, named by `model('Name', schema)` when the file registers
 * one. Fields come from the top-level keys only: a `{ type, required, ref }`
 * object is one field, a nested object without `type` is one `object` field,
 * and `[{ type: ObjectId, ref: 'X' }]` is an array relation
 * (docguard.js-ts-extraction#FR-007).
 */
function scanMongooseSchemas(dir, schemaFiles = []) {
  const entities = [];
  const relationships = [];
  for (const abs of schemaFiles) {
    const content = readFileSafe(abs);
    if (!content) continue;
    const models = new Map();
    for (const m of content.matchAll(/\bmodel\s*(?:<[^>]*>)?\s*\(\s*(['"`])(\w+)\1\s*,\s*([A-Za-z_$][\w$]*)/g)) models.set(m[3], m[2]);
    const found = extractJsSchemaBodies(content, abs) ?? mongooseSchemasByPattern(content);
    for (const s of found) {
      if (s.kind !== 'mongoose') continue;
      const bare = s.name.replace(/Schema$/i, '') || s.name;
      const name = models.get(s.name) ?? (bare.charAt(0).toUpperCase() + bare.slice(1));
      const fields = parseMongooseFields(s.body);
      for (const field of fields) {
        if (field._ref) relationships.push({ from: name, to: field._ref, type: field._many ? 'one-to-many' : 'many-to-one', field: field.name });
      }
      entities.push({
        name,
        fields: fields.map(({ _ref, _many, ...f }) => f),
        file: relPosix(dir, abs),
        source: 'mongoose',
        description: '',
      });
    }
  }
  return { entities, relationships };
}

/** Top-level `key: value` pairs of an object literal's inner text. */
function objectProps(inner) {
  const props = new Map();
  for (const part of splitTopLevel(stripComments(inner), ',')) {
    const m = PROPERTY_RE.exec(part);
    if (m) props.set(m[2] ?? m[3], m[4].trim());
  }
  return props;
}

const unquote = (text) => (/^(['"`])([^'"`]*)\1$/.exec(String(text || '').trim()) || [])[2];

function parseMongooseFields(body) {
  const fields = [];
  for (const [name, value] of objectProps(body)) {
    const field = { name, type: 'mixed', required: false, primaryKey: name === '_id', unique: false, default: '—', description: '' };
    if (value.startsWith('{')) {
      const props = objectProps(value.slice(1, value.lastIndexOf('}')));
      if (props.has('type')) {
        const typeText = props.get('type');
        field.type = mongooseTypeName(typeText);
        field.required = /^(?:true|\[\s*true)/.test(props.get('required') || '');
        field.unique = /^true/.test(props.get('unique') || '');
        if (props.has('default')) field.default = unquote(props.get('default')) ?? props.get('default');
        const ref = unquote(props.get('ref'));
        if (ref) { field._ref = ref; field._many = typeText.trim().startsWith('['); }
      } else {
        field.type = 'object'; // a nested path: its keys are not top-level fields
      }
    } else if (value.startsWith('[')) {
      field.type = 'array';
      const element = value.slice(1, value.lastIndexOf(']')).trim();
      if (element.startsWith('{')) {
        const ref = unquote(objectProps(element.slice(1, element.lastIndexOf('}'))).get('ref'));
        if (ref) { field._ref = ref; field._many = true; }
      }
    } else {
      field.type = mongooseTypeName(value);
    }
    fields.push(field);
  }
  return fields;
}

function mongooseTypeName(text) {
  const t = String(text || '').trim();
  if (t.startsWith('[')) return 'array';
  const last = t.split('.').pop().replace(/[^\w$]/g, '');
  return mapMongooseType(last || 'Mixed');
}

function mapMongooseType(type) {
  const map = {
    'String': 'string', 'Number': 'number', 'Boolean': 'boolean',
    'Date': 'date', 'Buffer': 'buffer', 'ObjectId': 'ObjectId',
    'Array': 'array', 'Map': 'map', 'Mixed': 'mixed',
    'Schema': 'embedded', 'Decimal128': 'decimal', 'BigInt': 'bigint', 'UUID': 'uuid',
  };
  return map[type] || type;
}

// ── Class-based ORMs: TypeORM and Sequelize ────────────────────────────────
//
// The AST tier (js-ast.mjs) and the pattern tier below both return source
// text; the interpreters after them read that text, so a file read by either
// tier yields the same entities (docguard.typeorm-models#FR-005).

/** The text with comments blanked to spaces; strings and line breaks kept, so offsets and lines hold. */
function blankComments(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const start = i;
      for (i++; i < text.length && text[i] !== ch; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
      continue;
    }
    if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      const end = text[i + 1] === '/' ? text.indexOf('\n', i) : text.indexOf('*/', i + 2) + 2;
      const stop = end <= 1 || end < 0 ? text.length : end;
      out += text.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
      continue;
    }
    out += ch;
  }
  return out;
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** Index just past the token at `i`: a string, a bracketed group, a word, or one character. */
function skipToken(text, i) {
  const ch = text[i];
  if (ch === '"' || ch === "'" || ch === '`') {
    let j = i + 1;
    for (; j < text.length && text[j] !== ch; j++) if (text[j] === '\\') j++;
    return j + 1;
  }
  if (ch === '(' || ch === '[' || ch === '{') {
    const close = matchingBracket(text, i);
    return close < 0 ? i + 1 : close + 1;
  }
  const word = /[\w$]+/y;
  word.lastIndex = i;
  return word.test(text) ? word.lastIndex : i + 1;
}

/** The decorator at `text[i] === '@'`: `{ name, args, end }`, args as trimmed source text. */
function decoratorAt(text, i) {
  const head = /@\s*(?:[A-Za-z_$][\w$]*\s*\.\s*)*([A-Za-z_$][\w$]*)\s*/y;
  head.lastIndex = i;
  const m = head.exec(text);
  if (!m) return null;
  let end = head.lastIndex;
  let args = [];
  if (text[end] === '(') {
    const close = matchingBracket(text, end);
    if (close < 0) return null;
    args = splitTopLevel(text.slice(end + 1, close), ',').map(a => a.trim()).filter(Boolean);
    end = close + 1;
  }
  return { name: m[1], args, end };
}

/** Index of the first top-level `stops` character from `i` (brackets and strings skipped). */
function scanTo(text, i, stops) {
  while (i < text.length && !stops(text, i)) {
    const ch = text[i];
    i = (ch === '"' || ch === "'" || ch === '`' || ch === '(' || ch === '[' || ch === '{') ? skipToken(text, i) : i + 1;
  }
  return i;
}

const MEMBER_HEAD = /((?:(?:public|private|protected|readonly|declare|static|override|abstract|accessor|async|get|set)\s+(?=[#A-Za-z_$'"[*]))*)\*?\s*(#?[A-Za-z_$][\w$]*|(['"])[^'"\n]*\3)\s*([?!])?\s*/y;

/** Instance properties of a class body, by pattern: the shape extractDecoratedClasses returns. */
function classMembersByPattern(body) {
  const members = [];
  let pending = [];
  for (let i = 0; i < body.length;) {
    const ch = body[i];
    if (/\s/.test(ch) || ch === ';' || ch === ',') { i++; continue; }
    if (ch === '@') {
      const d = decoratorAt(body, i);
      if (d) { pending.push({ name: d.name, args: d.args }); i = d.end; continue; }
    }
    MEMBER_HEAD.lastIndex = i;
    const m = MEMBER_HEAD.exec(body);
    if (!m || MEMBER_HEAD.lastIndex === i) { pending = []; i = skipToken(body, i); continue; }
    let j = MEMBER_HEAD.lastIndex;
    if (body[j] === '(' || body[j] === '<') {
      // A method or accessor: its parameters, return type and body.
      j = scanTo(body, j, (t, k) => t[k] === '(');
      j = skipToken(body, j);
      j = scanTo(body, j, (t, k) => t[k] === '{' || t[k] === ';');
      if (body[j] === '{') j = skipToken(body, j);
      pending = [];
      i = j;
      continue;
    }
    let type = null;
    const endOfStatement = (t, k) => t[k] === ';' || t[k] === '\n' || t[k] === '}' || (t[k] === '=' && t[k + 1] !== '>');
    if (body[j] === ':') {
      const end = scanTo(body, j + 1, endOfStatement);
      type = body.slice(j + 1, end).trim() || null;
      j = end;
    }
    if (body[j] === '=') j = scanTo(body, j + 1, (t, k) => t[k] === ';' || t[k] === '\n');
    const name = m[3] ? m[2].slice(1, -1) : m[2];
    if (!/\bstatic\s/.test(m[1]) && !name.startsWith('#')) {
      members.push({ name, optional: m[4] === '?', type, decorators: pending });
    }
    pending = [];
    i = j;
  }
  return members;
}

const CLASS_HEAD = /(?:export\s+(?:default\s+)?)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s*<[^>{]*>)?(?:\s+extends\s+((?:[A-Za-z_$][\w$]*\s*\.\s*)*[A-Za-z_$][\w$]*)(?:\s*<[^{]*?>)?)?(?:\s+implements\s+[^{]+)?\s*\{/y;

/** Top-level classes and their decorators, by pattern: the shape extractDecoratedClasses returns. */
function decoratedClassesByPattern(content) {
  const text = blankComments(content);
  const classes = [];
  let pending = [];
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (/\s/.test(ch) || ch === ';') { i++; continue; }
    if (ch === '@') {
      const d = decoratorAt(text, i);
      if (d) { pending.push({ name: d.name, args: d.args }); i = d.end; continue; }
    }
    CLASS_HEAD.lastIndex = i;
    const m = CLASS_HEAD.exec(text);
    if (m) {
      const open = CLASS_HEAD.lastIndex - 1;
      const close = matchingBracket(text, open);
      if (close < 0) break;
      const nameAt = i + m[0].search(/\bclass\s/) + 'class'.length;
      classes.push({
        name: m[1],
        base: m[2] ? m[2].split('.').pop().trim() : null,
        line: lineAt(text, nameAt + text.slice(nameAt).search(/\S/)),
        decorators: pending,
        members: classMembersByPattern(text.slice(open + 1, close)),
      });
      pending = [];
      i = close + 1;
      continue;
    }
    pending = [];
    i = skipToken(text, i);
  }
  return classes;
}

/** The object literal after `text[from]` (an optional `,` first): its inner text, or ''. */
function objectAfter(text, from) {
  let i = from;
  while (/\s/.test(text[i] || '')) i++;
  if (text[i] === ',') i++;
  while (/\s/.test(text[i] || '')) i++;
  if (text[i] !== '{') return '';
  const close = matchingBracket(text, i);
  return close < 0 ? '' : text.slice(i + 1, close);
}

/** Sequelize define/init calls and associations, by pattern: the shape extractSequelizeCalls returns. */
function sequelizeCallsByPattern(content) {
  const text = blankComments(content);
  const models = [];
  const associations = [];
  for (const m of text.matchAll(/(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?)?(?:[A-Za-z_$][\w$]*\s*\.\s*)+define\s*\(\s*(['"])(\w+)\2\s*,\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchingBracket(text, open);
    if (close < 0) continue;
    const callAt = m[1] ? m.index + m[0].indexOf('=') + 1 : m.index;
    models.push({
      call: 'define', name: m[3], receiver: null, binding: m[1] ?? null,
      attributes: text.slice(open + 1, close), options: objectAfter(text, close + 1), line: lineAt(text, callAt + text.slice(callAt).search(/\S/)),
    });
  }
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*init\s*\(\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchingBracket(text, open);
    if (close < 0) continue;
    models.push({ call: 'init', name: null, receiver: m[1], binding: null, attributes: text.slice(open + 1, close), options: objectAfter(text, close + 1), line: lineAt(text, m.index) });
  }
  const classes = [];
  for (const m of text.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)[^{;]*\{/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchingBracket(text, open);
    if (close > open) classes.push({ name: m[1], start: m.index, end: close });
  }
  const enclosingClass = (at) => classes.filter(c => c.start <= at && at < c.end).sort((a, b) => b.start - a.start)[0]?.name ?? null;
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*(belongsToMany|belongsTo|hasMany|hasOne)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchingBracket(text, open);
    if (close < 0) continue;
    const [target = '', options = ''] = splitTopLevel(text.slice(open + 1, close), ',').map(a => a.trim());
    const receiver = m[1] === 'this' ? enclosingClass(m.index) : m[1];
    if (!target || !receiver) continue;
    associations.push({
      receiver, method: m[2], target,
      options: options.startsWith('{') ? options.slice(1, options.lastIndexOf('}')) : '', line: lineAt(text, m.index),
    });
  }
  return { models, associations };
}

/** The tier that read a file: the syntax tree, or the pattern fallback and why. */
function classTier(abs, parsed) {
  return tierFor(abs, parsed ? { ok: true } : (astTierAvailable() ? { ok: false } : null));
}

const isTrue = (text) => String(text ?? '').trim() === 'true';
const isFalse = (text) => String(text ?? '').trim() === 'false';
const lcfirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** Options object among decorator arguments, as a key → text map. */
function decoratorOptions(args) {
  const obj = args.find(a => a.startsWith('{'));
  return obj ? objectProps(obj.slice(1, obj.lastIndexOf('}'))) : new Map();
}

/** A default value's text: `() => 'SQL'` reads as the SQL, a literal unquoted. */
function defaultText(text) {
  const arrow = /^\(\s*\)\s*=>\s*([\s\S]+)$/.exec(String(text).trim());
  const value = arrow ? arrow[1].trim() : String(text).trim();
  return unquote(value) ?? value;
}

const TYPEORM_TYPE_MAP = {
  string: 'string', varchar: 'string', 'character varying': 'string', nvarchar: 'string', 'national varchar': 'string',
  char: 'string', character: 'string', nchar: 'string', text: 'string', tinytext: 'string', mediumtext: 'string',
  longtext: 'string', citext: 'string',
  int: 'integer', integer: 'integer', int2: 'integer', int4: 'integer', smallint: 'integer', tinyint: 'integer', mediumint: 'integer',
  bigint: 'bigint', int8: 'bigint',
  float: 'float', float4: 'float', float8: 'float', real: 'float', double: 'float', 'double precision': 'float',
  decimal: 'decimal', numeric: 'decimal', money: 'decimal',
  boolean: 'boolean', bool: 'boolean', number: 'number',
  timestamp: 'datetime', timestamptz: 'datetime', 'timestamp with time zone': 'datetime',
  'timestamp without time zone': 'datetime', datetime: 'datetime', datetime2: 'datetime', datetimeoffset: 'datetime',
  date: 'date', time: 'time', timetz: 'time',
  json: 'json', jsonb: 'json', 'simple-json': 'json', 'simple-array': 'array',
  uuid: 'uuid', enum: 'enum', 'simple-enum': 'enum',
  bytea: 'bytes', blob: 'bytes', longblob: 'bytes', binary: 'bytes', varbinary: 'bytes',
};

/** A TypeORM column type or a TypeScript property type, normalized. */
function mapTypeOrmType(raw) {
  if (!raw) return 'unknown';
  const parts = String(raw).replace(/\s+/g, ' ').split('|').map(s => s.trim()).filter(s => s && s !== 'null' && s !== 'undefined');
  if (parts.length !== 1) return parts.join(' | ') || 'unknown';
  const t = parts[0];
  if (t === 'Date') return 'datetime';
  if (/\[\]$/.test(t) || /^(?:Array|ReadonlyArray)\s*</.test(t)) return 'array';
  return TYPEORM_TYPE_MAP[t.toLowerCase()] ?? t;
}

const TYPEORM_COLUMNS = new Set(['Column', 'PrimaryGeneratedColumn', 'PrimaryColumn', 'CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn', 'VersionColumn', 'ObjectIdColumn']);
const TYPEORM_RELATIONS = new Set(['ManyToOne', 'OneToMany', 'OneToOne', 'ManyToMany']);
const TYPEORM_INVERSE = { ManyToOne: 'OneToMany', OneToMany: 'ManyToOne', OneToOne: 'OneToOne', ManyToMany: 'ManyToMany' };

/** One column decorator on a property → a field (null for an embedded column). */
function typeOrmField(member, dec) {
  if (dec.name === 'Column' && /^(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(dec.args[0] || '')) return null; // embedded: out of scope
  const opts = decoratorOptions(dec.args);
  const stringArg = dec.args.map(a => unquote(a)).find(v => v !== undefined);
  const rawType = opts.get('type');
  const declared = unquote(rawType) ?? (rawType && /^[A-Za-z_$][\w$.]*$/.test(rawType) ? rawType : undefined);
  let type;
  switch (dec.name) {
    case 'PrimaryGeneratedColumn': type = declared ?? (stringArg === 'uuid' ? 'uuid' : 'integer'); break;
    case 'CreateDateColumn': case 'UpdateDateColumn': case 'DeleteDateColumn': type = declared ?? 'datetime'; break;
    case 'VersionColumn': type = declared ?? 'integer'; break;
    case 'ObjectIdColumn': type = 'ObjectId'; break;
    default: type = declared ?? stringArg ?? member.type;
  }
  const primaryKey = dec.name === 'PrimaryGeneratedColumn' || dec.name === 'PrimaryColumn' || dec.name === 'ObjectIdColumn' || isTrue(opts.get('primary'));
  const required = primaryKey || (dec.name === 'DeleteDateColumn' ? isFalse(opts.get('nullable')) : !isTrue(opts.get('nullable')));
  let fallbackDefault = '—';
  if (dec.name === 'CreateDateColumn' || dec.name === 'UpdateDateColumn') fallbackDefault = 'now()';
  return {
    name: member.name,
    type: type === 'ObjectId' ? type : mapTypeOrmType(type),
    required,
    primaryKey,
    unique: isTrue(opts.get('unique')),
    default: opts.has('default') ? defaultText(opts.get('default')) : fallbackDefault,
    description: unquote(opts.get('comment')) ?? '',
  };
}

/** One relation decorator on a property → `{ kind, field, target, inverse, join }`. */
function typeOrmRelation(member, dec) {
  const [targetArg = '', inverseArg = ''] = dec.args;
  const target = unquote(targetArg) ?? (/=>\s*\(?\s*([A-Za-z_$][\w$]*)/.exec(targetArg) || [])[1];
  if (!target) return null;
  const inverse = unquote(inverseArg) ?? (/=>\s*\(?\s*[A-Za-z_$][\w$]*\s*\.\s*([A-Za-z_$][\w$]*)/.exec(inverseArg) || [])[1] ?? null;
  const join = member.decorators.some(d => d.name === 'JoinColumn' || d.name === 'JoinTable');
  return { kind: dec.name, field: member.name, target, inverse, join };
}

/**
 * TypeORM entities: every `@Entity` class, named by class, with its own and
 * inherited columns; relations drawn once, from the owning side.
 * @implements docguard.typeorm-models#FR-002
 * @implements docguard.typeorm-models#FR-003
 * @implements docguard.typeorm-models#FR-004
 * @implements docguard.typeorm-models#FR-005
 */
function scanTypeOrmEntities(dir, files = []) {
  const classes = [];
  for (const abs of files) {
    const content = readFileSafe(abs);
    if (!content) continue;
    const parsed = extractDecoratedClasses(content, abs);
    const { tier, tierReason } = classTier(abs, parsed);
    for (const c of parsed ?? decoratedClassesByPattern(content)) classes.push({ ...c, file: relPosix(dir, abs), tier, tierReason });
  }

  const byName = new Map();
  for (const c of classes) if (!byName.has(c.name)) byName.set(c.name, c);
  const resolved = new Map();
  const columnsOf = (c, seen = new Set()) => {
    if (resolved.has(c)) return resolved.get(c);
    seen.add(c);
    const parent = c.base ? (classes.find(x => x.name === c.base && x.file === c.file) ?? byName.get(c.base)) : null;
    const inherited = parent && !seen.has(parent) ? columnsOf(parent, seen) : { fields: [], relations: [] };
    const fields = [];
    const relations = [];
    for (const member of c.members) {
      for (const dec of member.decorators) {
        if (TYPEORM_COLUMNS.has(dec.name)) { const f = typeOrmField(member, dec); if (f) fields.push(f); break; }
        if (TYPEORM_RELATIONS.has(dec.name)) { const r = typeOrmRelation(member, dec); if (r) relations.push(r); break; }
      }
    }
    const merge = (base, own, key) => {
      const ownBy = new Map(own.map(x => [x[key], x]));
      const kept = base.map(x => ownBy.get(x[key]) ?? x);
      return [...kept, ...own.filter(x => !base.some(b => b[key] === x[key]))];
    };
    const out = { fields: merge(inherited.fields, fields, 'name'), relations: merge(inherited.relations, relations, 'field') };
    resolved.set(c, out);
    return out;
  };

  const entities = [];
  const rels = [];
  for (const c of classes) {
    const entity = c.decorators.find(d => d.name === 'Entity');
    if (!entity) continue;
    const [first = ''] = entity.args;
    const table = unquote(first) ?? (first.startsWith('{') ? unquote(decoratorOptions([first]).get('name')) : undefined) ?? null;
    const { fields, relations } = columnsOf(c);
    for (const r of relations) rels.push({ ...r, from: c.name });
    entities.push({ name: c.name, table, fields, file: c.file, line: c.line, source: 'typeorm', description: '', tier: c.tier, tierReason: c.tierReason });
  }

  const relationships = [];
  const counterpart = (r) => rels.find(o => o !== r && o.from === r.target && o.target === r.from && o.kind === TYPEORM_INVERSE[r.kind]
    && (!r.inverse || o.field === r.inverse) && (!o.inverse || o.inverse === r.field));
  const TYPE = { ManyToOne: 'many-to-one', OneToMany: 'one-to-many', OneToOne: 'one-to-one', ManyToMany: 'many-to-many' };
  for (const r of rels) {
    const other = counterpart(r);
    let draw;
    if (r.kind === 'ManyToOne') draw = true;
    else if (r.kind === 'OneToMany') draw = !other;
    else if (r.join || !other) draw = true;
    else draw = !other.join && `${r.from}.${r.field}` < `${other.from}.${other.field}`;
    if (draw) relationships.push({ from: r.from, to: r.target, type: TYPE[r.kind], field: r.field });
  }
  return { entities, relationships };
}

const SEQUELIZE_TYPE_MAP = {
  STRING: 'string', CHAR: 'string', TEXT: 'string', CITEXT: 'string',
  INTEGER: 'integer', SMALLINT: 'integer', MEDIUMINT: 'integer', TINYINT: 'integer', BIGINT: 'bigint',
  FLOAT: 'float', REAL: 'float', DOUBLE: 'float', DECIMAL: 'decimal',
  BOOLEAN: 'boolean', DATE: 'datetime', DATEONLY: 'date', TIME: 'time', NOW: 'datetime',
  JSON: 'json', JSONB: 'json', UUID: 'uuid', UUIDV1: 'uuid', UUIDV4: 'uuid',
  ENUM: 'enum', ARRAY: 'array', BLOB: 'bytes', VIRTUAL: 'virtual',
};

/** `DataTypes.STRING(120)` → string. */
function mapSequelizeType(text) {
  const base = String(text || '').trim().split('(')[0].split('.').pop().trim();
  if (!base) return 'unknown';
  return SEQUELIZE_TYPE_MAP[base.toUpperCase()] ?? base;
}

function sequelizeFields(attributes) {
  const fields = [];
  for (const [name, value] of objectProps(attributes)) {
    const opts = value.startsWith('{') ? objectProps(value.slice(1, value.lastIndexOf('}'))) : null;
    const primaryKey = isTrue(opts?.get('primaryKey'));
    fields.push({
      name,
      type: mapSequelizeType(opts ? opts.get('type') : value),
      required: primaryKey || isFalse(opts?.get('allowNull')),
      primaryKey,
      unique: isTrue(opts?.get('unique')),
      default: opts?.has('defaultValue') ? defaultText(opts.get('defaultValue')) : '—',
      description: unquote(opts?.get('comment')) ?? '',
    });
  }
  return fields;
}

/**
 * Sequelize models from `define` and `init`, with their declared attributes;
 * associations drawn once, from the `belongsTo` side when both are declared.
 * @implements docguard.typeorm-models#FR-005
 * @implements docguard.typeorm-models#FR-006
 */
function scanSequelizeModels(dir, files = []) {
  const models = [];
  const calls = [];
  const globalNames = new Map();
  for (const abs of files) {
    const content = readFileSafe(abs);
    if (!content) continue;
    const parsed = extractSequelizeCalls(content, abs);
    const { tier, tierReason } = classTier(abs, parsed);
    const found = parsed ?? sequelizeCallsByPattern(content);
    const file = relPosix(dir, abs);
    const names = new Map();
    for (const m of found.models) {
      // `Model.init` needs `sequelize` in its options: other `x.init({}, {})` calls are not models.
      if (m.call === 'init' && !/(?:^|[\s,])sequelize\s*(?:[,:]|$)/.test((m.options || '').trim())) continue;
      const opts = objectProps(m.options || '');
      const name = m.call === 'define' ? m.name : (unquote(opts.get('modelName')) ?? m.receiver);
      const handle = m.binding ?? m.receiver;
      if (handle) { names.set(handle, name); if (!globalNames.has(handle)) globalNames.set(handle, name); }
      models.push({
        name, table: unquote(opts.get('tableName')) ?? null, fields: sequelizeFields(m.attributes),
        file, line: m.line, source: 'sequelize', description: '', tier, tierReason,
      });
    }
    for (const a of found.associations) calls.push({ ...a, names });
  }

  const known = new Set(models.map(m => m.name));
  const nameOf = (id, names) => names?.get(id) ?? globalNames.get(id) ?? id;
  const assoc = [];
  for (const a of calls) {
    const from = nameOf(a.receiver, a.names);
    const last = (/([A-Za-z_$][\w$]*)\s*$/.exec(a.target) || [])[1];
    if (!known.has(from) || !last) continue;
    const to = nameOf(last, a.names);
    assoc.push({ from, to, method: a.method, field: unquote(objectProps(a.options || '').get('as')) ?? lcfirst(to) });
  }
  const other = (a, methods) => assoc.find(o => o !== a && o.from === a.to && o.to === a.from && methods.includes(o.method));
  const relationships = [];
  for (const a of assoc) {
    const edge = (type) => relationships.push({ from: a.from, to: a.to, type, field: a.field });
    if (a.method === 'belongsTo') edge(other(a, ['hasOne', 'hasMany'])?.method === 'hasOne' ? 'one-to-one' : 'many-to-one');
    else if (a.method === 'hasMany' || a.method === 'hasOne') { if (!other(a, ['belongsTo'])) edge(a.method === 'hasMany' ? 'one-to-many' : 'one-to-one'); }
    else {
      const o = other(a, ['belongsToMany']);
      if (!o || `${a.from}.${a.field}` < `${o.from}.${o.field}`) edge('many-to-many');
    }
  }
  return { entities: models, relationships };
}

// ── Rust: Diesel `table! { ... }` ─────────────────────────────────────────────

function scanRustModels(dir) {
  const entities = [];
  walkDir(dir, (filePath) => {
    if (!filePath.endsWith('.rs')) return;
    const content = readFileSafe(filePath);
    if (!content || !content.includes('table!')) return;
    const tableRe = /table!\s*\{\s*(\w+)\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\}/g;
    let m;
    while ((m = tableRe.exec(content)) !== null) {
      const name = m[1];
      const body = m[2];
      const fields = [];
      const colRe = /(\w+)\s*->\s*(\w+)/g;
      let cm;
      while ((cm = colRe.exec(body)) !== null) {
        fields.push({ name: cm[1], type: cm[2], required: !/Nullable/.test(cm[2]), description: '' });
      }
      if (fields.length > 0) entities.push({ name, fields, file: filePath, source: 'diesel' });
    }
  });
  return { entities, relationships: [] };
}

// ── Go: structs with json/gorm/db tags ───────────────────────────────────────

function scanGoModels(dir) {
  const entities = [];
  walkDir(dir, (filePath) => {
    if (!filePath.endsWith('.go')) return;
    const content = readFileSafe(filePath);
    if (!content || !/`[^`]*\b(json|gorm|db|bson):/.test(content)) return;
    const structRe = /type\s+(\w+)\s+struct\s*\{([\s\S]*?)\}/g;
    let m;
    while ((m = structRe.exec(content)) !== null) {
      const name = m[1];
      const body = m[2];
      const fields = [];
      const fieldRe = /^\s*(\w+)\s+([\w*.\[\]]+)\s+`([^`]+)`/gm;
      let fm;
      while ((fm = fieldRe.exec(body)) !== null) {
        const fname = fm[1];
        const ftype = fm[2];
        const tag = fm[3];
        if (!/\b(json|gorm|db|bson):/.test(tag)) continue;
        const required = !tag.includes('omitempty');
        fields.push({ name: fname, type: ftype, required, description: '' });
      }
      if (fields.length > 0) entities.push({ name, fields, file: filePath, source: 'go-struct' });
    }
  });
  return { entities, relationships: [] };
}

// ── Java/Kotlin: JPA @Entity ─────────────────────────────────────────────────

function scanJpaModels(dir) {
  const entities = [];
  walkDir(dir, (filePath) => {
    if (!/\.(java|kt)$/.test(filePath)) return;
    const content = readFileSafe(filePath);
    if (!content || !content.includes('@Entity')) return;
    const classRe = /@Entity[\s\S]*?class\s+(\w+)\s*(?:\([^)]*\))?\s*\{([\s\S]*?)^\}/gm;
    let m;
    while ((m = classRe.exec(content)) !== null) {
      const name = m[1];
      const body = m[2];
      const fields = [];
      const fieldRe = /(?:private|public|protected|val|var)\s+([\w<>]+)\s+(\w+)\s*[;=]/g;
      let fm;
      while ((fm = fieldRe.exec(body)) !== null) {
        const ftype = fm[1];
        const fname = fm[2];
        if (/^(boolean|int|long|short|byte|float|double|char)$/.test(ftype) || /^[A-Z]/.test(ftype)) {
          fields.push({ name: fname, type: ftype, required: true, description: '' });
        }
      }
      if (fields.length > 0) entities.push({ name, fields, file: filePath, source: 'jpa' });
    }
  });
  return { entities, relationships: [] };
}

// ── Rails: ActiveRecord migrations + schema.rb ───────────────────────────────

function scanRailsModels(dir) {
  const entities = [];
  walkDir(dir, (filePath) => {
    if (!/db\/(migrate|schema\.rb)/.test(filePath) || !filePath.endsWith('.rb')) return;
    const content = readFileSafe(filePath);
    if (!content || !content.includes('create_table')) return;
    const tableRe = /create_table\s+:(\w+)\s+do\s+\|t\|([\s\S]*?)end/g;
    let m;
    while ((m = tableRe.exec(content)) !== null) {
      const name = m[1];
      const body = m[2];
      const fields = [{ name: 'id', type: 'integer', required: true, description: '' }];
      const colRe = /t\.(string|text|integer|float|decimal|datetime|date|time|boolean|json|binary|references)\s+:(\w+)(?:\s*,\s*([^,\n]+))?/g;
      let cm;
      while ((cm = colRe.exec(body)) !== null) {
        const required = !!cm[3] && /null:\s*false/.test(cm[3]);
        fields.push({ name: cm[2], type: cm[1], required, description: '' });
      }
      entities.push({ name, fields, file: filePath, source: 'rails-migration' });
    }
  });
  return { entities, relationships: [] };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractOpenAPIRelationships(schemas) {
  const relationships = [];
  for (const schema of schemas) {
    for (const field of schema.fields) {
      if (!field.type) continue; // OpenAPI allows a field with no `type` (e.g. a bare $ref)
      if (field.type !== 'string' && field.type !== 'number' && field.type !== 'boolean' && field.type !== 'integer') {
        // Likely a reference to another schema
        const target = schemas.find(s => s.name.toLowerCase() === field.type.toLowerCase());
        if (target) {
          relationships.push({
            from: schema.name,
            to: target.name,
            type: 'reference',
            field: field.name,
          });
        }
      }
    }
  }
  return relationships;
}

function readFileSafe(path) {
  return readScannable(path); // size-capped; skips minified/generated bundles
}

// v0.15-P2: the Zod, Diesel, Go, JPA and Rails scanners each call walkDir
// over the same tree. Cache the file list per (dir, extension-set) so
// subsequent callers iterate an array instead of re-traversing.
//
// Cache key: just the dir path. The extension filter is constant across all
// callers (the regex hard-coded below), so a single cache slot per dir works.
// Lifetime: per-process. `clearWalkDirCache()` invalidates for tests.
const _walkDirCache = new Map(); // dir → string[] of file paths

export function clearWalkDirCache() {
  _walkDirCache.clear();
}

const _CODE_FILE_RE = /\.(js|mjs|cjs|ts|tsx|jsx|py|rs|go|java|kt|rb)$/;

function _collectFiles(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      _collectFiles(fullPath, out);
    } else if (entry.isFile() && _CODE_FILE_RE.test(entry.name)) {
      out.push(fullPath);
    }
  }
}

function walkDir(dir, callback) {
  if (!existsSync(dir)) return;
  let files = _walkDirCache.get(dir);
  if (!files) {
    files = [];
    _collectFiles(dir, files);
    _walkDirCache.set(dir, files);
  }
  for (const f of files) callback(f);
}

/**
 * Generate mermaid ER diagram from entities and relationships.
 */
export function generateERDiagram(entities, relationships) {
  if (entities.length === 0) return '';

  const lines = ['erDiagram'];
  // Sorted, so the diagram only changes when the schema does: scan order
  // depends on the file walk (docguard.code-derived-diagrams#FR-005).
  const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  entities = [...entities].sort((a, b) => byText(String(a.name), String(b.name)));
  relationships = [...(relationships || [])].sort((a, b) => byText(String(a.from), String(b.from))
    || byText(String(a.to), String(b.to)) || byText(String(a.field), String(b.field)));

  // Add entities with fields
  for (const entity of entities) {
    if (entity.source === 'prisma-enum') continue; // Skip enums in ER
    const fieldLines = (entity.fields || [])
      .slice(0, 8) // Limit fields shown
      .map(f => {
        const pk = f.primaryKey ? ' PK' : '';
        const uk = f.unique ? ' UK' : '';
        // The first word of the type, Mermaid-safe: `integer (auto)` → `integer`.
        const type = String(f.type || 'unknown').trim().split(/[\s(]/)[0] || 'unknown';
        return `        ${type.replace(/[^a-zA-Z0-9]/g, '_')} ${f.name}${pk}${uk}`;
      });
    lines.push(`    ${entity.name} {`);
    lines.push(...fieldLines);
    lines.push(`    }`);
  }

  // Add relationships (each once)
  const drawn = new Set();
  for (const rel of relationships) {
    const arrow = rel.type === 'one-to-many' ? '||--o{' :
      rel.type === 'many-to-one' ? '}o--||' :
      rel.type === 'many-to-many' ? '}o--o{' :
        rel.type === 'related' ? '}o..o{' : '||--||';
    const line = `    ${rel.from} ${arrow} ${rel.to} : "${rel.field}"`;
    if (drawn.has(line)) continue;
    drawn.add(line);
    lines.push(line);
  }

  return lines.join('\n');
}
