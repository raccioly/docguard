/**
 * Shared fingerprint module (specs/070-requirement-anchors): the doc lock's
 * algorithm moves into cli/scanners/fingerprint.mjs without changing one byte
 * of its output, Python symbols are read in one interpreter run, an
 * interpreter upgrade no longer reads as a code change, and nested symbols
 * resolve.
 *
 * @req docguard.requirement-anchors#FR-015
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createContext, docLockStatus, fingerprint, serializeLock, DOC_LOCK_PATH } from '../cli/scanners/doc-deps.mjs';
import { pyAstAvailable, pythonCommand } from '../cli/scanners/py-ast.mjs';
import { pythonRuns, pythonVersion } from '../cli/scanners/py-anchors.mjs';
import { fixtureGit } from './helpers/git.mjs';

const FIXTURE = resolve('tests/fixtures/anchors/doclock-v0');
const GOLDEN = JSON.parse(readFileSync(join(FIXTURE, 'golden.json'), 'utf8'));
const REFS = JSON.parse(readFileSync(join(FIXTURE, 'refs.json'), 'utf8'));
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'dg-fp-')); dirs.push(d); return d; };

describe('doclock-v0 stays byte-identical (FR-015)', () => {
  const python = pyAstAvailable() ? pythonVersion() : null;
  for (const ref of REFS) {
    const expected = GOLDEN.fixture[ref];
    const isPython = expected?.tier === 'python-ast';
    it(`${ref}`, { skip: isPython && python !== GOLDEN.python ? `golden recorded with Python ${GOLDEN.python}, this machine has ${python || 'none'}` : false }, () => {
      const fp = fingerprint(createContext(FIXTURE), ref);
      assert.equal(fp.ok, true, fp.reason);
      assert.deepEqual({ tier: fp.tier, fingerprint: fp.fingerprint }, expected);
    });
  }

  it('every dependency in this repository\'s doc lock is still current', () => {
    const status = docLockStatus(resolve('.'));
    assert.equal(status.lockError, null);
    const changed = status.sections.flatMap(s => s.deps.filter(d => d.state === 'changed').map(d => `${s.key} → ${d.ref}`));
    assert.deepEqual(changed, []);
  });
});

describe('Python symbols are read in one interpreter run (FR-015)', { skip: !pyAstAvailable() && 'python3 unavailable' }, () => {
  it('a doc covering five Python symbols in two files spawns python once', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(dir, 'a.py'), 'def f():\n    return 1\n\ndef g():\n    return 2\n\nclass C:\n    def m(self):\n        return 3\n');
    writeFileSync(join(dir, 'b.py'), 'def h():\n    return 4\n\nX = 5\n');
    writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'),
      '# A\n\n<!-- docguard:section id=s source=human covers="a.py#f, a.py#g, a.py#C.m, b.py#h, b.py#X" -->\nText.\n<!-- /docguard:section -->\n');
    const before = pythonRuns();
    const status = docLockStatus(dir, {});
    assert.equal(pythonRuns() - before, 1);
    assert.deepEqual(status.sections[0].deps.map(d => d.tier), ['python-ast', 'python-ast', 'python-ast', 'python-ast', 'python-ast']);
  });
});

describe('an interpreter change is not a code change (FR-015, research P8)', { skip: !pyAstAvailable() && 'python3 unavailable' }, () => {
  const setup = ({ editAfterReview }) => {
    const dir = tmp();
    fixtureGit(dir, ['init', '-q']);
    fixtureGit(dir, ['config', 'user.email', 't@example.com']);
    fixtureGit(dir, ['config', 'user.name', 't']);
    mkdirSync(join(dir, 'docs-canonical'), { recursive: true });
    writeFileSync(join(dir, 'calc.py'), 'def total(xs):\n    return sum(xs)\n');
    writeFileSync(join(dir, 'docs-canonical', 'ARCHITECTURE.md'),
      '# A\n\n<!-- docguard:section id=calc source=human covers="calc.py#total" -->\nSums.\n<!-- /docguard:section -->\n');
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['commit', '-qm', 'base']);
    const revision = fixtureGit(dir, ['rev-parse', 'HEAD']).trim();
    // The lock was written by a different interpreter: same code, different ast.dump.
    const lock = {
      schemaVersion: 1,
      sections: {
        'docs-canonical/ARCHITECTURE.md#calc': {
          reviewedRevision: revision, reviewedAt: '2026-10-11', reason: 'reviewed under an older python3',
          dependencies: { 'calc.py#total': { tier: 'python-ast', fingerprint: `sha256:${'0'.repeat(64)}` } },
        },
      },
    };
    writeFileSync(join(dir, DOC_LOCK_PATH), serializeLock(lock));
    if (editAfterReview) writeFileSync(join(dir, 'calc.py'), 'def total(xs):\n    return sum(xs) + 1\n');
    return dir;
  };

  it('unchanged code under a different interpreter is unverifiable, not changed', () => {
    const status = docLockStatus(setup({ editAfterReview: false }), {});
    const dep = status.sections[0].deps[0];
    assert.equal(dep.state, 'unverifiable');
    assert.match(dep.reason, /interpreter/);
    assert.equal(status.sections[0].state, 'unverifiable');
  });

  it('changed code is still changed', () => {
    const status = docLockStatus(setup({ editAfterReview: true }), {});
    assert.equal(status.sections[0].deps[0].state, 'changed');
  });
});

describe('nested symbols resolve (FR-015)', () => {
  it('JS: a method of a class nested in a namespace object and a nested function', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'n.mjs'), 'export class Outer {\n  inner() { return 1; }\n}\nexport function host() {\n  function helper() { return 2; }\n  return helper();\n}\n');
    const ctx = createContext(dir);
    assert.equal(fingerprint(ctx, 'n.mjs#Outer.inner').ok, true);
    assert.equal(fingerprint(ctx, 'n.mjs#host.helper').ok, true);
    assert.equal(fingerprint(ctx, 'n.mjs#host.missing').missing, true);
  });

  it('Python: a method of a nested class', { skip: !pythonCommand() && 'python3 unavailable' }, () => {
    const dir = tmp();
    writeFileSync(join(dir, 'n.py'), 'class Outer:\n    class Inner:\n        def deeper(self):\n            return 1\n');
    const fp = fingerprint(createContext(dir), 'n.py#Outer.Inner.deeper');
    assert.equal(fp.ok, true, fp.reason);
    assert.equal(fp.tier, 'python-ast');
  });
});
