/**
 * Every document parser survives any input, quickly and deterministically
 * (specs/088-validator-fuzz). A fixed seed and budget here; `npm run fuzz`
 * runs deep.
 *
 * @req docguard.validator-fuzz#FR-001
 * @req docguard.validator-fuzz#FR-002
 * @req docguard.validator-fuzz#FR-003
 * @req docguard.validator-fuzz#FR-004
 * @req docguard.validator-fuzz#SC-001
 * @req docguard.validator-fuzz#SC-003
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TARGETS, budgetMs, check, fuzz, generate, pathological, rng, shrink } from '../tools/fuzz.mjs';
import { REF_TEXT_MAX, backtickRefs } from '../cli/scanners/aidlc.mjs';
import { stripHtmlComments } from '../cli/shared-html-comments.mjs';

const FIXTURES = resolve('tests/fixtures/fuzz');

describe('US1 — every parser, fixed seed', () => {
  it('200 generated documents and the pathological set: no throw, same answer twice, linear time', () => {
    const start = performance.now();
    const failures = fuzz({ seed: 20261103, cases: 200 });
    assert.ok(performance.now() - start < 5000, 'the fixed-seed run stays under 5 seconds (SC-003)');
    assert.deepEqual(failures.map(f => `${f.target} ${f.kind} (${f.index}): ${f.detail}`), []);
  });

  it('the same seed gives the same documents', () => {
    const a = rng(7); const b = rng(7);
    for (let i = 0; i < 20; i++) assert.equal(generate(a), generate(b));
  });

  it('every parser is reached by part of the corpus, so a pass is not vacuous', () => {
    const r = rng(11);
    const docs = Array.from({ length: 600 }, () => generate(r));
    const size = v => (v == null ? 0 : Array.isArray(v) ? v.length : v instanceof Map || v instanceof Set ? v.size
      : typeof v === 'object' ? Object.values(v).reduce((n, x) => n + size(x), 0) : v ? 1 : 0);
    for (const t of TARGETS) {
      const reached = docs.filter(d => size(t.run(d)) > 0).length;
      assert.ok(reached >= 6, `${t.name} returned something for only ${reached} of ${docs.length} documents`);
    }
  });
});

describe('US1 — the harness can fail', () => {
  const docs = (() => { const r = rng(3); return Array.from({ length: 50 }, () => generate(r)); })();
  const firstFailure = target => { for (const d of docs) { const f = check(target, d); if (f) return f.kind; } return null; };

  it('reports a throw, a varying answer and a call over its time budget', () => {
    assert.equal(firstFailure({ name: 'throws', run: t => { if (t.length >= 0) throw new Error('boom'); } }), 'throws');
    assert.equal(firstFailure({ name: 'varies', run: () => [Math.random()] }), 'nondeterministic');
    // Stands in for catastrophic backtracking: just over the input's budget.
    const spin = ms => { const end = performance.now() + ms; while (performance.now() < end); return []; };
    assert.equal(firstFailure({ name: 'slow', run: t => spin(budgetMs(t) + 50) }), 'slow');
  });

  it('shrinks a failing input to the lines that make it fail', () => {
    const target = { name: 'needs-marker', run: t => { if (t.includes('MARK')) throw new Error('x'); return []; } };
    const input = ['a', 'b', 'MARK', 'c', 'd', 'e'].join('\n');
    assert.equal(shrink(target, input, 'throws'), 'MARK');
  });
});

describe('FR-004 — what the harness found stays fixed', () => {
  it('stripHtmlComments reads a long line of many comments in linear time', () => {
    const line = pathological()['many comments on one line'];
    const start = performance.now();
    const out = stripHtmlComments(line, false);
    assert.ok(performance.now() - start < 500, 'quadratic re-masking is back');
    assert.equal(out.text, 'x'.repeat(2500));
  });

  it('backtickRefs output is linear in its input: one line of many tokens is not copied per token (issue 693)', () => {
    // The seed-7 crash (0a74c26, case 617) shrank to one 318,780-character line holding 3,795 tokens; this is a
    // small model of it: one line, many tokens.
    const refs = backtickRefs('`ab` `cd`');
    assert.deepEqual(refs.map(r => [r.token, r.line, r.text]), [['ab', 1, '`ab` `cd`'], ['cd', 1, '`ab` `cd`']]);
    const sizes = [1000, 4000, 16000].map(n => {
      const line = 'x `ab` '.repeat(n);
      const out = backtickRefs(line);
      assert.equal(out.length, n);
      assert.ok(out.every(r => r.text.length <= REF_TEXT_MAX));
      return JSON.stringify(out).length / line.length;
    });
    // Quadratic output would multiply this ratio by the 16x growth in input.
    assert.ok(sizes[2] < sizes[0] * 1.5, `output per input character grew: ${sizes.join(', ')}`);
  });

  it('the harness reports a result too large to serialize instead of crashing', () => {
    // The serializer's own error, raised cheaply: no 256 MB strings in the suite.
    const target = { name: 'huge', run: () => ({ toJSON() { throw new RangeError('Invalid string length'); } }) };
    assert.equal(check(target, 'a')?.kind, 'oversized');
  });

  it('replays every saved fixture against its parser', () => {
    if (!existsSync(FIXTURES)) return;
    for (const file of readdirSync(FIXTURES).filter(f => f.endsWith('.txt'))) {
      const target = TARGETS.find(t => file.startsWith(`${t.name}-`));
      assert.ok(target, `${file} names no parser`);
      assert.equal(check(target, readFileSync(join(FIXTURES, file), 'utf8')), null, file);
    }
  });
});
