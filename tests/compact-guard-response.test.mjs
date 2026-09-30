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

const CLI = resolve('cli/docguard.mjs');
const TARGETS = ['.', 'benchmarks/fixtures/sparse-doc-control', 'benchmarks/fixtures/monorepo-security-control', 'benchmarks/fixtures/python-layered-control'];
const size = value => Buffer.byteLength(JSON.stringify(value));
const full = {};
for (const target of TARGETS) full[target] = runGuardInternal(resolve(target), loadConfig(resolve(target)));

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
        'nextStep', 'baselineSuppressed', 'baselineBySeverity', 'baselineStillFiring', 'baselineStale', 'coverage', 'checkCoverage', 'semanticClaims']) {
        assert.deepEqual(c[key], f[key], key);
      }
      assert.equal(c.validators.length, f.validators.length);
      c.validators.forEach((v, i) => {
        const o = f.validators[i];
        for (const key of ['key', 'name', 'status', 'effectiveStatus', 'passed', 'total', 'applicability', 'effectiveErrors', 'effectiveWarnings', 'effectiveInfos']) {
          assert.deepEqual(v[key], o[key], `${o.key}.${key}`);
        }
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
  it('is at least 30% smaller on the budget fixture and on this repository', () => {
    for (const target of ['benchmarks/fixtures/sparse-doc-control', '.']) {
      const saved = 1 - size(compactGuardResult(full[target])) / size(full[target]);
      assert.ok(saved >= 0.3, `${target}: ${(saved * 100).toFixed(1)}%`);
    }
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
