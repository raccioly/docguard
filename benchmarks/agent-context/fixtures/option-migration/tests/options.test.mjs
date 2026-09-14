import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTimeout } from '../src/options.mjs';

test('preserves modern option and default behavior', () => {
  assert.equal(resolveTimeout({ timeoutMs: 25 }), 25);
  assert.equal(resolveTimeout({ timeoutMs: 0 }), 0);
  assert.equal(resolveTimeout({}), 5000);
});
