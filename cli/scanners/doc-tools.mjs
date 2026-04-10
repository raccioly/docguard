/**
 * Doc Tool Detection Scanner
 * Detects existing documentation tools in a project (OpenAPI, TypeDoc, JSDoc, Storybook, etc.)
 * and extracts available data from their outputs.
 * 
 * Philosophy: Detect and leverage, never replace.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Detect all documentation tools present in the project.
 * @param {string} dir - Project root directory
 * @returns {object} Detected tools with their config and extracted data
 */
export async function detectDocTools(dir) {
  const tools = {
    openapi: detectOpenAPI(dir),
    typedoc: detectTypeDoc(dir),
    jsdoc: detectJSDoc(dir),
    storybook: detectStorybook(dir),
    docusaurus: detectDocusaurus(dir),
    mintlify: detectMintlify(dir),
    redocly: detectRedocly(dir),
    swagger: detectSwagger(dir),
  };

  // Count detected tools
  tools._detected = Object.entries(tools)
    .filter(([k, v]) => k !== '_detected' && v.found)
    .map(([k]) => k);

  return tools;
}

// ── OpenAPI / Swagger Spec ─────────────────────────────────────────────────

function detectOpenAPI(dir) {
  const candidates = [
    'openapi.yaml', 'openapi.yml', 'openapi.json',
    'swagger.yaml', 'swagger.yml', 'swagger.json',
    'api/openapi.yaml', 'api/openapi.yml', 'api/openapi.json',
    'docs/openapi.yaml', 'docs/openapi.yml',
    'spec/openapi.yaml', 'spec/openapi.yml',
  ];

  for (const candidate of candidates) {
    const fullPath = resolve(dir, candidate);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, 'utf-8');
      const spec = parseOpenAPISpec(content, candidate);
      return {
        found: true,
        path: candidate,
        version: spec.version,
        endpoints: spec.endpoints,
        schemas: spec.schemas,
        info: spec.info,
      };
    }
  }

  return { found: false };
}

function parseOpenAPISpec(content, filename) {
  const result = { version: null, endpoints: [], schemas: [], info: {} };

  try {
    let spec;
    if (filename.endsWith('.json')) {
      spec = JSON.parse(content);
    } else {
      // Simple YAML parsing for common patterns (no dependency)
      spec = parseSimpleYAML(content);
    }

    // Version
    result.version = spec.openapi || spec.swagger || 'unknown';

    // Info
    result.info = {
      title: spec.info?.title || '',
      description: spec.info?.description || '',
      version: spec.info?.version || '',
    };

    // Endpoints
    if (spec.paths) {
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const [method, details] of Object.entries(methods)) {
          if (['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(method)) {
            result.endpoints.push({
              method: method.toUpperCase(),
              path,
              summary: details?.summary || details?.description || '',
              tags: details?.tags || [],
              operationId: details?.operationId || '',
              auth: !!(details?.security?.length),
            });
          }
        }
      }
    }

    // Schemas
    const schemas = spec.components?.schemas || spec.definitions || {};
    for (const [name, schema] of Object.entries(schemas)) {
      const fields = [];
      if (schema.properties) {
        for (const [fieldName, fieldDef] of Object.entries(schema.properties)) {
          fields.push({
            name: fieldName,
            type: fieldDef.type || fieldDef.$ref?.split('/').pop() || 'object',
            required: (schema.required || []).includes(fieldName),
            description: fieldDef.description || '',
          });
        }
      }
      result.schemas.push({ name, fields, description: schema.description || '' });
    }
  } catch { /* spec parsing failed, return empty */ }

  return result;
}

/**
 * Minimal YAML parser for OpenAPI specs.
 * Handles the most common structures without external dependencies.
 * NOT a full YAML parser — covers 80% of real-world OpenAPI files.
 */
