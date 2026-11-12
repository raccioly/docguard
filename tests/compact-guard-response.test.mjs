/**
 * Compact guard response (specs/037-compact-guard-response): each fact once,
 * nothing lost, the full contract one argument away.
 *
 * @req docguard.compact-guard-response#FR-001
 * @req docguard.compact-guard-response#FR-002
 * @req docguard.compact-guard-response#FR-003
 * @req docguard.compact-guard-response#FR-004
 * @req docguard.compact-guard-response#FR-005
 * @req docguard.compact-guard-response#FR-006
 * @req docguard.compact-guard-response#FR-007
 * @req docguard.compact-guard-response#SC-001
 * @req docguard.compact-guard-response#SC-002
 * @req docguard.compact-guard-response#SC-003
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runGuardInternal } from '../cli/commands/guard.mjs';
import { loadConfig } from '../cli/config.mjs';
import { compactGuardResult, FULL_CONTRACT_HINT } from '../cli/shared-guard-json.mjs';
import { STANDARD_APPLICABILITY_REASONS } from '../cli/validator-coverage.mjs';

const CLI = resolve('cli/docguard.mjs');
const TARGETS = ['.', 'benchmarks/fixtures/sparse-doc-control', 'benchmarks/fixtures/monorepo-security-control', 'benchmarks/fixtures/python-layered-control'];
const size = value => Buffer.byteLength(JSON.stringify(value));
const full = {};
for (const target of TARGETS) full[target] = runGuardInternal(resolve(target), loadConfig(resolve(target)));

/**
 * What the compact form keeps of an applicability (specs/097-strict-by-default): not the status
 * a strict `applies: false` remap replaced (`before`), and not the sentence of a validator that
 * has nothing to check (`emptyCause` nothing-of-this-kind), which the compact form states once as
 * `emptyCauses`. Both stay in the full form.
 */
function compactApplicability(full, applicability, key) {
  if (!applicability) return applicability;
  const { before: _before, ...rest } = applicability;
  const validator = full.validators.find(v => v.key === key);
  const standard = Object.values(STANDARD_APPLICABILITY_REASONS).includes(rest.reason);
  if (validator?.emptyCause === 'nothing-of-this-kind' && !standard) delete rest.reason;
  return rest;
}

/** Read a validator's applicability back out of the compact form. */
function applicabilityOf(compact, validator) {
  const a = validator.applicability;
  if (!a) return a;
  // The class is stated once per status (docguard.verdict-contract#FR-012).
  const cls = a.class ?? compact.applicabilityClasses?.[a.status];
  return { ...a, ...(cls !== undefined ? { class: cls } : {}), ...(a.reason === undefined && compact.applicabilityReasons[a.status] !== undefined ? { reason: compact.applicabilityReasons[a.status] } : {}) };
}

/** Read the full form's coverage limitations back out of the compact validators. */
function limitationsOf(compact) {
  return compact.validators
    .map(v => ({ key: v.key, name: v.name, ...applicabilityOf(compact, v) }))
    .filter(v => v.status !== 'checked');
}

/** Read a full finding back out of the compact form. */
function reconstruct(compact, finding) {
  return {
    ...finding,
    evidence: compact.evidenceByCode[finding.code],
    enforcement: finding.enforcement ?? { level: finding.effectiveSeverity, source: 'intrinsic', key: finding.code },
    redactedContext: finding.redactedContext ?? null,
  };
}

