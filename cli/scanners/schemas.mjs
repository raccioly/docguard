/**
 * Deep Schema Scanner
 * Parses schema definitions from ORM/validation libraries.
 * Supports: Prisma, Drizzle, Zod, Mongoose, TypeORM, OpenAPI schemas
 * 
 * Priority: OpenAPI schemas > ORM schemas > Validation schemas
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import { extractJsSchemaBodies, splitTopLevel, stripComments, matchingBracket } from './js-ast.mjs';
import { scanPythonModels } from './python-models.mjs';
import { readScannable, resolveSourceRoots, getWorkspaceDirs } from '../shared-source.mjs';
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

  // Priority 2: ORM-specific scanning. Prisma, Drizzle and Mongoose come from
  // the discovery guard's schema check also uses (docguard.js-ts-extraction#FR-010).
  const entities = [];
  const relationships = [];
  const orm = scanOrmEntities(dir, config);

  // Prisma (enums are reported apart from entities: FR-008)
  entities.push(...orm.prisma.entities);
  relationships.push(...orm.prisma.relationships);

  // Drizzle
  entities.push(...orm.drizzle.entities);
  relationships.push(...orm.drizzle.relationships);

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
// Prisma, Drizzle and Mongoose entities through scanOrmEntities(). Two
// independent directory lists used to drift: guard found Drizzle tables under
// `lib/db` while generate reported none.

const JS_SCHEMA_FILE_RE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
// Conventional top-level schema dirs, searched besides the source roots.
const ORM_SEARCH_DIRS = ['db', 'database', 'schema', 'schemas', 'drizzle', 'models', 'model'];
const DRIZZLE_CONFIG_FILES = ['drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.mjs', 'drizzle.config.cjs', 'drizzle.config.mts', 'drizzle.config.json'];
// A table builder called with a literal table name: specific to Drizzle.
const DRIZZLE_TABLE_RE = /\b(?:pg|mysql|sqlite)Table\s*\(\s*['"`]\w+['"`]/;
const MONGOOSE_SCHEMA_RE = /\bnew\s+(?:mongoose\s*\.\s*)?Schema\s*(?:<[^>]*>)?\s*\(/;

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
 * Where Prisma, Drizzle and Mongoose schemas live.
 * - Prisma: `prisma/*.prisma` and `prisma/schema/*.prisma` under the project,
 *   its workspaces and source roots, plus package.json `prisma.schema`.
 * - Drizzle: drizzle.config.* `schema` first; otherwise a search of the
 *   conventional dirs and source roots for files that call a table builder
 *   (`pgTable('users', …)`).
 * - Mongoose: the same search, for files that construct a mongoose Schema.
 * Every file appears once (absolute paths), so `src/db` inside `src` is not
 * scanned twice.
 * @implements docguard.js-ts-extraction#FR-006
 * @implements docguard.js-ts-extraction#FR-007
 * @implements docguard.js-ts-extraction#FR-010
 * @returns {{ prisma: string[], drizzle: string[], mongoose: string[] }}
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
  for (const base of ormSearchBases(dir, config)) {
    for (const file of freshFiles(base)) {
      if (!JS_SCHEMA_FILE_RE.test(file) || !keepSchemaFile(dir, file, config)) continue;
      const content = readFileSafe(file);
      if (!content) continue;
      if (configured.length === 0 && DRIZZLE_TABLE_RE.test(content)) drizzle.add(file);
      if (content.includes('mongoose') && MONGOOSE_SCHEMA_RE.test(content)) mongoose.add(file);
    }
  }
  const order = list => [...list].filter(f => keepSchemaFile(dir, f, config)).sort();
  return { prisma: order(prisma), drizzle: order(drizzle), mongoose: order(mongoose) };
}

/**
 * Prisma, Drizzle and Mongoose entities, relationships and (Prisma) enums —
 * the one discovery and parse both guard and generate use.
 * @implements docguard.js-ts-extraction#FR-010
 */
export function scanOrmEntities(dir, config = {}) {
  const files = discoverOrmSchemaFiles(dir, config);
  return {
    prisma: scanPrismaDeep(dir, files.prisma),
    drizzle: scanDrizzleSchemas(dir, files.drizzle),
    mongoose: scanMongooseSchemas(dir, files.mongoose),
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

// v0.15-P2: walkDir is called 8 times across schemas.mjs (Pydantic, Mongoose,
// Prisma, SQLAlchemy, Sequelize, GORM, Sqlx, Hibernate). Each call walks the
// same tree. Cache the file list per (dir, extension-set) so subsequent
// callers iterate an array instead of re-traversing.
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