function parseSimpleYAML(content) {
  // Try JSON first (some .yaml files are actually JSON)
  try { return JSON.parse(content); } catch { /* not JSON */ }

  const result = {};
  const lines = content.split('\n');
  const stack = [{ obj: result, indent: -1 }];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Pop stack to find parent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].obj;

    // Array item
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim();
      if (Array.isArray(parent)) {
        if (value.includes(':')) {
          const obj = {};
          const [k, ...rest] = value.split(':');
          obj[k.trim()] = rest.join(':').trim().replace(/^['"]|['"]$/g, '');
          parent.push(obj);
          stack.push({ obj, indent });
        } else {
          parent.push(value.replace(/^['"]|['"]$/g, ''));
        }
      }
      continue;
    }

    // Key-value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.substring(0, colonIdx).trim();
      const rawVal = trimmed.substring(colonIdx + 1).trim();

      if (rawVal === '' || rawVal === '|' || rawVal === '>') {
        // Nested object or block
        const child = {};
        if (typeof parent === 'object' && !Array.isArray(parent)) {
          parent[key] = child;
        }
        stack.push({ obj: child, indent });
      } else if (rawVal.startsWith('[')) {
        // Inline array
        try {
          parent[key] = JSON.parse(rawVal);
        } catch {
          parent[key] = rawVal;
        }
      } else {
        // Simple value
        let val = rawVal.replace(/^['"]|['"]$/g, '');
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (/^\d+$/.test(val)) val = parseInt(val);
        if (typeof parent === 'object' && !Array.isArray(parent)) {
          parent[key] = val;
        }
      }
    }
  }

  return result;
}

// ── TypeDoc ────────────────────────────────────────────────────────────────

function detectTypeDoc(dir) {
  const configs = ['typedoc.json', 'typedoc.config.js', 'typedoc.config.mjs'];
  for (const config of configs) {
    if (existsSync(resolve(dir, config))) {
      return { found: true, config };
    }
  }

  // Check package.json devDeps
  const pkgPath = resolve(dir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (pkg.devDependencies?.typedoc) {
      return { found: true, config: 'package.json (devDependency)' };
    }
  }

  return { found: false };
}

// ── JSDoc ──────────────────────────────────────────────────────────────────

function detectJSDoc(dir) {
  const configs = ['jsdoc.json', '.jsdoc.json', 'jsdoc.conf.json'];
  for (const config of configs) {
    if (existsSync(resolve(dir, config))) {
      return { found: true, config };
    }
  }

  const pkgPath = resolve(dir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    if (pkg.devDependencies?.jsdoc) {
      return { found: true, config: 'package.json (devDependency)' };
    }
  }

  return { found: false };
}

// ── Storybook ──────────────────────────────────────────────────────────────

function detectStorybook(dir) {
  if (existsSync(resolve(dir, '.storybook'))) {
    // Count stories
    let storyCount = 0;
    const storyDirs = ['src', 'components', 'stories'];
    for (const sd of storyDirs) {
      const fullDir = resolve(dir, sd);
      if (existsSync(fullDir)) {
        storyCount += countFiles(fullDir, /\.(stories|story)\.(js|jsx|ts|tsx|mdx)$/);
      }
    }
    return { found: true, config: '.storybook/', storyCount };
  }

  return { found: false };
}

// ── Docusaurus ─────────────────────────────────────────────────────────────

function detectDocusaurus(dir) {
  const configs = ['docusaurus.config.js', 'docusaurus.config.ts', 'docusaurus.config.mjs'];
  for (const config of configs) {
    if (existsSync(resolve(dir, config))) {
      return { found: true, config };
    }
  }
  return { found: false };
}

// ── Mintlify ───────────────────────────────────────────────────────────────

function detectMintlify(dir) {
  // Check for docs.json (new) or mint.json (legacy)
  for (const config of ['docs.json', 'mint.json']) {
    const fullPath = resolve(dir, config);
    if (existsSync(fullPath)) {
      try {
        const content = JSON.parse(readFileSync(fullPath, 'utf-8'));
        return {
          found: true,
          config,
          name: content.name || '',
          version: config === 'docs.json' ? 'v2' : 'v1',
        };
      } catch {
        return { found: true, config };
      }
    }
  }
  return { found: false };
}

// ── Redocly ────────────────────────────────────────────────────────────────

function detectRedocly(dir) {
  const configs = ['redocly.yaml', 'redocly.yml', '.redocly.yaml', '.redocly.yml'];
  for (const config of configs) {
    if (existsSync(resolve(dir, config))) {
      return { found: true, config };
    }
  }
  return { found: false };
}

// ── Swagger UI ─────────────────────────────────────────────────────────────

function detectSwagger(dir) {
  const pkgPath = resolve(dir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (allDeps['swagger-ui-express'] || allDeps['@fastify/swagger'] || allDeps['swagger-jsdoc']) {
      return {
        found: true,
        middleware: allDeps['swagger-ui-express'] ? 'swagger-ui-express' :
          allDeps['@fastify/swagger'] ? '@fastify/swagger' : 'swagger-jsdoc',
      };
    }
  }
  return { found: false };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function countFiles(dir, pattern) {
  let count = 0;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countFiles(fullPath, pattern);
      } else if (pattern.test(entry.name)) {
        count++;
      }
    }
  } catch { /* skip */ }
  return count;
}
