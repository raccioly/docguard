import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { toSarif } from '../cli/writers/sarif.mjs';
import { mkFinding } from '../cli/findings.mjs';
import { CODES } from '../cli/findings.mjs';

const CLI = new URL('../cli/docguard.mjs', import.meta.url).pathname;

describe('SARIF writer — toSarif()', () => {
  const guardData = {
    status: 'WARN',
    effectiveErrors: 0,
    effectiveWarnings: 2,
    findings: [
      {
        code: 'STR001', validator: 'structure', severity: 'error',
        effectiveSeverity: 'info', enforcement: { level: 'info', source: 'finding', key: 'STR001' },
        message: 'docs-canonical/ARCHITECTURE.md is required but missing',
        location: 'docs-canonical/ARCHITECTURE.md',
        suggestion: { kind: 'fix', text: 'Create it from the template', command: 'docguard init' },
      },
      {
        code: 'ZZZ999', validator: 'imaginary', severity: 'warn', confidence: 'low', reportable: true,
        message: 'a finding whose code is not in the registry',
        location: 'src/app.js:42',
        suggestion: null,
      },
      {
        // Same code twice — rules[] must dedup while results[] keeps both.
        code: 'STR001', validator: 'structure', severity: 'error',
        message: 'docs-canonical/SECURITY.md is required but missing',
        location: 'docs-canonical/SECURITY.md',
        suggestion: null,
      },
    ],
    validators: [],
  };

  it('emits a schema-valid top-level shape', () => {
    const sarif = toSarif(guardData, { projectDir: '/tmp/proj' });
    assert.ok(sarif.$schema.includes('sarif-schema-2.1.0'));
    assert.equal(sarif.version, '2.1.0');
    assert.equal(sarif.runs.length, 1);
    assert.equal(sarif.runs[0].tool.driver.name, 'DocGuard');
    assert.ok(sarif.runs[0].tool.driver.version.match(/^\d+\.\d+\.\d+/));
    assert.equal(sarif.runs[0].originalUriBaseIds.SRCROOT.uri, 'file:///tmp/proj/');
  });

  it('dedups rules by code and wires ruleIndex; registry codes carry title/help', () => {
    const sarif = toSarif(guardData);
    const rules = sarif.runs[0].rules ?? sarif.runs[0].tool.driver.rules;
    assert.equal(rules.length, 2, 'STR001 appears twice but yields one rule');
    const str = rules.find(r => r.id === 'STR001');
    assert.equal(str.shortDescription.text, CODES.STR001.title);
    assert.equal(str.fullDescription.text, CODES.STR001.help);
    const zzz = rules.find(r => r.id === 'ZZZ999');
    assert.ok(zzz, 'unknown code still gets a rule');
    assert.equal(zzz.shortDescription, undefined, 'no registry metadata for unknown code');
    const results = sarif.runs[0].results;
    assert.equal(results.length, 3);
    for (const res of results) {
      assert.equal(rules[res.ruleIndex].id, res.ruleId, 'ruleIndex must point at its own rule');
    }
  });

  it('maps severity→level, path:line→region, suggestion→message suffix, low confidence→properties', () => {
    const sarif = toSarif(guardData);
    const [a, b] = sarif.runs[0].results;
    assert.equal(a.level, 'note');
    assert.ok(a.message.text.includes('→ Create it from the template'));
    assert.equal(a.locations[0].physicalLocation.artifactLocation.uri, 'docs-canonical/ARCHITECTURE.md');
    assert.equal(a.locations[0].physicalLocation.region, undefined, 'bare path has no region');
    assert.equal(b.level, 'warning');
    assert.equal(b.locations[0].physicalLocation.artifactLocation.uri, 'src/app.js');
    assert.equal(b.locations[0].physicalLocation.region.startLine, 42);
    // Every channel appears on every result (calibrated-finding-channels#FR-007).
    // These fixture findings predate the channels, so this also pins the
    // defaults SARIF applies to a legacy finding shape: a finding whose
    // disposition is unknown is an escalation, never an instruction to act.
    // `a` predates the disposition field but carries suggestion.kind 'fix', so
    // SARIF applies the constructor's own derivation rather than defaulting.
    assert.deepEqual(a.properties, {
      originalSeverity: 'error', effectiveSeverity: 'info',
      enforcement: { level: 'info', source: 'finding', key: 'STR001' },
      confidence: 'high', disposition: 'act', evidence: 'not-measured',
      parserTier: 'not-applicable', reportable: false, suggestionKind: 'fix',
    });
    assert.deepEqual(b.properties, {
      originalSeverity: 'warn', effectiveSeverity: 'warn',
      confidence: 'low', disposition: 'escalate', evidence: 'not-measured',
      parserTier: 'not-applicable', reportable: true,
    });
  });

  it('carries disposition, evidence and parser tier from real findings', () => {
    const act = mkFinding({
      code: 'SEC005', validator: 'security', severity: 'error', confidence: 'high',
      message: 'hardcoded token', location: 'src/a.js:3', parserTier: 'js-ast',
      suggestion: { kind: 'fix', text: 'Move it to an environment variable.' },
    });
    const escalate = mkFinding({
      code: 'FRS002', validator: 'freshness', severity: 'warn', confidence: 'high',
      message: 'review due', location: 'docs-canonical/ARCHITECTURE.md',
      suggestion: { kind: 'review', text: 'Review the document against its purpose.' },
    });
    const [x, y] = toSarif({ findings: [act, escalate], validators: [] }).runs[0].results;
    assert.equal(x.properties.disposition, 'act');
    assert.equal(x.properties.evidence, 'measured');
    assert.equal(x.properties.parserTier, 'js-ast');
    assert.equal(x.properties.suggestionKind, 'fix');
    assert.equal(x.properties.reportable, false, 'a measured, confident finding is not sampled by default');

    // The case the flat `confidence` field could not express: certain of what
    // it counted, and still the reader's call.
    assert.equal(y.properties.disposition, 'escalate');
    assert.equal(y.properties.confidence, 'high');
    assert.equal(y.properties.evidence, 'not-measured');
    assert.equal(y.properties.suggestionKind, 'review');
    assert.equal(y.properties.reportable, true, 'an unmeasured code is sampled for feedback');
  });

  it('synthesizes results for validator crash strings that have no findings', () => {
    const sarif = toSarif({
      findings: [],
      validators: [
        { key: 'drift', name: 'Drift', status: 'fail', errors: ['validator crashed: boom'], warnings: [], findings: [] },
      ],
    });
    const results = sarif.runs[0].results;
    assert.equal(results.length, 1);
    assert.equal(results[0].ruleId, 'DOCGUARD-DRIFT');
    assert.equal(results[0].level, 'error');
    assert.equal(results[0].locations, undefined);
  });
});

describe('guard --format sarif (spawn)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docguard-test-sarif-'));
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'sarif-fixture', version: '1.0.0' }));
    writeFileSync(join(tmpDir, '.docguard.json'), JSON.stringify({ profile: 'starter', projectName: 'sarif-fixture' }));
    mkdirSync(join(tmpDir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(tmpDir, 'docs-canonical', 'ARCHITECTURE.md'), '# Architecture\n\nMinimal.\n');
  });
  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('emits parseable SARIF on stdout with no ANSI escapes and a valid exit code', () => {
    const res = spawnSync(process.execPath, [CLI, 'guard', '--format', 'sarif'], { cwd: tmpDir, encoding: 'utf-8' });
    assert.ok([0, 1, 2].includes(res.status), `exit ${res.status}; stderr: ${res.stderr}`);
    assert.ok(!/\x1b\[/.test(res.stdout), 'stdout must be pure SARIF, no ANSI color codes');
    const sarif = JSON.parse(res.stdout);
    assert.ok(sarif.$schema.includes('sarif-schema-2.1.0'));
    assert.equal(sarif.runs[0].tool.driver.name, 'DocGuard');
    assert.ok(Array.isArray(sarif.runs[0].results));
  });
});