describe('the compact form loses nothing (FR-005, SC-003)', () => {
  for (const target of TARGETS) {
    it(`reconstructs every finding, count and validator for ${target}`, () => {
      const f = full[target];
      const c = compactGuardResult(f);
      assert.equal(c.findings.length, f.findings.length);
      c.findings.forEach((finding, i) => assert.deepEqual(reconstruct(c, finding), f.findings[i], `finding ${i} (${f.findings[i].code})`));
      assert.deepEqual(c.findings.filter(x => x.reportable).map(x => x.message), f.reportable.map(x => x.message), 'reportable is derivable');
      for (const key of ['status', 'passed', 'total', 'errors', 'warnings', 'effectiveErrors', 'effectiveWarnings', 'effectiveInfos',
        'nextStep', 'baselineSuppressed', 'baselineBySeverity', 'baselineStillFiring', 'baselineStale', 'coverage', 'semanticClaims']) {
        assert.deepEqual(c[key], f[key], key);
      }
      assert.deepEqual({ ...c.checkCoverage, limitations: limitationsOf(c) },
        { ...f.checkCoverage, limitations: f.checkCoverage.limitations.map(l => ({ ...compactApplicability(f, l, l.key), key: l.key, name: l.name })) }, 'checkCoverage is derivable (FR-007)');
      assert.equal(c.checkCoverage.limitations, undefined, 'each limitation is already a validator\'s applicability');
      assert.equal(c.validators.length, f.validators.length);
      c.validators.forEach((v, i) => {
        const o = f.validators[i];
        for (const key of ['key', 'name', 'status', 'effectiveStatus', 'passed', 'total', 'effectiveErrors', 'effectiveWarnings', 'effectiveInfos']) {
          assert.deepEqual(v[key], o[key], `${o.key}.${key}`);
        }
        assert.deepEqual(applicabilityOf(c, v), compactApplicability(f, o.applicability, o.key), `${o.key}.applicability`);
        assert.equal(v.errorCount, o.errors.length);
        assert.equal(v.warningCount, o.warnings.length);
        assert.equal(v.findings, undefined);
        if (Array.isArray(o.findings)) {
          assert.equal(v.errors, undefined, 'structured findings carry these messages');
        } else {
          // A legacy validator's messages exist nowhere else.
          assert.deepEqual([v.errors, v.warnings], [o.errors, o.warnings], `${o.key} messages`);
        }
      });
    });
  }

  it('evidence really is per code: every finding of a code carries the same object', () => {
    for (const target of TARGETS) {
      const byCode = new Map();
      for (const finding of full[target].findings) {
        if (!byCode.has(finding.code)) byCode.set(finding.code, JSON.stringify(finding.evidence));
        assert.equal(JSON.stringify(finding.evidence), byCode.get(finding.code), `${target} ${finding.code}`);
      }
    }
  });

  it('keeps a configured enforcement and never hands an agent a raw, unquotable rate', () => {
    const f = full['benchmarks/fixtures/sparse-doc-control'];
    const configured = { ...f, findings: f.findings.map((x, i) => (i === 0 ? { ...x, enforcement: { level: 'warn', source: 'findingSeverity', key: x.code }, redactedContext: 'line 12: <redacted>' } : x)) };
    const kept = compactGuardResult(configured).findings[0];
    assert.deepEqual(kept.enforcement, { level: 'warn', source: 'findingSeverity', key: f.findings[0].code });
    assert.equal(kept.redactedContext, 'line 12: <redacted>');
    const c = compactGuardResult(f);
    assert.equal(c.precisionEvidence.codes, undefined, 'raw per-code statistics stay in the full form');
    assert.ok(c.precisionEvidence.caveat && c.precisionEvidence.source);
    assert.equal(c.detail, 'compact');
    assert.equal(c.hint, FULL_CONTRACT_HINT);
  });
});

describe('each fact once is smaller (SC-001, SC-002)', () => {
  // Fixtures are committed inputs, so their saving is a fixed number. This
  // repository's own guard result changes with every finding it fixes, and
  // most of the saving comes from findings stated once, so here the test only
  // requires the compact form to be smaller.
  it('is at least 30% smaller on every committed benchmark fixture', () => {
    for (const target of TARGETS.filter(t => t !== '.')) {
      const saved = 1 - size(compactGuardResult(full[target])) / size(full[target]);
      assert.ok(saved >= 0.3, `${target}: ${(saved * 100).toFixed(1)}%`);
    }
  });

  it('is smaller on this repository whatever its finding count, including none', () => {
    const f = full['.'];
    assert.ok(size(compactGuardResult(f)) < size(f), 'this repository');
    const clean = { ...f, findings: [], reportable: [], validators: f.validators.map(v => ({ ...v, findings: [], errors: [], warnings: [] })) };
    const saved = 1 - size(compactGuardResult(clean)) / size(clean);
    assert.ok(saved >= 0.2, `a result with no findings: ${(saved * 100).toFixed(1)}%`);
  });
});

function mcpGuard(args) {
  const messages = [
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'docguard_guard', arguments: args } },
  ];
  const out = spawnSync(process.execPath, [CLI, 'mcp'], { input: `${messages.map(m => JSON.stringify(m)).join('\n')}\n`, encoding: 'utf8' }).stdout;
  const byId = new Map(out.split('\n').filter(Boolean).map(line => { try { const m = JSON.parse(line); return [m.id, m]; } catch { return [null, null]; } }));
  return { list: byId.get(1), call: byId.get(2) };
}

