/**
 * Calibrated finding channels — the constructor contract.
 *
 * Three orthogonal channels on every Finding: `severity` (does CI block),
 * `disposition` (who decides), `evidence` (has this code ever been measured).
 * These tests pin the derivation rules, because every one of them is a place
 * where a silent coercion used to hide a wrong answer.
 *
 * @implements docguard.calibrated-finding-channels#FR-001
 * @implements docguard.calibrated-finding-channels#FR-002
 * @implements docguard.calibrated-finding-channels#FR-003
 * @implements docguard.calibrated-finding-channels#FR-004
 * @implements docguard.calibrated-finding-channels#FR-006
 * @implements docguard.calibrated-finding-channels#FR-009
 * @implements docguard.calibrated-finding-channels#FR-014
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkFinding, SUGGESTION_KINDS, DISPOSITIONS, PARSER_TIERS } from '../cli/findings.mjs';
import { isMeasured } from '../cli/precision-evidence.mjs';

// A code the reviewed corpus measures, and one it has never seen. If the
// corpus changes so that these no longer hold, these tests must be re-pinned
// deliberately rather than silently testing the wrong thing.
const MEASURED = 'SEC005';
const UNMEASURED = 'DQ007';

describe('finding channels — preconditions', () => {
  test('the codes these tests rely on still have the assumed measurement status', () => {
    assert.equal(isMeasured(MEASURED), true, `${MEASURED} must be measured for these tests to mean anything`);
    assert.equal(isMeasured(UNMEASURED), false, `${UNMEASURED} must be unmeasured for these tests to mean anything`);
  });
});

describe('disposition (FR-001, FR-002)', () => {
  test('derives act from fix/suppress and escalate from review/report', () => {
    for (const kind of ['fix', 'suppress']) {
      assert.equal(mkFinding({ code: MEASURED, suggestion: { kind, text: 't' } }).disposition, 'act', kind);
    }
    for (const kind of ['review', 'report']) {
      assert.equal(mkFinding({ code: MEASURED, suggestion: { kind, text: 't' } }).disposition, 'escalate', kind);
    }
  });

  test('fails closed to escalate when there is no valid suggestion', () => {
    // A finding DocGuard cannot say how to fix is one a human should look at.
    assert.equal(mkFinding({ code: MEASURED }).disposition, 'escalate');
    assert.equal(mkFinding({ code: MEASURED, suggestion: null }).disposition, 'escalate');
    assert.equal(mkFinding({ code: MEASURED, suggestion: { kind: 'fix', text: '  ' } }).disposition, 'escalate');
  });

  test('an explicit disposition wins over the derived one', () => {
    assert.equal(mkFinding({ code: MEASURED, disposition: 'act' }).disposition, 'act');
    assert.equal(mkFinding({ code: MEASURED, disposition: 'escalate', suggestion: { kind: 'fix', text: 't' } }).disposition, 'escalate');
  });

  test('an unrecognized disposition falls back to the derived value, never through', () => {
    assert.equal(mkFinding({ code: MEASURED, disposition: 'maybe', suggestion: { kind: 'fix', text: 't' } }).disposition, 'act');
    assert.equal(mkFinding({ code: MEASURED, disposition: 'maybe' }).disposition, 'escalate');
  });

  test('disposition is independent of severity and confidence', () => {
    // FRS002's shape: a blocking-severity, high-confidence observation whose
    // judgement still belongs to the reader.
    const f = mkFinding({ code: UNMEASURED, severity: 'error', confidence: 'high', suggestion: { kind: 'review', text: 't' } });
    assert.equal(f.severity, 'error');
    assert.equal(f.confidence, 'high');
    assert.equal(f.disposition, 'escalate');
  });
});

describe('suggestion kind (FR-003)', () => {
  test('a malformed kind omits the suggestion instead of coercing it to review', () => {
    // The old behaviour turned a typo into an escalation silently.
    const f = mkFinding({ code: MEASURED, suggestion: { kind: 'fxi', text: 'do the thing' } });
    assert.equal(f.suggestion, null);
    assert.equal(f.disposition, 'escalate');
  });

  test('a suggestion with text but no kind keeps the legacy review nudge', () => {
    const f = mkFinding({ code: MEASURED, suggestion: { text: 'have a look' } });
    assert.equal(f.suggestion.kind, 'review');
    assert.equal(f.disposition, 'escalate');
  });

  test('every supported kind survives, and command/pragma are preserved', () => {
    for (const kind of SUGGESTION_KINDS) {
      assert.equal(mkFinding({ code: MEASURED, suggestion: { kind, text: 't' } }).suggestion.kind, kind);
    }
    const withCmd = mkFinding({ code: MEASURED, suggestion: { kind: 'fix', text: 't', command: ' docguard fix ' } });
    assert.equal(withCmd.suggestion.command, 'docguard fix');
    const withPragma = mkFinding({ code: MEASURED, suggestion: { kind: 'suppress', text: 't', pragma: '// docguard:ignore SEC005' } });
    assert.equal(withPragma.suggestion.pragma, '// docguard:ignore SEC005');
  });
});

describe('evidence (FR-004)', () => {
  test('a measured code carries n and its Wilson interval', () => {
    const e = mkFinding({ code: MEASURED }).evidence;
    assert.equal(e.status, 'measured');
    assert.ok(Number.isInteger(e.n) && e.n > 0);
    assert.equal(Array.isArray(e.precisionInterval) || typeof e.precisionInterval === 'object', true);
  });

  test('an unmeasured code says so and carries no number', () => {
    const e = mkFinding({ code: UNMEASURED }).evidence;
    assert.equal(e.status, 'not-measured');
    assert.equal(e.n, undefined);
    assert.equal(e.precision, undefined);
  });

  test('an unknown or absent code is not-measured, never inherited', () => {
    assert.equal(mkFinding({ code: 'NOPE999' }).evidence.status, 'not-measured');
    assert.equal(mkFinding({}).evidence.status, 'not-measured');
  });

  test('a below-floor measured code reports no point estimate', () => {
    // quotable:false must not quote a rate on its own (precision-evidence-loop#FR-019).
    const f = mkFinding({ code: 'ARC001' });
    if (f.evidence.status === 'measured' && f.evidence.quotable === false) {
      assert.equal(f.evidence.precision, null);
    }
  });

  test('evidence objects are shared and frozen per code (no per-finding allocation)', () => {
    const a = mkFinding({ code: MEASURED });
    const b = mkFinding({ code: MEASURED });
    assert.equal(a.evidence, b.evidence, 'same code reuses one frozen evidence object');
    assert.equal(Object.isFrozen(a.evidence), true);
  });
});

describe('reportable (FR-014)', () => {
  test('an unmeasured code is reportable even at high confidence', () => {
    // This is the fix for the closed loop: the feedback channel used to sample
    // only findings the confidence label already doubted, so a confident label
    // on a never-measured code could never be challenged by default.
    assert.equal(mkFinding({ code: UNMEASURED, confidence: 'high' }).reportable, true);
  });

  test('a measured code at high confidence is NOT reportable by default', () => {
    assert.equal(mkFinding({ code: MEASURED, confidence: 'high' }).reportable, false);
  });

  test('low confidence is reportable regardless of measurement', () => {
    assert.equal(mkFinding({ code: MEASURED, confidence: 'low' }).reportable, true);
    assert.equal(mkFinding({ code: UNMEASURED, confidence: 'low' }).reportable, true);
  });

  test('an explicit reportable:true still wins', () => {
    assert.equal(mkFinding({ code: MEASURED, confidence: 'high', reportable: true }).reportable, true);
  });
});

describe('confidence coercion (unchanged contract)', () => {
  test("only the exact string 'low' means low; everything else is high", () => {
    assert.equal(mkFinding({ code: MEASURED, confidence: 'low' }).confidence, 'low');
    for (const v of ['high', 'medium', 'requires-human', 'review', '', null, undefined]) {
      assert.equal(mkFinding({ code: MEASURED, confidence: v }).confidence, 'high', String(v));
    }
  });
});

describe('location (FR-009)', () => {
  test('an object location is normalized to file:line', () => {
    assert.equal(mkFinding({ code: MEASURED, location: { file: 'API.md', line: 12 } }).location, 'API.md:12');
    assert.equal(mkFinding({ code: MEASURED, location: { file: 'API.md' } }).location, 'API.md');
    assert.equal(mkFinding({ code: MEASURED, location: { path: 'src/a.js', line: 3 } }).location, 'src/a.js:3');
  });

  test('a string location passes through and an empty or bad one becomes null', () => {
    assert.equal(mkFinding({ code: MEASURED, location: 'src/a.js:9' }).location, 'src/a.js:9');
    for (const v of ['', null, undefined, {}, { line: 4 }, 42]) {
      assert.equal(mkFinding({ code: MEASURED, location: v }).location, null, JSON.stringify(v));
    }
  });

  test('a non-positive or non-integer line is dropped rather than rendered', () => {
    assert.equal(mkFinding({ code: MEASURED, location: { file: 'a.md', line: 0 } }).location, 'a.md');
    assert.equal(mkFinding({ code: MEASURED, location: { file: 'a.md', line: 1.5 } }).location, 'a.md');
  });
});

describe('parserTier (FR-006)', () => {
  test('defaults to not-applicable and accepts only the benchmark vocabulary', () => {
    assert.equal(mkFinding({ code: MEASURED }).parserTier, 'not-applicable');
    for (const tier of PARSER_TIERS) {
      assert.equal(mkFinding({ code: MEASURED, parserTier: tier }).parserTier, tier);
    }
    for (const bad of ['ast', 'regex', '', null, 7]) {
      assert.equal(mkFinding({ code: MEASURED, parserTier: bad }).parserTier, 'not-applicable', String(bad));
    }
  });

  test('the vocabulary matches the benchmark and feedback schemas exactly', () => {
    assert.deepEqual([...PARSER_TIERS].sort(),
      ['fallback-language', 'js-ast', 'mixed', 'not-applicable', 'py-ast', 'regex-fallback']);
  });
});

describe('exported vocabularies', () => {
  test('are frozen so a consumer cannot mutate the contract', () => {
    for (const v of [SUGGESTION_KINDS, DISPOSITIONS, PARSER_TIERS]) assert.equal(Object.isFrozen(v), true);
    assert.deepEqual([...DISPOSITIONS], ['act', 'escalate']);
  });
});
