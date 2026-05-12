
import { performance } from 'perf_hooks';
import { readFileSync, writeFileSync } from 'fs';

// We'll import the function from the file
// But since we want to measure it before and after, maybe we should just copy it here for baseline
// or just run it against the file itself.

import { scanSchemasDeep } from '../cli/scanners/schemas.mjs';

function generateLargeSchemas(count, fieldsPerSchema) {
  const schemas = [];
  for (let i = 0; i < count; i++) {
    const fields = [];
    for (let j = 0; j < fieldsPerSchema; j++) {
      // 50% chance it's a primitive, 50% chance it's a reference to another schema
      const isRef = Math.random() > 0.5;
      let type;
      if (isRef) {
        const targetIdx = Math.floor(Math.random() * count);
        type = `Schema${targetIdx}`;
        // Mix casing to test case-insensitivity
        if (Math.random() > 0.5) {
          type = type.toLowerCase();
        } else {
          type = type.toUpperCase();
        }
      } else {
        const primitives = ['string', 'number', 'boolean', 'integer'];
        type = primitives[Math.floor(Math.random() * primitives.length)];
      }
      fields.push({
        name: `field${j}`,
        type: type
      });
    }
    schemas.push({
      name: `Schema${i}`,
      fields: fields
    });
  }
  return schemas;
}

const SCHEMA_COUNT = 1000;
const FIELDS_PER_SCHEMA = 20;

console.log(`Generating ${SCHEMA_COUNT} schemas with ${FIELDS_PER_SCHEMA} fields each...`);
const schemas = generateLargeSchemas(SCHEMA_COUNT, FIELDS_PER_SCHEMA);

const docTools = {
  openapi: {
    found: true,
    schemas: schemas,
    path: 'openapi.yaml'
  }
};

console.log('Starting benchmark...');
const start = performance.now();
const result = scanSchemasDeep('.', {}, docTools);
const end = performance.now();

console.log(`Time taken: ${(end - start).toFixed(2)}ms`);
console.log(`Relationships found: ${result.relationships.length}`);
