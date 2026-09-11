import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { validateFreshness } from '../cli/validators/freshness.mjs';
import { validateTraceability } from '../cli/validators/traceability.mjs';

let dir;
const put = (path, content) => safeWrite(join(dir, path), content);
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dg-review-clarity-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function git(...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_DATE: '2025-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2025-01-01T12:00:00Z' } });
}
function history(count = 3) {
  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', '/dev/null');
  for (let i = 0; i < count; i++) {
    put('src/feature.mjs', `export const value = ${i};\n// DRIFT: intentional behavior\n`);
    git('add', 'src/feature.mjs');
    git('commit', '-qm', 'Synthetic source change');
  }
}
const oldReview = '<!-- docguard:last-reviewed 2020-01-01 -->\n';
const reqFindings = config => validateTraceability(dir, config || {}).findings.filter(f => /^TRC00[45]$/.test(f.code));

describe('Field review clarity: freshness', () => {
  it('keeps real review triggers low-confidence and preserves design intent', () => {
    history(10);
    put('docs-canonical/guide.md', oldReview + '# Operating guide');
    const result = validateFreshness(dir, {}).find(r => r.doc === 'docs-canonical/guide.md');
    assert.equal(result.code, 'FRS002');
    assert.equal(result.confidence, 'low');
    assert.match(result.message, /review due.*10 code commits.*repository-wide heuristic/);
    assert.equal(result.suggestion.kind, 'review');
    assert.match(result.suggestion.text, /documentation or code needs a change/);
    assert.equal(result.suggestion.command, undefined);
  });

  it('skips explicit historical statuses but retains active and unmarked ADR review tasks', () => {
    history();
    for (const status of ['historical', 'superseded', 'deprecated', 'active']) {
      put(`docs-canonical/${status}.md`, `<!-- docguard:status ${status} -->\n` + oldReview);
    }
    put('docs-canonical/ADR.md', oldReview + '# Architecture decisions');
    const results = validateFreshness(dir, {});
    for (const status of ['historical', 'superseded', 'deprecated']) {
      const item = results.find(r => r.doc === `docs-canonical/${status}.md`);
      assert.equal(item.status, 'skip');
      assert.match(item.message, /historical accuracy is not verified/);
    }
    for (const name of ['active', 'ADR']) {
      const item = results.find(r => r.doc === `docs-canonical/${name}.md`);
      assert.equal(item.code, 'FRS003');
      assert.equal(item.confidence, 'low');
      assert.match(item.message, /review due/);
    }
  });

  it('does not treat fenced, inline or quoted status examples as historical metadata', () => {
    history();
    const examples = [
      '```markdown\n<!-- docguard:status historical -->\n```',
      '~~~markdown\n<!-- docguard:status superseded -->\n~~~',
      '> <!-- docguard:status historical -->',
      '`<!-- docguard:status historical -->`',
    ];
    for (const [i, example] of examples.entries()) put(`docs-canonical/example-${i}.md`, example + '\n' + oldReview);
    const results = validateFreshness(dir, {});
    assert.equal(results.length, examples.length);
    assert.ok(results.every(r => r.code === 'FRS003'));
  });

  it('scans explicit doc homes and canonical types without inferring extra review scope', () => {
    history();
    const files = ['docs-canonical/guide.md', 'handbook/nested/guide.md', 'custom/deep/guide.md',
      'specifications/intent.md', 'operations/runbook.md', 'docs-canonical/ignored.md', '.local/private.md', 'guides/unrequested.md', 'manual/operator.md'];
    for (const file of files) put(file, oldReview);
    put('.docguardignore', 'docs-canonical/ignored.md\n');
    symlinkSync(join(dir, '.local'), join(dir, 'custom', 'linked'), 'dir');
    const config = {
      docs: { dirs: ['custom', 'handbook'] },
      requiredFiles: { canonical: ['specifications/intent.md'] },
      documentTypes: { 'operations/runbook.md': { required: false, category: 'canonical', description: 'Operations' },
        'manual/operator.md': { required: false, category: 'implementation', description: 'Operating notes' } },
    };
    const results = validateFreshness(dir, config);
    assert.deepEqual(results.map(r => r.doc).sort(), files.slice(0, 5).sort());
    assert.ok(results.every(r => r.code === 'FRS003'));
  });

  it('reports unknown review signals without directing automatic rewriting', () => {
    history();
    put('docs-canonical/unreviewed.md', '# Intent');
    const result = validateFreshness(dir, {}).find(r => r.doc === 'docs-canonical/unreviewed.md');
    assert.equal(result.code, 'FRS001');
    assert.equal(result.confidence, 'low');
    assert.equal(result.suggestion.kind, 'review');
    assert.match(result.message, /After reviewing intent and implementation/);
  });

  it('keeps dedicated tracking signals as review tasks without duplicate general warnings', () => {
    history(5);
    put('release-notes.md', oldReview);
    put('deviations.md', oldReview);
    // Tracking logs are committed with an old date while source history remains newer.
    git('add', 'release-notes.md', 'deviations.md');
    execFileSync('git', ['commit', '-qm', 'Synthetic old tracking logs'], { cwd: dir, stdio: 'pipe',
      env: { ...process.env, GIT_AUTHOR_DATE: '2020-01-01T12:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T12:00:00Z' } });
    const config = { requiredFiles: { changelog: 'release-notes.md', driftLog: 'deviations.md' },
      documentTypes: { 'release-notes.md': { category: 'tracking' }, 'deviations.md': { category: 'tracking' } } };
    const results = validateFreshness(dir, config);
    assert.deepEqual(results.map(r => r.code).sort(), ['FRS004', 'FRS005']);
    assert.ok(results.every(r => r.confidence === 'low' && r.suggestion.kind === 'review'));
    assert.ok(results.every(r => /review due/.test(r.message)));
    put('release-notes.md', '<!-- docguard:status historical -->\n' + oldReview);
    put('deviations.md', '<!-- docguard:status superseded -->\n' + oldReview);
    assert.equal(validateFreshness(dir, config).filter(r => r.status === 'warn').length, 0);
  });

  it('does not claim currentness when a recent review satisfies the heuristic', () => {
    history();
    put('docs-canonical/reviewed.md', '<!-- docguard:last-reviewed 2025-01-01 -->\n');
    const result = validateFreshness(dir, {})[0];
    assert.equal(result.status, 'pass');
    assert.match(result.message, /no review due/);
    assert.match(result.message, /not semantic verification/);
  });
});

