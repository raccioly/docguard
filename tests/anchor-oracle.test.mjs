/**
 * The pattern tier agrees with tree-sitter (specs/070-requirement-anchors
 * SC-007, FR-040): on the oracle corpus, at least 99% of declaration spans
 * for Go, Rust and Java, and no high-confidence language over the 1%
 * threshold. Runs where tools/anchor-oracle is installed: the anchor-oracle
 * CI job, or locally after `npm ci --ignore-scripts --prefix tools/anchor-oracle`.
 *
 * @req docguard.requirement-anchors#SC-007
 * @req docguard.requirement-anchors#FR-040
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const INSTALLED = existsSync(resolve('tools/anchor-oracle/node_modules/web-tree-sitter/web-tree-sitter.js'));
const dir = mkdtempSync(join(tmpdir(), 'dg-oracle-'));
after(() => rmSync(dir, { recursive: true, force: true }));

describe('anchor oracle (SC-007)', { skip: !INSTALLED && 'tools/anchor-oracle is not installed' }, () => {
  it('Go, Rust and Java agree on at least 99% of spans, and no high-confidence language fails', () => {
    const out = join(dir, 'report.json');
    const r = spawnSync(process.execPath, ['tools/anchor-oracle/run.mjs', '--json', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    for (const lang of ['go', 'rust', 'java']) {
      const e = report.languages[lang];
      assert.ok(e.declarations >= 50, `${lang}: ${e.declarations} declarations is too small a corpus`);
      assert.ok(e.disagreement <= 0.01, `${lang}: ${(e.disagreement * 100).toFixed(2)}% disagreement`);
    }
    assert.deepEqual(report.failed, []);
    for (const lang of ['kotlin', 'swift']) assert.equal(report.languages[lang].oracle, false);
  });
});
