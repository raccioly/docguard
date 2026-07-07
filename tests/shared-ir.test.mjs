import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { termFreq, buildIdf, tfidfVector, cosineSimilarity, rankBySimilarity } from '../cli/shared-ir.mjs';
import { tokenize } from '../cli/shared-diff.mjs';

describe('termFreq', () => {
  it('counts tokens', () => {
    const tf = termFreq(['a', 'b', 'a']);
    assert.equal(tf.get('a'), 2);
    assert.equal(tf.get('b'), 1);
  });
});

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    const idf = buildIdf([['x', 'y'], ['x', 'z']]);
    const v = tfidfVector(['x', 'y'], idf);
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9);
  });
  it('is 0 for disjoint vectors', () => {
    const idf = buildIdf([['a', 'b'], ['c', 'd']]);
    const va = tfidfVector(['a', 'b'], idf);
    const vc = tfidfVector(['c', 'd'], idf);
    assert.equal(cosineSimilarity(va, vc), 0);
  });
  it('empty vector → 0', () => {
    assert.equal(cosineSimilarity(new Map(), new Map([['x', 1]])), 0);
  });
});

describe('rankBySimilarity', () => {
  it('ranks the topically-closest candidate first', () => {
    const query = tokenize('user authentication login with password validation');
    const candidates = [
      { id: 'auth.test', tokens: tokenize('test that login validates the user password and authentication token') },
      { id: 'billing.test', tokens: tokenize('invoice totals and payment refund calculations for subscriptions') },
      { id: 'utils.test', tokens: tokenize('string formatting and date helpers') },
    ];
    const ranked = rankBySimilarity(query, candidates);
    assert.equal(ranked[0].id, 'auth.test', `expected auth.test first; got ${JSON.stringify(ranked)}`);
    assert.ok(ranked[0].score > ranked[1].score);
  });

  it('gives near-zero to a totally unrelated requirement', () => {
    const query = tokenize('quantum chromodynamics lattice gauge simulation');
    const candidates = [{ id: 'auth', tokens: tokenize('login password user session cookie') }];
    const ranked = rankBySimilarity(query, candidates);
    assert.ok(ranked[0].score < 0.1, `expected near-zero; got ${ranked[0].score}`);
  });
});
