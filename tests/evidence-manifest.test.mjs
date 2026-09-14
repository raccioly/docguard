import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVIDENCE_SCHEMA_URL, validateEvidenceManifest } from '../cli/evidence/manifest.mjs';

/**
 * @req docguard.evidence-scoped-verification#FR-001
 * @req docguard.evidence-scoped-verification#FR-002
 * @req docguard.evidence-scoped-verification#FR-007
 * @req docguard.evidence-scoped-verification#FR-013
 */

const base = () => JSON.parse(readFileSync(resolve('templates/evidence-manifest.json'), 'utf8'));

describe('evidence manifest contract', () => {
  it('accepts the shipped strict example', () => {
    const manifest = base();
    assert.equal(manifest.$schema, EVIDENCE_SCHEMA_URL);
    assert.deepEqual(validateEvidenceManifest(manifest), []);
  });

  it('rejects duplicate IDs, unknown keys, unsafe paths, and hidden applicability', () => {
    const manifest = base();
    manifest.surprise = true;
    manifest.declarations.push(structuredClone(manifest.declarations[0]));
    manifest.declarations[0].target.document = '.local/private.md';
    manifest.declarations[0].applicability.mode = 'when-convenient';
    const messages = validateEvidenceManifest(manifest).map(error => error.message).join('\n');
    assert.match(messages, /unknown field/);
    assert.match(messages, /Duplicate declaration ID/);
    assert.match(messages, /safe repository-relative Markdown path/);
    assert.match(messages, /applicability\.mode is unsupported/);
  });

  it('rejects incompatible adapter predicates and ambiguous statement slots', () => {
    const manifest = base();
    const declaration = manifest.declarations[0];
    declaration.predicate = { kind: 'no-findings' };
    declaration.target.statement = 'Retention is {{value}} and {{value}}.';
    const messages = validateEvidenceManifest(manifest).map(error => error.message).join('\n');
    assert.match(messages, /cannot contain \{\{value\}\}/);
    assert.match(messages, /json-pointer with an incompatible predicate/);
  });

  it('requires typed values and current input snapshots for external reports', () => {
    const manifest = base();
    manifest.declarations[0] = {
      id: 'api.compatibility', applicability: { mode: 'always' },
      target: { document: 'docs/api.md', heading: 'Compatibility', statement: 'No breaking changes were detected.' },
      source: { adapter: 'oasdiff', adapterVersion: 1, path: 'reports/oasdiff.json', producerVersion: '1.22.0', command: 'breaking', inputs: [] },
      predicate: { kind: 'no-findings' },
    };
    assert.match(validateEvidenceManifest(manifest).map(error => error.message).join('\n'), /inputs must contain 1-32/);
  });
});
