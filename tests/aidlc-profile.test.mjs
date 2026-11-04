/**
 * AWS AI-DLC records stay true after the workflow (specs/089-aidlc-profile).
 * Fixtures follow AI-DLC 2.11.2's documented shapes (code-generation stage:
 * traceability.json and source-manifest.json; aidlc-state.md Stage Progress).
 *
 * @req docguard.aidlc-profile#FR-001
 * @req docguard.aidlc-profile#FR-002
 * @req docguard.aidlc-profile#FR-003
 * @req docguard.aidlc-profile#FR-004
 * @req docguard.aidlc-profile#FR-005
 * @req docguard.aidlc-profile#FR-006
 * @req docguard.aidlc-profile#FR-007
 * @req docguard.aidlc-profile#SC-001
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateAidlc } from '../cli/validators/aidlc.mjs';
import { isPathTarget, parseStageProgress } from '../cli/scanners/aidlc.mjs';
import { ABSENCE_CLAIM_CODES, codeDefaultLevel } from '../cli/findings.mjs';
import { fixtureGit } from './helpers/git.mjs';

const REC = 'aidlc/spaces/default/intents/261101-inventory-api';
const STATE = (codegen = 'x') => `# AI-DLC State\n\n## Stage Progress\n<!-- Checkbox states -->\n\n### CONSTRUCTION PHASE\n- [x] functional-design — EXECUTE\n- [${codegen}] code-generation — EXECUTE\n`;
const TABLE = (rows) => JSON.stringify({ stage: 'code-generation', unit: 'u1-auth', upstream_ids: rows.map(r => r.id), coverage: rows });
const MANIFEST = (paths) => JSON.stringify({ stage: 'code-generation', unit: 'u1-auth', version: 1, writes: paths.map(path => (typeof path === 'string' ? { path } : path)) });

function project(t, files, { commit = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-aidlc-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), body); }
  if (commit) {
    fixtureGit(dir, ['init', '-q', '-b', 'main']);
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'unit u1-auth']);
  }
  return dir;
}
const codes = r => r.findings.map(f => `${f.code} ${f.message}`);

describe('US1 — traceability targets that no longer exist', () => {
  it('reports a removed OK target; IDs, prose and existing paths are fine', t => {
    const dir = project(t, {
      [`${REC}/aidlc-state.md`]: STATE(),
      [`${REC}/construction/u1-auth/code-generation/traceability.json`]: TABLE([
        { id: 'AC1.1.1', status: 'OK', target: 'src/auth/login.ts' },
        { id: 'AC1.1.2', status: 'OK', target: 'src/auth/session.ts' },
        { id: 'BR1.1', status: 'OK', target: 'US1.1' },
        { id: 'NFR1.1', status: 'Deferred', target: 'performance work is planned for unit 2' },
        { id: 'AC1.2.1', status: 'OK', target: 'src/auth/generated/' },
      ]),
      'src/auth/login.ts': 'export const login = 1;\n',
      'src/auth/generated/a.ts': 'export {};\n',
    });
    const c = codes(validateAidlc(dir));
    assert.deepEqual(c.filter(x => x.startsWith('AID001')).length, 1);
    assert.match(c.find(x => x.startsWith('AID001')), /AC1\.1\.2 → src\/auth\/session\.ts was traced at the code-generation gate/);
    assert.equal(isPathTarget('US1.1'), false);
    assert.equal(isPathTarget('src/x.ts'), true);
  });
});

describe('US2 — gaps a completed stage let through', () => {
  it('reports GAP and ORPHAN only when the stage is completed', t => {
    const rows = [{ id: 'AC1.3.1', status: 'GAP', target: '' }, { id: 'AC9.9.9', status: 'ORPHAN', target: '' }];
    const closed = project(t, { [`${REC}/aidlc-state.md`]: STATE('x'), [`${REC}/construction/u1-auth/code-generation/traceability.json`]: TABLE(rows) });
    const open = project(t, { [`${REC}/aidlc-state.md`]: STATE('-'), [`${REC}/construction/u1-auth/code-generation/traceability.json`]: TABLE(rows) });
    assert.equal(codes(validateAidlc(closed)).filter(x => x.startsWith('AID002')).length, 2);
    assert.equal(codes(validateAidlc(open)).filter(x => x.startsWith('AID002')).length, 0);
    assert.equal(parseStageProgress(STATE('x')).get('code-generation'), 'x');
  });
});

describe('US3 — a unit\'s claimed source', () => {
  it('reports a path removed after the unit, not one the unit deleted, and skips other repos', t => {
    const dir = project(t, {
      [`${REC}/aidlc-state.md`]: STATE(),
      [`${REC}/construction/u1-auth/code-generation/source-manifest.json`]: MANIFEST(['src/auth/login.ts', 'src/auth/old.ts', 'src/auth/legacy.ts', { repo: 'repo-b', path: 'src/x.ts' }]),
      'src/auth/login.ts': 'export const login = 1;\n',
      'src/auth/old.ts': 'export const old = 1;\n',
    });
    // old.ts existed when the manifest was committed; legacy.ts never did (the unit deleted it).
    unlinkSync(join(dir, 'src/auth/old.ts'));
    const c = codes(validateAidlc(dir));
    assert.deepEqual(c.filter(x => x.startsWith('AID003')).map(x => x.match(/claims (\S+),/)[1]), ['src/auth/old.ts']);
  });

  it('an uncommitted manifest is unjudged and reported partial', t => {
    const dir = project(t, { [`${REC}/aidlc-state.md`]: STATE(), [`${REC}/construction/u1-auth/code-generation/source-manifest.json`]: MANIFEST(['src/gone.ts']) }, { commit: false });
    const r = validateAidlc(dir);
    assert.equal(codes(r).filter(x => x.startsWith('AID003')).length, 0);
    assert.equal(r.applicability.status, 'partial');
  });
});

describe('US4 + edge cases', () => {
  it('reads the legacy aidlc-docs layout, reports malformed files and escaping paths, and is empty without AI-DLC', t => {
    const dir = project(t, {
      'aidlc-docs/aidlc-state.md': STATE(),
      'aidlc-docs/construction/u1/traceability.json': '{ not json',
      'aidlc-docs/construction/u2/traceability.json': TABLE([{ id: 'AC1.1.1', status: 'OK', target: '../outside/x.ts' }]),
    });
    const c = codes(validateAidlc(dir));
    assert.equal(c.filter(x => x.startsWith('AID004')).length, 2);
    assert.equal(validateAidlc(project(t, { 'README.md': '# x\n' })).applicable, false);
  });

  it('ships advisory, AID001/AID003 are absence claims, and the result reports what it read', t => {
    for (const code of ['AID001', 'AID002', 'AID003', 'AID004']) assert.equal(codeDefaultLevel(code), 'info');
    assert.ok(ABSENCE_CLAIM_CODES.has('AID001') && ABSENCE_CLAIM_CODES.has('AID003'));
    const dir = project(t, { [`${REC}/aidlc-state.md`]: STATE(), [`${REC}/construction/u1-auth/code-generation/traceability.json`]: TABLE([{ id: 'AC1.1.1', status: 'OK', target: 'src/a.ts' }]), 'src/a.ts': 'x\n' });
    const r = validateAidlc(dir);
    assert.deepEqual(r.aidlc, { records: 1, units: 1, tables: 1, manifests: 0 });
    assert.deepEqual(r.findings, []);
  });
});
