import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  normalizePath,
  endpointKey,
  parseApiReferenceDoc,
  compareEndpoints,
} from '../cli/scanners/api-doc.mjs';

describe('api-doc: normalizePath', () => {
  it('unifies :param and {param} to a single placeholder', () => {
    assert.equal(normalizePath('/api/users/:id'), '/api/users/{}');
    assert.equal(normalizePath('/api/users/{id}'), '/api/users/{}');
    assert.equal(normalizePath('/api/users/:id'), normalizePath('/api/users/{userId}'));
  });

  it('strips backticks, table pipes, and trailing slashes', () => {
    assert.equal(normalizePath('`/api/users/`'), '/api/users');
    assert.equal(normalizePath('| /api/users |'), '/api/users');
    assert.equal(normalizePath('/api/users?foo=bar'), '/api/users');
  });

  it('returns empty string for non-paths', () => {
    assert.equal(normalizePath('not a path'), '');
    assert.equal(normalizePath(''), '');
  });

  it('endpointKey upper-cases the method', () => {
    assert.equal(endpointKey('get', '/api/x'), 'GET /api/x');
  });
});

describe('api-doc: parseApiReferenceDoc', () => {
  it('extracts endpoints from "#### METHOD `/path`" headings', () => {
    const md = [
      '#### GET `/api/admin/users`',
      'some prose',
      '#### POST `/api/admin/users/{id}`',
    ].join('\n');
    const eps = parseApiReferenceDoc(md);
    const keys = eps.map(e => e.key).sort();
    assert.deepEqual(keys, ['GET /api/admin/users', 'POST /api/admin/users/{}']);
  });

  it('extracts endpoints from markdown table rows', () => {
    const md = [
      '| Method | Path | Auth |',
      '|--------|------|------|',
      '| `GET` | `/api/admin/observability/xray` | 🔓 |',
      '| `DELETE` | `/api/admin/users/:id` | 🔒 |',
    ].join('\n');
    const eps = parseApiReferenceDoc(md);
    const keys = eps.map(e => e.key).sort();
    assert.deepEqual(keys, ['DELETE /api/admin/users/{}', 'GET /api/admin/observability/xray']);
  });

  it('does NOT emit garbage tokens from table separators', () => {
    const md = [
      '| Method | Path |',
      '|--------|------|',
      '| `GET` | `/api/x` |',
    ].join('\n');
    const eps = parseApiReferenceDoc(md);
    // only the real route, no "/api/`" / "|---" garbage
    assert.equal(eps.length, 1);
    assert.equal(eps[0].path, '/api/x');
  });

  it('deduplicates identical endpoints across heading + table', () => {
    const md = [
      '| `GET` | `/api/x` |',
      '#### GET `/api/x`',
    ].join('\n');
    assert.equal(parseApiReferenceDoc(md).length, 1);
  });
});

describe('api-doc: compareEndpoints', () => {
  it('classifies documented-but-absent, present-but-undocumented, matched', () => {
    const documented = parseApiReferenceDoc([
      '#### GET `/api/keep`',
      '#### GET `/api/stale`',
    ].join('\n'));
    const actual = [
      { method: 'GET', path: '/api/keep' },
      { method: 'GET', path: '/api/new' },
    ];
    const r = compareEndpoints(documented, actual);
    const k = (e) => endpointKey(e.method, e.path);
    assert.deepEqual(r.documentedButAbsent.map(k), ['GET /api/stale']);
    assert.deepEqual(r.presentButUndocumented.map(k), ['GET /api/new']);
    assert.deepEqual(r.matched.map(k), ['GET /api/keep']);
  });

  it('treats :id and {id} as the same endpoint (no false drift)', () => {
    const documented = parseApiReferenceDoc('#### GET `/api/users/{id}`');
    const actual = [{ method: 'GET', path: '/api/users/:id' }];
    const r = compareEndpoints(documented, actual);
    assert.equal(r.matched.length, 1);
    assert.equal(r.documentedButAbsent.length, 0);
  });
});
