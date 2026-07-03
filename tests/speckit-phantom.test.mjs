import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

// Checkbox markers concat-built so DocGuard's own traceability validator
// (anchored task-ID pattern: checklist marker / @task lookbehind) never reads
// these fixture strings as real task references — the tests/traceability.test.mjs
// convention.
const CBX = '- [x' + '] ';
const CBU = '- [ ' + '] ';

import { validateSpecKitIntegration } from '../cli/scanners/speckit.mjs';

let hasGit = true;
try { execSync('git --version', { stdio: 'ignore' }); } catch { hasGit = false; }

describe('Spec-Kit — phantom-completion detection (SPK008/SPK009)', () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'docguard-phantom-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function writeFeature(name, files) {
    const dir = join(tmp, '.specify', 'specs', name);
    mkdirSync(dir, { recursive: true });
    for (const [file, body] of Object.entries(files)) {
      writeFileSync(join(dir, file), body);
    }
  }

  function writeSrc(rel, body) {
    const full = join(tmp, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }

  const tasksMd = (lines) => ['# Tasks', '', '## Phase 1: Work', '', ...lines, ''].join('\n');

  const phantoms = (r) => r.findings.filter((f) => f.code === 'SPK008');
  const elisions = (r) => r.findings.filter((f) => f.code === 'SPK009');

  it('(a) does not flag a checked task whose named file exists', () => {
    writeSrc('src/api/users.ts', 'export const users = [];');
    writeFeature('001-feat', {
      'tasks.md': tasksMd([CBX + 'T001 Create user service in src/api/users.ts']),
    });

    const r = validateSpecKitIntegration(tmp, {});
    assert.deepEqual(phantoms(r), [], 'an existing named path is implementation evidence');
  });

  it('(b) flags a checked task naming a missing file with no other evidence', () => {
    writeFeature('001-feat', {
      'tasks.md': tasksMd([CBX + 'T004 Create user service in src/api/users.ts']),
    });

    const r = validateSpecKitIntegration(tmp, {});
    const p = phantoms(r);
    assert.equal(p.length, 1, 'expected exactly one phantom finding');
    assert.ok(p[0].message.includes('T004'), 'message names the task ID');
    assert.ok(p[0].message.includes('001-feat'), 'message names the feature');
    assert.ok(/checked:/.test(p[0].message), 'message says what evidence was checked');
    assert.ok(/tasks\.md:5$/.test(p[0].location), 'location carries the task line');
    assert.equal(p[0].severity, 'warn');
    assert.equal(p[0].confidence, 'low', 'a lie accusation is heuristic — must feed the FP loop');
    assert.equal(p[0].suggestion.kind, 'review');
    // The legacy warnings array carries the same message (resultFromFindings contract)
    assert.ok(r.warnings.includes(p[0].message));
  });

  it('(b2) truncates long task text at 80 chars in the message', () => {
    const longTail = 'x'.repeat(100);
    writeFeature('001-feat', {
      'tasks.md': tasksMd([CBX + `T004 Create src/api/users.ts ${longTail}`]),
    });

    const r = validateSpecKitIntegration(tmp, {});
    const p = phantoms(r);
    assert.equal(p.length, 1);
    const quoted = p[0].message.match(/"([^"]+)"/)[1];
    assert.equal(quoted.length, 80);
    assert.ok(quoted.endsWith('...'));
  });

  it('(c) does not flag an UNCHECKED task naming a missing file', () => {
    writeFeature('001-feat', {
      'tasks.md': tasksMd([CBU + 'T002 Create user service in src/api/users.ts']),
    });

    const r = validateSpecKitIntegration(tmp, {});
    assert.deepEqual(phantoms(r), [], 'unchecked tasks make no completion claim');
  });

  it('(d) does not flag prose-only checked tasks (unverifiable, not phantom)', () => {
    writeFeature('001-feat', {
      'tasks.md': tasksMd([
        CBX + 'T001 Review the approach with the team',
        CBX + 'T002 Deduplicate results across multiple patterns (Set-based)',
        CBX + 'T003 Upgrade to Node `18.0`',
      ]),
    });

    const r = validateSpecKitIntegration(tmp, {});
    assert.deepEqual(phantoms(r), [], 'tasks with no falsifiable path claim are out of scope');
  });

  it('(d2) does not convict on bare domain filenames without a slash', () => {
    // "buildspec.yml" describes what the code DETECTS, not a deliverable —
    // exactly the token shape that must never convict.
    writeFeature('001-feat', {
      'tasks.md': tasksMd([CBX + 'T009 Expand CI detection: buildspec.yml, amplify.yml, Jenkinsfile']),
    });

    const r = validateSpecKitIntegration(tmp, {});
    assert.deepEqual(phantoms(r), [], 'bare filenames are evidence-only, never claims');
  });

  it('rescues via code-symbol evidence when the named path moved', () => {
    writeSrc('src/impl.mjs', 'export function fetchUserRecords() { return []; }');
    writeFeature('001-feat', {
      'tasks.md': tasksMd([CBX + 'T003 Rewrite `fetchUserRecords()` in src/gone/old.mjs']),
    });

    const r = validateSpecKitIntegration(tmp, {});
    assert.deepEqual(phantoms(r), [], 'a named symbol that exists in source is evidence');
  });

  it('rescues via @task annotation in source', () => {
    writeSrc('src/other.mjs', '// @task' + ' T009 retry with backoff\nexport const retry = 1;');
    writeFeature('001-feat', {
      'tasks.md': tasksMd([CBX + 'T009 Implement retry logic in src/gone/retry.mjs']),
    });

    const r = validateSpecKitIntegration(tmp, {});
    assert.deepEqual(phantoms(r), [], 'a task-ID annotation in source is evidence');
  });

  it('rescues via sibling plan.md naming an existing deliverable', () => {
    writeSrc('lib/adapter.mjs', 'export const adapter = 1;');
    writeFeature('001-feat', {
      'plan.md': '# Plan\n\nDeliverable: `lib/adapter.mjs`\n',
      'tasks.md': tasksMd([CBX + 'T002 Wire adapter.mjs into src/gone/loader.mjs']),
    });

    const r = validateSpecKitIntegration(tmp, {});
    assert.deepEqual(phantoms(r), [], 'plan.md tying the deliverable to an existing file is evidence');
  });

  it('rescues via repo-wide basename match (file moved after completion)', () => {
    writeSrc('lib/thing.mjs', 'export const thing = 1;');
    writeFeature('001-feat', {
      'tasks.md': tasksMd([CBX + 'T005 Create src/old/thing.mjs helper']),
    });

    const r = validateSpecKitIntegration(tmp, {});
    assert.deepEqual(phantoms(r), [], 'a matching basename anywhere in the repo is evidence');
  });

  it('(e) caps SPK008 at 10 per run and emits one SPK009 elision note', () => {
    const lines = [];
    for (let i = 1; i <= 12; i++) {
      const id = `T${String(i).padStart(3, '0')}`;
      lines.push(`- [x] ${id} Create src/missing/file${i}.mjs`);
    }
    writeFeature('001-feat', { 'tasks.md': tasksMd(lines) });

    const r = validateSpecKitIntegration(tmp, {});
    assert.equal(phantoms(r).length, 10, 'SPK008 capped at 10');
    const e = elisions(r);
    assert.equal(e.length, 1, 'exactly one SPK009 elision note');
    assert.ok(e[0].message.includes('2 more'), 'elision counts the remainder');
  });

  it('(f) respects the specKit.phantomCheck=false opt-out', () => {
    writeFeature('001-feat', {
      'tasks.md': tasksMd([CBX + 'T004 Create user service in src/api/users.ts']),
    });

    const r = validateSpecKitIntegration(tmp, { specKit: { phantomCheck: false } });
    assert.deepEqual(phantoms(r), [], 'opt-out disables SPK008');
    assert.deepEqual(elisions(r), [], 'opt-out disables SPK009');
  });

  it('rescues via git commit trail mentioning the task ID', { skip: !hasGit }, () => {
    writeFeature('001-feat', {
      'tasks.md': tasksMd([
        CBX + 'T004 Create user service in src/api/users.ts',
        CBX + 'T005 Create audit log in src/api/audit.ts',
      ]),
    });
    execSync('git init -q', { cwd: tmp });
    execSync(
      'git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit --allow-empty -qm "feat: implement T004 users API"',
      { cwd: tmp }
    );

    const r = validateSpecKitIntegration(tmp, {});
    const p = phantoms(r);
    assert.equal(p.length, 1, 'T004 rescued by git, T005 still phantom');
    assert.ok(p[0].message.includes('T005'), 'the unevidenced task is still flagged');
    assert.ok(!p.some((f) => f.message.includes('T004 marked')), 'the committed task is not flagged');
    assert.ok(p[0].message.includes('git log'), 'git tier is reported as checked when it ran');
  });

  it('does not let a substring commit match rescue (T001 vs T0010)', { skip: !hasGit }, () => {
    writeFeature('001-feat', {
      'tasks.md': tasksMd([CBX + 'T001 Create src/missing/core.mjs']),
    });
    execSync('git init -q', { cwd: tmp });
    execSync(
      'git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit --allow-empty -qm "feat: implement T0010 other thing"',
      { cwd: tmp }
    );

    const r = validateSpecKitIntegration(tmp, {});
    assert.equal(phantoms(r).length, 1, 'T0010 in a commit is not evidence for T001');
  });

  it('counts each tasks.md with checked tasks as one check (passed on clean)', () => {
    writeSrc('src/done.mjs', 'export const done = 1;');
    writeFeature('001-feat', {
      'tasks.md': tasksMd([CBX + 'T001 Create src/done.mjs']),
    });

    const clean = validateSpecKitIntegration(tmp, {});
    assert.equal(clean.errors.length, 0);
    assert.deepEqual(phantoms(clean), []);
    assert.ok(clean.total > 0 && clean.passed <= clean.total);
  });
});
