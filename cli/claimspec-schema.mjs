/**
 * Vendored claimspec schemas and a dependency-free validator for them
 * (specs/057-ignore-reasons, FR-009).
 *
 * `schemas/claimspec/v1/{ignore,common}.schema.json` are byte-identical copies
 * of raccioly/testguard `spec/schemas/` at the revision below; the hashes are
 * asserted by tests/ignore-reasons.test.mjs. claimspec's own validator
 * (`spec/lib/validate.mjs`) imports Ajv, which DocGuard does not depend on
 * (Constitution II), so this module implements exactly the JSON Schema
 * keywords those documents use from the `ignore` root and THROWS on any other
 * keyword it reaches — a future copy that needs more fails loudly instead of
 * validating less than it says.
 *
 * Supported: type, required, properties, additionalProperties, items, const,
 * enum, minLength, maxLength (Unicode code points, as JSON Schema counts),
 * pattern (ECMA-262, `u` flag), $ref (`urn:claimspec:v1:<kind>#/json/pointer`).
 * Annotations ($schema, $id, $defs, title, description) are ignored.
 *
 * @implements docguard.ignore-reasons#FR-009
 */

import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

export const CLAIMSPEC_VENDOR = Object.freeze({
  source: 'https://github.com/raccioly/testguard/tree/379fb6a700168cf8a574da290ce5a807811f89e1/spec/schemas',
  revision: '379fb6a700168cf8a574da290ce5a807811f89e1',
  release: 'v0.18.3',
  sha256: Object.freeze({
    'ignore.schema.json': '47e0d260f0bdf1ddbf9e71e35eae9d4b398caac48631eb255efd6adbbce0d669',
    'common.schema.json': '73f737f5f3f6f16611c1e9963e3b8c761e7bc01b3cdf4f7774cf3c960a1849cb',
  }),
});

const SCHEMA_DIR = new URL('../schemas/claimspec/v1/', import.meta.url);
const ANNOTATIONS = new Set(['$schema', '$id', '$defs', 'title', 'description']);
const ASSERTIONS = new Set([
  'type', 'required', 'properties', 'additionalProperties', 'items', 'const', 'enum',
  'minLength', 'maxLength', 'pattern', '$ref',
]);

let vendored = null;
function registry() {
  if (!vendored) {
    vendored = new Map();
    for (const file of Object.keys(CLAIMSPEC_VENDOR.sha256)) {
      const schema = JSON.parse(readFileSync(new URL(file, SCHEMA_DIR), 'utf-8'));
      vendored.set(schema.$id, schema);
    }
  }
  return vendored;
}

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function typeMatches(type, value) {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: throw new Error(`unsupported JSON Schema type: ${type}`);
  }
}

function resolveRef(ref, base, schemas) {
  const [id, pointer = ''] = String(ref).split('#');
  const root = id ? schemas.get(id) : base;
  if (!root) throw new Error(`unresolvable $ref: ${ref}`);
  let node = root;
  for (const part of pointer.split('/').slice(1)) {
    node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) throw new Error(`unresolvable $ref: ${ref}`);
  }
  return { node, root };
}

function check(schema, value, path, base, schemas, errors) {
  for (const keyword of Object.keys(schema)) {
    if (!ANNOTATIONS.has(keyword) && !ASSERTIONS.has(keyword)) {
      throw new Error(`unsupported JSON Schema keyword: ${keyword}`);
    }
  }
  const fail = message => errors.push({ path: path || '/', message });
  if (schema.$ref) {
    const { node, root } = resolveRef(schema.$ref, base, schemas);
    check(node, value, path, root, schemas, errors);
  }
  if ('type' in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => typeMatches(t, value))) { fail(`must be ${types.join(' or ')}`); return; }
  }
  if ('const' in schema && !isDeepStrictEqual(value, schema.const)) fail(`must equal ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some(v => isDeepStrictEqual(v, value))) {
    fail(`must be one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (typeof schema.minLength === 'number' && length < schema.minLength) fail(`must be at least ${schema.minLength} characters`);
    if (typeof schema.maxLength === 'number' && length > schema.maxLength) fail(`must be at most ${schema.maxLength} characters`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) fail(`must match ${schema.pattern}`);
  }
  if (isObject(value)) {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) fail(`missing required property "${key}"`);
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) check(properties[key], child, `${path}/${key}`, base, schemas, errors);
      else if (schema.additionalProperties === false) fail(`unexpected property "${key}"`);
      else if (isObject(schema.additionalProperties)) check(schema.additionalProperties, child, `${path}/${key}`, base, schemas, errors);
    }
  }
  if (Array.isArray(value) && isObject(schema.items)) {
    value.forEach((item, i) => check(schema.items, item, `${path}/${i}`, base, schemas, errors));
  }
}

/**
 * Validate `value` against `schema`, resolving `$ref` ids through `schemas`
 * (a Map or plain object of `$id` → schema). Returns `[{ path, message }]`.
 * Throws on a keyword this validator does not implement.
 */
export function validateWithSchemas(schema, value, schemas = new Map()) {
  const map = schemas instanceof Map ? schemas : new Map(Object.entries(schemas));
  const errors = [];
  check(schema, value, '', schema, map, errors);
  return errors;
}

/** Validate a document against the vendored `urn:claimspec:v1:<kind>` schema. */
export function validateClaimspec(kind, document) {
  const schemas = registry();
  const schema = schemas.get(`urn:claimspec:v1:${kind}`);
  if (!schema) throw new RangeError(`no vendored claimspec schema for kind: ${kind}`);
  return validateWithSchemas(schema, document, schemas);
}

/** Throw unless `document` is a valid claimspec `kind` document. */
export function assertValidClaimspec(kind, document) {
  const errors = validateClaimspec(kind, document);
  if (errors.length) {
    throw new Error(`not a valid claimspec ${kind} document: ${errors.map(e => `${e.path} ${e.message}`).join('; ')}`);
  }
}
