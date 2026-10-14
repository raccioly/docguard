import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adjudicatedForCode, describeAdjudications, PRECISION_EVIDENCE } from '../cli/precision-evidence.mjs';

describe('adjudicatedForCode', () => {
  it('returns zeros for an unknown code', () => {
    assert.deepEqual(adjudicatedForCode('UNKNOWN_999'), { policyDisagreements: 0, ambiguous: 0 });
  });

  it('returns zeros for a measured code with no adjudications', () => {
    assert.deepEqual(adjudicatedForCode('ARC001'), { policyDisagreements: 0, ambiguous: 0 });
  });
});

describe('describeAdjudications', () => {
  it('returns null when there are no adjudications', () => {
    assert.equal(describeAdjudications('UNKNOWN_999'), null);
    assert.equal(describeAdjudications('ARC001'), null);
  });

  it('formats policy disagreements and ambiguous cases correctly', () => {
    // We can inject a mock case into PRECISION_EVIDENCE since it's just an object in memory
    // but the default export might be frozen. Let's see if we can just mutate or mock.
    // Actually, PRECISION_EVIDENCE.byCode is exported and might not be deeply frozen.
    PRECISION_EVIDENCE.byCode['MOCK001'] = {
      status: 'measured',
      adjudicated: { policyDisagreements: 2, ambiguous: 3 }
    };
    try {
      assert.equal(
        describeAdjudications('MOCK001'),
        '2 reviewed policy disagreement(s) and 3 case(s) the maintainers could not adjudicate on record for this code; counted separately and excluded from every rate above.'
      );
    } finally {
      delete PRECISION_EVIDENCE.byCode['MOCK001'];
    }
  });

  it('formats only policy disagreements', () => {
    PRECISION_EVIDENCE.byCode['MOCK002'] = {
      status: 'measured',
      adjudicated: { policyDisagreements: 1, ambiguous: 0 }
    };
    try {
      assert.equal(
        describeAdjudications('MOCK002'),
        '1 reviewed policy disagreement(s) on record for this code; counted separately and excluded from every rate above.'
      );
    } finally {
      delete PRECISION_EVIDENCE.byCode['MOCK002'];
    }
  });

  it('formats only ambiguous cases', () => {
    PRECISION_EVIDENCE.byCode['MOCK003'] = {
      status: 'measured',
      adjudicated: { policyDisagreements: 0, ambiguous: 4 }
    };
    try {
      assert.equal(
        describeAdjudications('MOCK003'),
        '4 case(s) the maintainers could not adjudicate on record for this code; counted separately and excluded from every rate above.'
      );
    } finally {
      delete PRECISION_EVIDENCE.byCode['MOCK003'];
    }
  });
});
