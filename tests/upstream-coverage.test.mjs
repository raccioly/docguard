/**
 * Spec Kit chain coverage (specs/085-upstream-coverage).
 *
 * @req docguard.upstream-coverage#FR-001
 * @req docguard.upstream-coverage#FR-002
 * @req docguard.upstream-coverage#FR-003
 * @req docguard.upstream-coverage#FR-004
 * @req docguard.upstream-coverage#FR-005
 * @req docguard.upstream-coverage#FR-006
 * @req docguard.upstream-coverage#FR-007
 * @req docguard.upstream-coverage#SC-001
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chainCoverage, citedIds, definedIds } from '../cli/scanners/chain-coverage.mjs';
import { validateSpecKitIntegration } from '../cli/scanners/speckit.mjs';
import { codeDefaultLevel } from '../cli/findings.mjs';

const SPEC = `# Feature\n\n### User Story 1 - A\n\n### User Story 2 - B\n\n## Requirements\n\n- **FR-001**: one\n- **FR-002**: two\n- **FR-003** (amendment, 2026-11-01): three\n\n## Success Criteria\n\n- **SC-001**: measured\n`;

describe('chainCoverage', () => {
  it('finds uncovered and dangling IDs; plan citations count as coverage', () => {
    const r = chainCoverage({ spec: SPEC, plan: 'Built from spec.md. FR-002 reuses the existing reader.', tasks: '- [ ] T001 [US1] do (FR-001)\n- [ ] T002 [US1] more (FR-003, FR-009)\n' });
    assert.deepEqual(r.uncovered.map(x => x.id), ['SC-001']);
    assert.deepEqual(r.dangling.map(x => `${x.file}:${x.id}`), ['tasks.md:FR-009']);
    assert.equal(r.checked, true);
    assert.deepEqual(r.storiesUncovered, [2]);
  });

  it('expands same-prefix ranges, keeps sub-IDs distinct, ignores fences, comments, inline code and qualified IDs', () => {
    const cited = citedIds([
      'covers FR-004 to FR-006, FR-007–FR-008 and FR-009..FR-010',
      'see `FR-099` and docguard.other#FR-050, spec 013 FR-020, REQUIREMENTS FR-024',
      '<!-- FR-030 -->',
      '```', 'FR-031', '```',
      'FR-001a only',
    ].join('\n'));
    assert.deepEqual([...cited.keys()].sort(), ['FR-001a', 'FR-004', 'FR-005', 'FR-006', 'FR-007', 'FR-008', 'FR-009', 'FR-010']);
    assert.deepEqual([...definedIds('- **FR-011** *(amendment 2026-10-10)*: x\n| FR-012 | y |\n').keys()], ['FR-011', 'FR-012']);
  });

  it('a task list that cites no IDs is unchecked, not a set of gaps', () => {
    const r = chainCoverage({ spec: SPEC, plan: null, tasks: '- [ ] T001 implement it from plan.md\n' });
    assert.equal(r.checked, false);
    assert.deepEqual(r.uncovered, []);
    assert.deepEqual(r.floating, []);
  });

  it('flags artifacts that name no upstream', () => {
    const r = chainCoverage({ spec: SPEC, plan: 'A plan about nothing in particular.', tasks: '- [ ] T001 do the work\n' });
    assert.deepEqual(r.floating.sort(), ['plan.md', 'tasks.md']);
    assert.deepEqual(chainCoverage({ spec: SPEC, plan: 'From [spec](spec.md).', tasks: '- [ ] T001 see plan.md\n' }).floating, []);
  });

  it('no [USn] labels means no story check', () => {
    assert.deepEqual(chainCoverage({ spec: SPEC, plan: null, tasks: '- [ ] T001 (FR-001)\n' }).storiesUncovered, []);
  });
});

describe('Spec-Kit validator wiring', () => {
  const project = (t, features) => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-chain-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, '.specify'), { recursive: true });
    for (const [p, body] of Object.entries(features)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
    return dir;
  };
  const many = Array.from({ length: 12 }, (_, i) => `- **FR-${String(i + 1).padStart(3, '0')}**: r${i}`).join('\n');

  it('emits SPK013–SPK016 as advisory codes, caps at 10 and skips terminal features', t => {
    const dir = project(t, {
      'specs/001-a/spec.md': `# A\n\n## Requirements\n\n${many}\n- **FR-013**: covered\n`,
      'specs/001-a/tasks.md': '- [ ] T001 (FR-013)\n',
      'specs/002-b/spec.md': '# B\n\n**Status**: Superseded\n\n- **FR-001**: x\n',
      'specs/002-b/tasks.md': '- [ ] T001 (FR-009)\n',
    });
    const r = validateSpecKitIntegration(dir, {});
    const by = code => r.findings.filter(f => f.code === code);
    assert.equal(by('SPK013').length, 11, '10 findings plus one elision note');
    assert.match(by('SPK013').at(-1).message, /2 more SPK013/);
    assert.equal(by('SPK014').length, 0, 'the superseded feature is not checked');
    for (const code of ['SPK013', 'SPK014', 'SPK015', 'SPK016']) assert.equal(codeDefaultLevel(code), 'info');
  });
});
