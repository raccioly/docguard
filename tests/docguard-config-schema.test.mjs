// @req docguard.adoption-workflow-integrity#FR-015
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schema = JSON.parse(readFileSync(resolve('schemas/docguard-config.schema.json'), 'utf8'));

describe('published DocGuard config schema', () => {
  it('declares every runtime validator key while rejecting unknown keys', () => {
    const guardSource = readFileSync(resolve('cli/commands/guard.mjs'), 'utf8');
    const mapStart = guardSource.indexOf('const validatorMap = [');
    const mapEnd = guardSource.indexOf('\n  ];\n\n  // Inline', mapStart);
    assert.ok(mapStart >= 0 && mapEnd > mapStart, 'runtime validator map should be discoverable');

    const runtimeKeys = new Set(
      [...guardSource.slice(mapStart, mapEnd).matchAll(/\{ key: '([^']+)'/g)].map(match => match[1])
    );
    runtimeKeys.add('canonicalSync');
    runtimeKeys.add('metricsConsistency');

    const validatorSchema = schema.properties.validators;
    assert.equal(validatorSchema.additionalProperties, false);
    assert.deepEqual(
      [...Object.keys(validatorSchema.properties).filter(key => !runtimeKeys.has(key))],
      [],
      'the schema should not advertise validators absent from the runtime'
    );
    assert.deepEqual(
      [...runtimeKeys].filter(key => !Object.hasOwn(validatorSchema.properties, key)),
      [],
      'every runtime validator must be accepted by the published schema'
    );
    for (const key of runtimeKeys) {
      assert.deepEqual(validatorSchema.properties[key], { type: 'boolean' }, `${key} must accept a boolean`);
    }
  });

  it('accepts the three default-on review validators', () => {
    const properties = schema.properties.validators.properties;
    for (const key of ['diffSuspicion', 'referenceExistence', 'apiDocSmells']) {
      assert.deepEqual(properties[key], { type: 'boolean' });
    }
  });
});
