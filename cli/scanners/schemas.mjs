/**
 * Deep Schema Scanner
 * Parses schema definitions from ORM/validation libraries.
 * Supports: Prisma, Drizzle, Zod, Mongoose, TypeORM, OpenAPI schemas
 * 
 * Priority: OpenAPI schemas > ORM schemas > Validation schemas
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative, basename, extname } from 'node:path';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo',
]);

/**
 * Deep scan schemas from ORM definitions, validation libraries, and OpenAPI specs.
 * @param {string} dir - Project root
 * @param {object} stack - Detected tech stack
 * @param {object} docTools - Detected doc tools (may include OpenAPI)
 * @returns {object} { entities: [...], relationships: [...], source: string }
 */
export function scanSchemasDeep(dir, stack, docTools) {
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

  return {
    entities,
    relationships,
    source: entities.length > 0 ? entities[0].source : 'none',
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

      let match;
      const regex = new RegExp(tablePattern.source, 'g');
      while ((match = regex.exec(content)) !== null) {
        const varName = match[1];
        const tableName = match[2];
        const body = match[3];
        const fields = parseDrizzleColumns(body);

        // Look for references (foreign keys)
        for (const field of fields) {
          if (field._ref) {
            relationships.push({
              from: tableName,
              to: field._ref,
              type: 'many-to-one',
              field: field.name,
            });
          }
        }

        entities.push({
          name: tableName,
          fields: fields.map(f => ({ ...f, _ref: undefined })),
          file: relative(dir, filePath),
          source: 'drizzle',
          description: '',
        });
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

      let match;
      const regex = new RegExp(zodPattern.source, 'g');
      while ((match = regex.exec(content)) !== null) {
        const schemaName = match[1].replace(/Schema$|Validator$/, '');
        const body = match[2];
        const fields = parseZodFields(body);

        entities.push({
          name: schemaName,
          fields,
          file: relative(dir, filePath),
          source: 'zod',
          description: '',
        });
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

      let match;
      const regex = new RegExp(schemaPattern.source, 'g');
      while ((match = regex.exec(content)) !== null) {
        const schemaName = match[1].replace(/Schema$/i, '');
        const body = match[2];
        const fields = parseMongooseFields(body);

        // Check for refs (relationships)
        for (const field of fields) {
          if (field._ref) {
            relationships.push({
              from: schemaName,
              to: field._ref,
              type: 'many-to-one',
              field: field.name,
            });
          }
        }

        entities.push({
          name: schemaName.charAt(0).toUpperCase() + schemaName.slice(1),
          fields: fields.map(f => ({ ...f, _ref: undefined })),
          file: relative(dir, filePath),
          source: 'mongoose',
          description: '',
        });
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractOpenAPIRelationships(schemas) {
  const relationships = [];
  for (const schema of schemas) {
    for (const field of schema.fields) {
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
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

function walkDir(dir, callback) {
  if (!existsSync(dir)) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath, callback);
      } else if (entry.isFile() && /\.(js|mjs|cjs|ts|tsx|jsx|py)$/.test(entry.name)) {
        callback(fullPath);
      }
    }
  } catch { /* skip */ }
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
