import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { classifyResult } from '../cli/commands/guard.mjs';

describe('guard classifyResult — N/A vs pass', () => {
  it('classifies an empty result (total 0, no findings) as N/A, NOT pass', () => {
    const r = classifyResult({ errors: [], warnings: [], passed: 0, total: 0 });
    assert.equal(r.status, 'na');
    assert.equal(r.quality, null);
  });

  it('respects an explicit applicable:false even when total > 0', () => {
    const r = classifyResult({ errors: [], warnings: [], passed: 3, total: 3, applicable: false });
    assert.equal(r.status, 'na');
  });

  it('classifies a real clean check as a HIGH pass', () => {
    const r = classifyResult({ errors: [], warnings: [], passed: 10, total: 10 });
    assert.equal(r.status, 'pass');
    assert.equal(r.quality, 'HIGH');
  });

  it('classifies a partial pass (<90%) as MEDIUM', () => {
    const r = classifyResult({ errors: [], warnings: [], passed: 5, total: 10 });
    assert.equal(r.status, 'pass');
    assert.equal(r.quality, 'MEDIUM');
  });

  it('warnings → warn/MEDIUM even when total is 0', () => {
    const r = classifyResult({ errors: [], warnings: ['something'], passed: 0, total: 0 });
    assert.equal(r.status, 'warn');
    assert.equal(r.quality, 'MEDIUM');
  });

  it('errors → fail/LOW', () => {
    const r = classifyResult({ errors: ['boom'], warnings: [], passed: 0, total: 1 });
    assert.equal(r.status, 'fail');
    assert.equal(r.quality, 'LOW');
  });
});
