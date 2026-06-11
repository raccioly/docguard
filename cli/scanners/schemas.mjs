/**
 * Deep Schema Scanner
 * Parses schema definitions from ORM/validation libraries.
 * Supports: Prisma, Drizzle, Zod, Mongoose, TypeORM, OpenAPI schemas
 * 
 * Priority: OpenAPI schemas > ORM schemas > Validation schemas
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative, basename, extname } from 'node:path';
import { extractJsSchemaBodies } from './js-ast.mjs';
import { extractPythonFiles } from './py-ast.mjs';
import { readScannable } from '../shared-source.mjs';
import { DEFAULT_IGNORE_DIRS as IGNORE_DIRS, shouldIgnore, relPosix } from '../shared-ignore.mjs';

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

  // Priority 2: ORM-specific scanning
  const orm = stack?.orm || '';
  const entities = [];
  const relationships = [];

  // Prisma
  const prismaResult = scanPrismaDeep(dir);
  if (prismaResult.entities.length > 0) {
    entities.push(...prismaResult.entities);
    relationships.push(...prismaResult.relationships);
  }

  // Drizzle
  const drizzleResult = scanDrizzleSchemas(dir);
  if (drizzleResult.entities.length > 0) {
    entities.push(...drizzleResult.entities);
    relationships.push(...drizzleResult.relationships);
  }

  // Zod (if no ORM found, Zod schemas are the data model)
  if (entities.length === 0) {
    const zodResult = scanZodSchemas(dir);
    entities.push(...zodResult.entities);
  }

  // Mongoose
  const mongooseResult = scanMongooseSchemas(dir);
  if (mongooseResult.entities.length > 0) {
    entities.push(...mongooseResult.entities);
    relationships.push(...mongooseResult.relationships);
  }

  // ── Multi-language model scanners (additive; supports polyglot repos) ──
  for (const scanner of [scanPythonModels, scanRustModels, scanGoModels, scanJpaModels, scanRailsModels]) {
    const result = scanner(dir);
    if (result.entities.length > 0) {
      entities.push(...result.entities);
      relationships.push(...(result.relationships || []));
    }
  }

  // Honor .docguardignore / config.ignore: drop entities whose source file the
  // user excluded (e.g. test/fixtures/**), then drop relationships that point at
  // a dropped entity. Filtering the RESULTS (not the walk) keeps the cache and
  // the per-ORM walkers untouched. entity.file is project-relative already.
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
    source: keptEntities.length > 0 ? keptEntities[0].source : 'none',
  };
}

// ── Prisma Deep Parser ──────────────────────────────────────────────────────

function scanPrismaDeep(dir) {
  const entities = [];
  const relationships = [];

  const schemaPath = resolve(dir, 'prisma/schema.prisma');
  if (!existsSync(schemaPath)) return { entities, relationships };

  const content = readFileSync(schemaPath, 'utf-8');

  // Parse all models
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let modelMatch;

  while ((modelMatch = modelRegex.exec(content)) !== null) {
    const modelName = modelMatch[1];
    const body = modelMatch[2];
    const fields = [];

    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('@@')) continue;

      // Parse field: name Type @modifiers
      const fieldMatch = trimmed.match(/^(\w+)\s+([\w\[\]?]+)(\s+.*)?$/);
      if (!fieldMatch) continue;

      const fieldName = fieldMatch[1];
      const rawType = fieldMatch[2];
      const modifiers = fieldMatch[3] || '';

      // Skip relation fields for field list (but track relationships)
      const isRelation = rawType.endsWith('[]') || modifiers.includes('@relation');

      if (isRelation && rawType.endsWith('[]')) {
        relationships.push({
          from: modelName,
          to: rawType.replace('[]', '').replace('?', ''),
          type: 'one-to-many',
          field: fieldName,
        });
        continue;
      }

      if (isRelation && !rawType.endsWith('[]') && modifiers.includes('@relation')) {
        relationships.push({
          from: modelName,
          to: rawType.replace('?', ''),
          type: 'many-to-one',
          field: fieldName,
        });
        continue;
      }

      fields.push({
        name: fieldName,
        type: mapPrismaType(rawType),
        required: !rawType.includes('?'),
        primaryKey: modifiers.includes('@id'),
        unique: modifiers.includes('@unique'),
        default: extractPrismaDefault(modifiers),
        description: extractInlineComment(line),
      });
    }

    entities.push({
      name: modelName,
      fields,
      file: 'prisma/schema.prisma',
      source: 'prisma',
      description: '',
    });
  }

  // Parse enums
  const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g;
  let enumMatch;
  while ((enumMatch = enumRegex.exec(content)) !== null) {
    const enumName = enumMatch[1];
    const values = enumMatch[2].trim().split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('//'));

    entities.push({
      name: enumName,
      fields: values.map(v => ({ name: v, type: 'enum_value', required: true })),
      file: 'prisma/schema.prisma',
      source: 'prisma-enum',
      description: `Enum with ${values.length} values`,
    });
  }

  return { entities, relationships };
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
  const match = modifiers.match(/@default\(([^)]+)\)/);
  if (!match) return '—';
  return match[1];
}

function extractInlineComment(line) {
  const match = line.match(/\/\/\s*(.+)$/);
  return match ? match[1].trim() : '';
}

// ── Drizzle Scanner ─────────────────────────────────────────────────────────

function scanDrizzleSchemas(dir) {
  const entities = [];
  const relationships = [];

  const schemaDirs = ['src/db', 'src/schema', 'db', 'schema', 'drizzle', 'src/drizzle', 'src'];
  const tablePattern = /(?:export\s+(?:const|let)\s+)?(\w+)\s*=\s*(?:pg|mysql|sqlite)Table\s*\(\s*['"`](\w+)['"`]\s*,\s*\{([^}]+)\}/g;

  for (const schemaDir of schemaDirs) {
    const fullDir = resolve(dir, schemaDir);
    if (!existsSync(fullDir)) continue;

    walkDir(fullDir, (filePath) => {
      const content = readFileSafe(filePath);
      if (!content || !content.includes('Table(')) return;

      // Emit one entity from a (tableName, body) pair. `body` is the balanced
      // inner text of the table's column object.
      const emit = (tableName, body) => {
        const fields = parseDrizzleColumns(body);
        for (const field of fields) {
          if (field._ref) {
            relationships.push({ from: tableName, to: field._ref, type: 'many-to-one', field: field.name });
          }
        }
        entities.push({
          name: tableName,
          fields: fields.map(f => ({ ...f, _ref: undefined })),
          file: relative(dir, filePath),
          source: 'drizzle',
          description: '',
        });
      };

      // Full-support tier: AST extraction (nested braces handled). Falls back
      // to the legacy regex only when @babel/parser can't parse the file.
      const ast = extractJsSchemaBodies(content, filePath);
      if (ast) {
        for (const s of ast) if (s.kind === 'drizzle') emit(s.table, s.body);
      } else {
        let match;
        const regex = new RegExp(tablePattern.source, 'g');
        while ((match = regex.exec(content)) !== null) emit(match[2], match[3]);
      }
    });
  }

  return { entities, relationships };
}

function parseDrizzleColumns(body) {
  const fields = [];
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Match: fieldName: type('column_name')
    const colMatch = trimmed.match(/(\w+)\s*:\s*(\w+)\s*\(\s*['"`]?(\w+)?['"`]?\s*\)/);
    if (!colMatch) continue;

    const fieldName = colMatch[1];
    const drizzleType = colMatch[2];

    const field = {
      name: fieldName,
      type: mapDrizzleType(drizzleType),
      required: !trimmed.includes('.notNull()') ? false : true,
      primaryKey: trimmed.includes('.primaryKey()') || drizzleType === 'serial',
      unique: trimmed.includes('.unique()'),
      default: extractDrizzleDefault(trimmed),
      description: '',
    };

    // Check for references
    const refMatch = trimmed.match(/\.references\(\s*\(\)\s*=>\s*(\w+)\.\w+\)/);
    if (refMatch) {
      field._ref = refMatch[1];
    }

    fields.push(field);
  }

  return fields;
}

function mapDrizzleType(type) {
  const map = {
    'serial': 'integer (auto)', 'integer': 'integer', 'bigint': 'bigint',
    'smallint': 'smallint', 'text': 'string', 'varchar': 'string',
    'char': 'string', 'boolean': 'boolean', 'timestamp': 'datetime',
    'date': 'date', 'time': 'time', 'json': 'json', 'jsonb': 'json',
    'real': 'float', 'doublePrecision': 'double', 'numeric': 'decimal',
    'uuid': 'uuid',
  };
  return map[type] || type;
}

function extractDrizzleDefault(line) {
  const match = line.match(/\.default\(([^)]+)\)/);
  if (match) return match[1].replace(/['"`]/g, '');
  if (line.includes('.defaultNow()')) return 'now()';
  if (line.includes('.defaultRandom()')) return 'random()';
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

function scanMongooseSchemas(dir) {
  const entities = [];
  const relationships = [];

  const schemaDirs = ['src/models', 'models', 'src/schema', 'schema'];
  const schemaPattern = /(?:const|let|var)\s+(\w+)(?:Schema)?\s*=\s*new\s+(?:mongoose\.)?Schema\s*\(\s*\{([^}]+)\}/g;

  for (const schemaDir of schemaDirs) {
    const fullDir = resolve(dir, schemaDir);
    if (!existsSync(fullDir)) continue;

    walkDir(fullDir, (filePath) => {
      const content = readFileSafe(filePath);
      if (!content || !content.includes('Schema(')) return;

      const emit = (rawName, body) => {
        const schemaName = rawName.replace(/Schema$/i, '');
        const fields = parseMongooseFields(body);
        for (const field of fields) {
          if (field._ref) {
            relationships.push({ from: schemaName, to: field._ref, type: 'many-to-one', field: field.name });
          }
        }
        entities.push({
          name: schemaName.charAt(0).toUpperCase() + schemaName.slice(1),
          fields: fields.map(f => ({ ...f, _ref: undefined })),
          file: relative(dir, filePath),
          source: 'mongoose',
          description: '',
        });
      };

      const ast = extractJsSchemaBodies(content, filePath);
      if (ast) {
        for (const s of ast) if (s.kind === 'mongoose') emit(s.name, s.body);
      } else {
        let match;
        const regex = new RegExp(schemaPattern.source, 'g');
        while ((match = regex.exec(content)) !== null) emit(match[1], match[2]);
      }
    });
  }

  return { entities, relationships };
}

function parseMongooseFields(body) {
  const fields = [];
  const lines = body.split('\n');

  for (const line of lines) {
    const trimmed = line.trim().replace(/,$/, '');
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Match: fieldName: Type or fieldName: { type: Type }
    const simpleMatch = trimmed.match(/(\w+)\s*:\s*(\w+)/);
    if (!simpleMatch) continue;

    const fieldName = simpleMatch[1];
    const typeOrKey = simpleMatch[2];

    if (typeOrKey === 'type') {
      // Complex field: { type: String, required: true }
      const typeMatch = trimmed.match(/type\s*:\s*(\w+)/);
      const required = trimmed.includes('required: true') || trimmed.includes("required: 'true'");
      const unique = trimmed.includes('unique: true');
      const refMatch = trimmed.match(/ref\s*:\s*['"](\w+)['"]/);

      fields.push({
        name: fieldName,
        type: mapMongooseType(typeMatch ? typeMatch[1] : 'Mixed'),
        required,
        primaryKey: fieldName === '_id',
        unique,
        default: '—',
        description: '',
        _ref: refMatch ? refMatch[1] : null,
      });
    } else {
      // Simple field: fieldName: String
      fields.push({
        name: fieldName,
        type: mapMongooseType(typeOrKey),
        required: false,
        primaryKey: fieldName === '_id',
        unique: false,
        default: '—',
        description: '',
      });
    }
  }

  return fields;
}

function mapMongooseType(type) {
  const map = {
    'String': 'string', 'Number': 'number', 'Boolean': 'boolean',
    'Date': 'date', 'Buffer': 'buffer', 'ObjectId': 'ObjectId',
    'Array': 'array', 'Map': 'map', 'Mixed': 'mixed',
    'Schema': 'embedded',
  };
  return map[type] || type;
}

// ── Python: SQLAlchemy + Pydantic ────────────────────────────────────────────

function scanPythonModels(dir) {
  const entities = [];
  const relationships = [];

  // Collect .py files first so the AST tier parses them in ONE python3
  // subprocess. `null` → Python unavailable / subprocess failed → regex
  // fallback for all; a per-file `ok:false` falls back for that file only.
  // The AST tier gets every field exactly (no body-capture truncation, no
  // miss on multi-base classes) — undercounting fields is what makes the
  // data-model validators falsely pass on a stale DATA-MODEL.md.
  const pyFiles = [];
  walkDir(dir, (filePath) => { if (filePath.endsWith('.py')) pyFiles.push(filePath); });
  const astByFile = extractPythonFiles(pyFiles);

  for (const filePath of pyFiles) {
    const parsed = astByFile && astByFile[filePath];
    if (parsed && parsed.ok) {
      for (const s of parsed.schemas || []) {
        const fields = (s.fields || []).map(f => ({
          name: f.name, type: f.type || '', required: f.required !== false, description: '',
        }));
        if (fields.length > 0) entities.push({ name: s.name, fields, file: filePath, source: s.kind });
        for (const to of s.rels || []) relationships.push({ from: s.name, to, type: 'related' });
      }
      continue;
    }
    scanPythonModelsRegex(filePath, entities, relationships);
  }
  return { entities, relationships };
}

// Regex (beta) fallback — used per-file when the Python AST tier is unavailable
// or couldn't parse that file. Identical behavior to the pre-AST scanner.
function scanPythonModelsRegex(filePath, entities, relationships) {
  {
    const content = readFileSafe(filePath);
    if (!content) return;
    if (!/class\s+\w+\s*\([^)]*(Base|BaseModel|db\.Model|Model|SQLModel)/.test(content)) return;

    // SQLAlchemy ORM: class X(Base): __tablename__ = "x"; id = Column(...)
    const ormRe = /class\s+(\w+)\s*\([^)]*(?:Base|db\.Model|SQLModel)[^)]*\):([\s\S]*?)(?=\nclass\s+\w+|\n*$)/g;
    let m;
    while ((m = ormRe.exec(content)) !== null) {
      const name = m[1];
      const body = m[2];
      const fields = [];
      const colRe = /^\s*(\w+)\s*=\s*(?:mapped_column|Column)\s*\(\s*([A-Za-z_]+)(?:\([^)]*\))?([^)]*)\)/gm;
      let cm;
      while ((cm = colRe.exec(body)) !== null) {
        const required = !/nullable\s*=\s*True/.test(cm[3]);
        fields.push({ name: cm[1], type: cm[2], required, description: '' });
      }
      const relRe = /(\w+)\s*[:=]\s*(?:Mapped\[[^\]]*?["'](\w+)["']|relationship\s*\(\s*["'](\w+)["'])/g;
      let rm;
      while ((rm = relRe.exec(body)) !== null) {
        relationships.push({ from: name, to: rm[2] || rm[3], type: 'related' });
      }
      if (fields.length > 0) entities.push({ name, fields, file: filePath, source: 'sqlalchemy' });
    }

    // Pydantic / SQLModel: class X(BaseModel): name: str
    const pydRe = /class\s+(\w+)\s*\([^)]*(?:BaseModel|SQLModel)[^)]*\):([\s\S]*?)(?=\nclass\s+\w+|\n*$)/g;
    while ((m = pydRe.exec(content)) !== null) {
      const name = m[1];
      if (entities.some(e => e.name === name)) continue;
      const body = m[2];
      const fields = [];
      const fieldRe = /^\s{2,}(\w+)\s*:\s*([\w\[\],\s|]+?)(?:\s*=\s*([^\n]+))?$/gm;
      let fm;
      while ((fm = fieldRe.exec(body)) !== null) {
        const fname = fm[1];
        if (/^[A-Z_]+$/.test(fname)) continue;
        const type = fm[2].trim();
        const required = !/Optional|None|None\s*$/.test(type + (fm[3] || ''));
        fields.push({ name: fname, type, required, description: '' });
      }
      if (fields.length > 0) entities.push({ name, fields, file: filePath, source: 'pydantic' });
    }
  }
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

  // PERFORMANCE OPTIMIZATION: Precompute an O(1) Map lookup of lowercased schema names
  // to avoid an O(N^2) algorithmic bottleneck from using a nested Array.find search.
  const schemaMap = new Map();
  for (const s of schemas) {
    if (s.name) {
      schemaMap.set(s.name.toLowerCase(), s);
    }
  }

  for (const schema of schemas) {
    for (const field of schema.fields) {
      if (field.type !== 'string' && field.type !== 'number' && field.type !== 'boolean' && field.type !== 'integer') {
        // Likely a reference to another schema
        const target = schemaMap.get(field.type.toLowerCase());
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

  // Add entities with fields
  for (const entity of entities) {
    if (entity.source === 'prisma-enum') continue; // Skip enums in ER
    const fieldLines = entity.fields
      .slice(0, 8) // Limit fields shown
      .map(f => {
        const pk = f.primaryKey ? ' PK' : '';
        const uk = f.unique ? ' UK' : '';
        return `        ${f.type.replace(/[^a-zA-Z0-9]/g, '_')} ${f.name}${pk}${uk}`;
      });
    lines.push(`    ${entity.name} {`);
    lines.push(...fieldLines);
    lines.push(`    }`);
  }

  // Add relationships
  for (const rel of relationships) {
    const arrow = rel.type === 'one-to-many' ? '||--o{' :
      rel.type === 'many-to-one' ? '}o--||' : '||--||';
    lines.push(`    ${rel.from} ${arrow} ${rel.to} : "${rel.field}"`);
  }

  return lines.join('\n');
}
