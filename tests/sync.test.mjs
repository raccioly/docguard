import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runSync } from '../cli/commands/sync.mjs';

// Silence command console output during tests.
function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

function openapi(paths) {
  const lines = ['openapi: 3.0.3', 'info:', '  title: t', '  version: 1.0.0', 'paths:'];
  for (const [p, methods] of Object.entries(paths)) {
    lines.push(`  ${p}:`);
    for (const m of methods) { lines.push(`    ${m}:`); lines.push(`      summary: ${m} ${p}`); }
  }
  return lines.join('\n');
}

const config = { projectName: 'svc' };

describe('docguard sync', () => {
  let dir;
  const write = (rel, content) => {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  };
  const read = (rel) => readFileSync(join(dir, rel), 'utf-8');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-sync-'));
    write('package.json', JSON.stringify({ dependencies: { express: '^4' } }));
    // Spec currently has TWO endpoints.
    write('docs/openapi.yaml', openapi({ '/api/users': ['get'], '/api/orders': ['post'] }));
    // Generated doc whose endpoints section is STALE (only /api/users) and has human prose.
    write('docs-canonical/API-REFERENCE.md', [
      '# API Reference',
      '',
      '<!-- docguard:generated true -->',
      '',
      '<!-- docguard:section id=endpoints source=code -->',
      '| Method | Path | Auth |',
      '| --- | --- | --- |',
      '| `GET` | `/api/users` | 🔓 |',
      '<!-- /docguard:section -->',
      '',
      '<!-- docguard:section id=overview source=human -->',
      'Hand-written overview — must survive.',
      '<!-- /docguard:section -->',
      '',
    ].join('\n'));
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('refreshes a stale code section in place with --write, preserving human prose', () => {
    quiet(() => runSync(dir, config, { write: true }));
    const doc = read('docs-canonical/API-REFERENCE.md');
    assert.ok(doc.includes('/api/orders'), 'new endpoint synced into the doc');
    assert.ok(doc.includes('/api/users'), 'existing endpoint kept');
    assert.ok(doc.includes('Hand-written overview — must survive.'), 'human prose preserved');
  });

  it('is idempotent — a second sync makes no changes', () => {
    quiet(() => runSync(dir, config, { write: true }));
    const after1 = read('docs-canonical/API-REFERENCE.md');
    quiet(() => runSync(dir, config, { write: true }));
    const after2 = read('docs-canonical/API-REFERENCE.md');
    assert.equal(after1, after2);
  });

  it('dry run (no --write) does not modify the doc', () => {
    const before = read('docs-canonical/API-REFERENCE.md');
    quiet(() => runSync(dir, config, {}));
    assert.equal(read('docs-canonical/API-REFERENCE.md'), before);
  });

  it('skips a doc without the generated marker unless --force', () => {
    // Strip the generated marker.
    const f = 'docs-canonical/API-REFERENCE.md';
    write(f, read(f).replace('<!-- docguard:generated true -->', ''));
    const before = read(f);
    quiet(() => runSync(dir, config, { write: true }));
    assert.equal(read(f), before, 'unmarked doc untouched');
    quiet(() => runSync(dir, config, { write: true, force: true }));
    assert.ok(read(f).includes('/api/orders'), '--force syncs it');
  });

  it('JSON output reports stale updates and prose reviews', () => {
    let out = '';
    const log = console.log;
    console.log = (s) => { out += s; };
    try { runSync(dir, config, { format: 'json' }); } finally { console.log = log; }
    const j = JSON.parse(out);
    assert.ok(j.updates.some(u => u.section === 'endpoints'));
    assert.ok(j.reviews.some(r => r.section === 'overview'));
    assert.equal(j.applied, false);
  });
});
