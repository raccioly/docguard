/**
 * `docguard review --accept` with several paths (specs/097-strict-by-default
 * T028a): every path is recorded in one transaction, or none is.
 *
 * Before, `--accept A B` recorded A, left B in the positional arguments that
 * review never reads, and exited 0, so a reviewer believed both were recorded.
 *
 * @req docguard.recorded-document-reviews#FR-001
 * @req docguard.strict-by-default#FR-021
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fixtureGit } from './helpers/git.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };
const REVIEWS = '.docguard-doc-reviews.json';
const LOCK = '.docguard-doc-lock.json';

const temporary = [];
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

const code = (n) => Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-accept-many-'));
  temporary.push(dir);
  const files = {
    '.docguard.json': JSON.stringify({ projectName: 'accept-many', version: '0.6', requiredFiles: { canonical: ['docs-canonical/ARCHITECTURE.md'], agentFile: ['AGENTS.md'] } }, null, 2),
    'src/engine.mjs': code(30),
    'src/util.mjs': code(30),
    'AGENTS.md': '# Agents\n\n- `src/engine.mjs` parses the input, then runs it.\n- Run `npm test` before committing.\n',
    'GEMINI.md': 'Follow `AGENTS.md`.\n',
    'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n<!-- docguard:section id=engine source=human covers="src/engine.mjs" -->\nThe engine lives in `src/engine.mjs`; helpers in `src/util.mjs`.\n<!-- /docguard:section -->\n',
  };
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  }
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  fixtureGit(dir, ['config', 'user.email', 'fixture@example.invalid']);
  fixtureGit(dir, ['config', 'user.name', 'Fixture']);
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

function review(dir, ...args) {
  const r = spawnSync(process.execPath, [CLI, 'review', '--dir', dir, ...args], { encoding: 'utf8', env: ENV });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
const snapshot = (dir) => Object.fromEntries([REVIEWS, LOCK].map(p => [p, existsSync(join(dir, p)) ? readFileSync(join(dir, p), 'utf8') : null]));

describe('T028a: review --accept with several paths', () => {
  it('records every path given', () => {
    const dir = project();
    const r = review(dir, '--accept', 'AGENTS.md', 'docs-canonical/ARCHITECTURE.md', '--reason', 'read both against the engine and util as they are now', '--format', 'json');
    assert.equal(r.status, 0, r.err || r.out);
    const reviews = JSON.parse(readFileSync(join(dir, REVIEWS), 'utf8'));
    assert.deepEqual(Object.keys(reviews.documents).sort(), ['AGENTS.md', 'docs-canonical/ARCHITECTURE.md']);
    const lock = JSON.parse(readFileSync(join(dir, LOCK), 'utf8'));
    assert.ok(lock.sections['docs-canonical/ARCHITECTURE.md#engine'], 'the covered section of the second path is accepted too');
    const json = JSON.parse(r.out);
    assert.deepEqual(json.documents.map(d => d.path).sort(), ['AGENTS.md', 'docs-canonical/ARCHITECTURE.md']);
  });

  it('a path named twice is recorded once', () => {
    const dir = project();
    const r = review(dir, '--accept', 'AGENTS.md', 'AGENTS.md', '--reason', 'read AGENTS.md against the engine as it is now');
    assert.equal(r.status, 0, r.err || r.out);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, REVIEWS), 'utf8')).documents), ['AGENTS.md']);
  });

  for (const [label, bad, pattern] of [
    ['an unknown document', 'nope.md', /nope\.md/],
    ['a pointer', 'GEMINI.md', /GEMINI\.md only points to AGENTS\.md/],
  ]) {
    it(`refuses all of them when one is ${label}: writes nothing, names the path, exits 1`, () => {
      const dir = project();
      const before = snapshot(dir);
      // The bad path is second, so a review that writes as it goes would already have written the first.
      const r = review(dir, '--accept', 'docs-canonical/ARCHITECTURE.md', bad, '--reason', 'read both against the engine as it is now');
      assert.equal(r.status, 1);
      assert.match(r.err, pattern);
      assert.deepEqual(snapshot(dir), before, 'neither the reviews file nor the doc lock changed');
    });
  }

  it('one path still works as before', () => {
    const dir = project();
    const r = review(dir, '--accept', 'AGENTS.md', '--reason', 'read AGENTS.md against the engine as it is now', '--format', 'json');
    assert.equal(r.status, 0, r.err || r.out);
    const json = JSON.parse(r.out);
    assert.equal(json.document.path, 'AGENTS.md');
  });
});