describe('the result contract rides in the full form only (specs/097-strict-by-default, budget)', () => {
  const dir = resolve('benchmarks/fixtures/sparse-doc-control');
  const text = mcpGuard({ projectDir: dir }).call.result.content[0].text;
  const compact = JSON.parse(text);
  const full = JSON.parse(mcpGuard({ projectDir: dir, detail: 'full' }).call.result.content[0].text);

  it('the compact validators carry none of performed, applies or applicability.before', () => {
    for (const v of compact.validators) {
      assert.equal(v.performed, undefined, `${v.key}.performed`);
      assert.equal(v.applies, undefined, `${v.key}.applies`);
      assert.equal(v.applicability?.before, undefined, `${v.key}.applicability.before`);
    }
  });

  it('a validator that applies and examined nothing carries its cause and its fix', () => {
    const v = compact.validators.find(x => x.key === 'changelog');
    assert.equal(v.verdict, 'empty');
    assert.equal(v.emptyCause, 'needs-declaration');
    assert.match(v.howToConfigure, /CHANGELOG\.md/);
    assert.ok(v.applicability.reason, 'one reason');
    assert.equal(v.note, undefined, 'the note is the reason, stated once');
  });

  it('a validator with nothing to check carries its cause, no fix and no sentence of its own', () => {
    const v = compact.validators.find(x => x.emptyCause === 'nothing-of-this-kind');
    assert.ok(v, 'the fixture has one');
    assert.equal(v.howToConfigure, undefined);
    assert.equal(v.applicability.reason, undefined);
    assert.match(compact.emptyCauses['nothing-of-this-kind'], /nothing to configure/);
  });

  it('the full form keeps every contract field', () => {
    const v = full.validators.find(x => x.key === 'pathScopedRules');
    assert.equal(typeof v.performed, 'number');
    assert.equal(typeof v.applies.evidence, 'string');
    assert.ok(v.howToConfigure && v.note);
  });

  it('under strict the compact strict block refers to validators by key and repeats no text', () => {
    const strictFull = runGuardInternal(dir, { ...loadConfig(dir), enforcement: 'strict' });
    const c = compactGuardResult(strictFull);
    assert.ok(c.strict.unexamined.length > 0);
    for (const u of c.strict.unexamined) {
      assert.deepEqual(Object.keys(u).sort(), ['blocking', 'cause', 'newIn', 'validator', 'verdict'].sort());
      assert.ok(c.validators.some(v => v.key === u.validator), 'the validator entry carries the text');
    }
    assert.ok(strictFull.strict.unexamined.every(u => 'howToConfigure' in u && 'name' in u), 'the full form keeps them');
  });

  it('the response stays within its size budget', () => {
    // 37,026 bytes on v0.47.0; the budget allows +10%. The contract adds causes and fixes, not copies.
    assert.ok(Buffer.byteLength(text) <= 40_500, `${Buffer.byteLength(text)} bytes`);
  });
});

describe('agents get the compact form; the full contract stays reachable (FR-003, FR-004)', () => {
  it('docguard_guard is compact by default and full with detail "full"', () => {
    const dir = resolve('benchmarks/fixtures/sparse-doc-control');
    const compact = mcpGuard({ projectDir: dir });
    const body = JSON.parse(compact.call.result.content[0].text);
    assert.equal(body.detail, 'compact');
    assert.equal(body.reportable, undefined);
    const tool = compact.list.result.tools.find(t => t.name === 'docguard_guard');
    assert.deepEqual(tool.inputSchema.properties.detail.enum, ['compact', 'full']);
    assert.match(tool.description, /Pass detail "full"/);
    const whole = JSON.parse(mcpGuard({ projectDir: dir, detail: 'full' }).call.result.content[0].text);
    assert.ok(Array.isArray(whole.reportable));
    assert.ok(whole.validators.some(v => Array.isArray(v.findings)), 'the full form keeps per-validator finding copies');
    const bad = mcpGuard({ projectDir: dir, detail: 'huge' }).call;
    assert.ok(bad.error || bad.result?.isError, 'an unknown detail is refused');
  });

  it('guard --format json is the full contract, and --compact the projection', () => {
    const dir = 'benchmarks/fixtures/sparse-doc-control';
    const json = JSON.parse(spawnSync(process.execPath, [CLI, 'guard', '--format', 'json', '--dir', dir], { encoding: 'utf8' }).stdout);
    assert.ok(Array.isArray(json.reportable));
    assert.equal(json.detail, undefined);
    const compact = JSON.parse(spawnSync(process.execPath, [CLI, 'guard', '--format', 'json', '--compact', '--dir', dir], { encoding: 'utf8' }).stdout);
    assert.equal(compact.detail, 'compact');
    assert.equal(compact.findings.length, json.findings.length);
  });

  it('documents the compact default and how to get the full contract (FR-006)', () => {
    assert.match(readFileSync('docs/ai-integration.md', 'utf8'), /detail[^\n]*full/);
    assert.match(readFileSync('docs/commands.md', 'utf8'), /--compact/);
  });
});
