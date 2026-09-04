import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { surfaceConfidence } from '../cli/writers/generate-io.mjs';

describe('surfaceConfidence', () => {
  it('returns normal for webapp, api, service', () => {
    assert.equal(surfaceConfidence('webapp'), 'normal');
    assert.equal(surfaceConfidence('api'), 'normal');
    assert.equal(surfaceConfidence('service'), 'normal');
  });
  it('returns low for others', () => {
    assert.equal(surfaceConfidence('cli'), 'low');
    assert.equal(surfaceConfidence('library'), 'low');
    assert.equal(surfaceConfidence('unknown'), 'low');
  });
});
