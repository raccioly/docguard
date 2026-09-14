import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus } from '../src/status.mjs';

test('preserves canonical statuses and existing invalid behavior', () => {
  assert.equal(normalizeStatus('READY'), 'READY');
  assert.equal(normalizeStatus('IN_PROGRESS'), 'IN_PROGRESS');
  assert.equal(normalizeStatus('missing'), null);
  assert.equal(normalizeStatus(null), null);
});