describe('Field review clarity: requirement traceability', () => {
  beforeEach(() => mkdirSync(join(dir, 'docs-canonical')));

  it('locates the defining requirement instead of prose or ID format examples', () => {
    put('docs-canonical/REQUIREMENTS.md', [
      '# Requirements',
      'IDs use REQ-701; related work mentions REQ-702.',
      '## Requirement ID format',
      '- REQ-701 is an example format',
      '### Example details',
      '| REQ-703 | Example only |',
      '## Functional requirements',
      '| ID | Requirement |',
      '|---|---|',
      '| **REQ-701** | Reject malformed input |',
      '- **REQ-702**: Preserve intended behavior',
    ].join('\n'));
    const results = reqFindings();
    assert.equal(results.length, 2);
    assert.deepEqual(results.map(r => r.location), ['docs-canonical/REQUIREMENTS.md:10', 'docs-canonical/REQUIREMENTS.md:11']);
    assert.ok(results.every(r => /no recognized test annotation or label; behavioral coverage is unknown/.test(r.message)));
    assert.ok(results.every(r => r.suggestion.kind === 'review'));
  });

  it('retains genuine missing IDs despite examples, comments and incidental references', () => {
    put('docs-canonical/REQUIREMENTS.md', [
      '# Requirements',
      'REQ-710 Reject invalid input',
      'A related proposal mentioned REQ-711.',
      '```markdown',
      'REQ-711 An example requirement',
      '```',
      '<!--',
      'REQ-711 A commented example',
      '-->',
    ].join('\n'));
    put('tests/behavior.test.mjs', '// @req REQ-710\n// @req REQ-711\ntest("works", () => {});');
    const results = reqFindings();
    assert.equal(results.length, 1);
    assert.equal(results[0].code, 'TRC005');
    assert.equal(results[0].confidence, 'high');
    assert.equal(results[0].location, 'tests/behavior.test.mjs:2');
  });

  it('distinguishes missing annotations from tests that may already verify behavior', () => {
    put('REQUIREMENTS.md', 'REQ-720 Reject malformed input payload\nREQ-721 Preserve valid input payload');
    put('tests/behavior.test.mjs', [
      'const fixture = "// @req REQ-720";',
      '// This discussion mentions @req REQ-720.',
      'test("reject malformed input payload", () => {});',
      '// @req REQ-721',
      'test("preserve valid input payload", () => {});',
    ].join('\n'));
    const results = reqFindings();
    assert.equal(results.length, 1);
    assert.equal(results[0].code, 'TRC004');
    assert.match(results[0].message, /REQ-720.*behavioral coverage is unknown.*IR soft-match/);
    assert.match(results[0].suggestion.text, /not coverage evidence/);
    assert.match(results[0].suggestion.text, /only if it verifies/);
  });

  it('reports an explicit orphan even when documentation has only example IDs', () => {
    put('REQUIREMENTS.md', '# Requirements\n## ID examples\n- REQ-750 Example only');
    put('tests/behavior.test.mjs', '// @req REQ-750\ntest("actual behavior", () => {});');
    const results = reqFindings();
    assert.equal(results.length, 1);
    assert.equal(results[0].code, 'TRC005');
    assert.equal(results[0].location, 'tests/behavior.test.mjs:1');
  });

  it('retains real requirement headings that describe example-related behavior', () => {
    put('REQUIREMENTS.md', '# Requirements\n## REQ-730 Render examples safely\n### Examples\nREQ-731 Example only\n## REQ-732 Validate examples');
    assert.deepEqual(reqFindings().map(f => f.location), ['REQUIREMENTS.md:2', 'REQUIREMENTS.md:5']);
  });

  it('does not treat indented code examples as definitions', () => {
    put('REQUIREMENTS.md', '# Requirements\n\n    REQ-760 Example only\n\nREQ-761 Reject invalid input');
    const results = reqFindings();
    assert.equal(results.length, 1);
    assert.equal(results[0].location, 'REQUIREMENTS.md:5');
  });

  it('discovers explicitly configured canonical requirements without a conventional doc home', () => {
    rmSync(join(dir, 'docs-canonical'), { recursive: true });
    put('specifications/intent.md', '# Requirements\nREQ-740 Preserve intent\nREQ-741 Reject invalid input');
    put('tests/behavior.test.mjs', '// @req REQ-740\ntest("valid behavior", () => {});');
    const results = reqFindings({ requiredFiles: { canonical: ['specifications/intent.md'] } });
    assert.equal(results.length, 1);
    assert.equal(results[0].location, 'specifications/intent.md:3');
  });

  it('does not activate missing canonical warnings merely by discovering feature specs', () => {
    rmSync(join(dir, 'docs-canonical'), { recursive: true });
    put('specs/feature/spec.md', '# Requirements\n- **FR-801**: Reject malformed input');
    const config = { requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'] } };
    let result = validateTraceability(dir, config);
    assert.deepEqual(result.findings.map(f => f.code), ['TRC004']);
    assert.equal(result.findings[0].location, 'specs/feature/spec.md:2');
    mkdirSync(join(dir, 'docs-canonical'));
    result = validateTraceability(dir, config);
    assert.ok(result.findings.some(f => f.code === 'TRC001'), 'retain missing-doc evidence within an established canonical home');
  });

  it('excludes configuration and prose from candidate tests without hiding a real annotation gap', () => {
    put('REQUIREMENTS.md', 'REQ-802 Validate payload signatures before accepting events');
    put('tests/tsconfig.json', '{"description":"Validate payload signatures before accepting events"}');
    put('tests/notes.md', '// @req REQ-802\nValidate payload signatures before accepting events');
    let result = reqFindings();
    assert.equal(result.length, 1);
    assert.equal(result[0].code, 'TRC004');
    assert.doesNotMatch(result[0].message, /IR soft-match/);
    put('tests/signatures.test.ts', 'test("Validate payload signatures before accepting events", () => {});');
    result = reqFindings();
    assert.equal(result.length, 1);
    assert.match(result[0].message, /IR soft-match: tests\/signatures\.test\.ts/);
  });

});
