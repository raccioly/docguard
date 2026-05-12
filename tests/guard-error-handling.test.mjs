import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { runGuardInternal } from '../cli/commands/guard.mjs';

describe('runGuardInternal error handling', () => {
  it('handles errors in individual validators', () => {
    // Passing a config that will cause validateStructure to crash
    // Structure validator accesses config.requiredFiles.canonical
    const config = {
      projectName: 'Test',
      validators: { structure: true },
      requiredFiles: null
    };

    const results = runGuardInternal('.', config);

    const structureResult = results.validators.find(v => v.key === 'structure');
    assert.ok(structureResult, 'Structure validator result should exist');
    assert.equal(structureResult.status, 'fail');
    assert.equal(structureResult.quality, 'LOW');
    assert.ok(structureResult.errors.length > 0);
    // Error message should mention 'canonical'
    assert.match(structureResult.errors[0], /canonical/);
  });

  it('handles errors in metricsConsistency validator (post-loop)', () => {
    // validateMetricsConsistency is called after the main loop.
    // It calls loadIgnorePatterns(projectDir), which calls resolve(projectDir, '.docguardignore')
    // If projectDir is null, resolve throws TypeError.

    const config = {
      projectName: 'TestProject',
      validators: {
        structure: false,
        docsSync: false,
        drift: false,
        changelog: false,
        testSpec: false,
        environment: false,
        security: false,
        architecture: false,
        freshness: false,
        traceability: false,
        docsDiff: false,
        metadataSync: false,
        docsCoverage: false,
        docQuality: false,
        todoTracking: false,
        schemaSync: false,
        specKit: false,
        metricsConsistency: true
      }
    };

    // We expect runGuardInternal to catch the error from validateMetricsConsistency
    const results = runGuardInternal(null, config);

    const metricsResult = results.validators.find(v => v.key === 'metricsConsistency');
    assert.ok(metricsResult, 'Metrics-Consistency validator result should exist');
    assert.equal(metricsResult.status, 'fail');
    assert.equal(metricsResult.quality, 'LOW');
    assert.ok(metricsResult.errors.length > 0);
  });
});
