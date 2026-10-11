/**
 * Workflow jobs run code without write tokens (specs/068-release-least-privilege).
 *
 * A bot may merge new test files without a maintainer (spec 067), so no job
 * that runs the test suite, a package manager or a build tool may hold a token
 * that can write to the repository. The workflows are read as text with a
 * small indentation reader: no YAML dependency (constitution Principle II).
 *
 * @req docguard.release-least-privilege#FR-001
 * @req docguard.release-least-privilege#FR-002
 * @req docguard.release-least-privilege#FR-003
 * @req docguard.release-least-privilege#FR-004
 * @req docguard.release-least-privilege#FR-005
 * @req docguard.release-least-privilege#FR-006
 * @req docguard.release-least-privilege#FR-007
 * @req docguard.release-least-privilege#FR-008
 * @req docguard.release-least-privilege#SC-001
 * @req docguard.release-least-privilege#SC-002
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = '.github/workflows';
const WORKFLOWS = readdirSync(DIR).filter(f => /\.ya?ml$/.test(f)).sort();
const read = f => readFileSync(join(DIR, f), 'utf8');

const indentOf = line => line.length - line.trimStart().length;

/** `key: value` pairs of the block that starts after `start`, one level deeper. */
function permissionBlock(lines, start, inline) {
  if (inline) {
    if (inline === '{}') return {};
    if (/^(read|write)-all$/.test(inline)) return { all: inline.replace('-all', '') };
    return { invalid: inline };
  }
  const out = {};
  const base = indentOf(lines[start]);
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (indentOf(line) <= base) break;
    const m = /^\s*([a-z-]+):\s*([a-z]+)/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * The parts of a workflow this test needs: top-level permissions, and per job
 * its permissions (null when it inherits), the text of its `run:` steps, the
 * actions it uses, and each checkout's persist-credentials setting.
 */
export function readWorkflow(text) {
  const lines = text.split('\n');
  let permissions = null;
  const jobs = [];
  let inJobs = false;
  let job = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const top = /^permissions:\s*(.*?)\s*(#.*)?$/.exec(line);
    if (top) { permissions = permissionBlock(lines, i, top[1]); continue; }
    if (/^jobs:\s*$/.test(line)) { inJobs = true; continue; }
    if (/^\S/.test(line)) { inJobs = false; continue; }
    if (!inJobs) continue;
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) { job = { name: header[1], permissions: null, runs: [], uses: [], checkouts: [], steps: 0 }; jobs.push(job); continue; }
    if (!job) continue;
    const jobPerms = /^ {4}permissions:\s*(.*?)\s*(#.*)?$/.exec(line);
    if (jobPerms) { job.permissions = permissionBlock(lines, i, jobPerms[1]); continue; }
    if (/^ {6}- /.test(line)) job.steps++;
    const run = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (run) {
      const keyIndent = run[1].length + (line.trimStart().startsWith('- ') ? 2 : 0);
      if (/^[|>][-+]?\s*$/.test(run[2])) {
        const body = [];
        for (let j = i + 1; j < lines.length && (!lines[j].trim() || indentOf(lines[j]) > keyIndent); j++) body.push(lines[j]);
        job.runs.push(body.join('\n'));
      } else {
        job.runs.push(run[2]);
      }
    }
    const uses = /^\s*(?:- )?uses:\s*["']?([^"'\s]+)/.exec(line);
    if (uses) {
      job.uses.push(uses[1]);
      if (uses[1].startsWith('actions/checkout@')) {
        // The step runs until the next line at or left of its "- " marker.
        const dash = line.trimStart().startsWith('- ') ? indentOf(line) : indentOf(line) - 2;
        let persist = null;
        for (let j = i + 1; j < lines.length && (!lines[j].trim() || indentOf(lines[j]) > dash); j++) {
          const p = /persist-credentials:\s*(\S+)/.exec(lines[j]);
          if (p) { persist = p[1]; break; }
        }
        job.checkouts.push({ persist });
      }
    }
  }
  return { permissions, jobs };
}

const WRITE_SCOPES = ['contents', 'actions', 'pull-requests', 'issues'];
const RUNS_TESTS = /\bnpm (?:run )?test\b|\bnode --test\b|\bnode cli\/docguard\.mjs\b/;
const RUNS_PACKAGES = /\bnpm\s|\bnpx\s|\bpip3?\s+install\b|\bpython3?\s+-m\s+build\b|\bdocker\s+build\b|\bnode --test\b|\bnode cli\//;

const effective = (wf, job) => job.permissions ?? wf.permissions ?? { all: 'write' };
const writes = perms => perms.all === 'write' ? ['all'] : Object.entries(perms).filter(([, v]) => v === 'write').map(([k]) => k);

/** Every rule violation in one workflow, as "file › job: reason". */
export function violations(file, text) {
  const wf = readWorkflow(text);
  const found = [];
  const top = wf.permissions;
  if (!top) found.push(`${file}: no top-level permissions (the default token can write)`);
  else if (writes(top).length || top.invalid) found.push(`${file}: top-level permissions grant ${writes(top).join(', ') || top.invalid}`);
  for (const job of wf.jobs) {
    const perms = effective(wf, job);
    const granted = writes(perms);
    const code = job.runs.join('\n');
    if (RUNS_TESTS.test(code)) {
      if (granted.length) found.push(`${file} › ${job.name}: runs tests holding ${granted.join(', ')} write`);
      if (job.checkouts.some(c => c.persist !== 'false')) found.push(`${file} › ${job.name}: runs tests with persisted checkout credentials`);
    }
    const repoWrite = granted.filter(s => s === 'all' || WRITE_SCOPES.includes(s));
    if (repoWrite.length && RUNS_PACKAGES.test(code)) {
      found.push(`${file} › ${job.name}: runs ${RUNS_PACKAGES.exec(code)[0].trim()} holding ${repoWrite.join(', ')} write`);
    }
  }
  return found;
}

describe('the reader and the rules bite (FR-007)', () => {
  const sample = [
    'name: bad',
    'permissions:',
    '  contents: write',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@0000000000000000000000000000000000000000',
    '      - run: npm ci',
    '      - name: Test',
    '        run: |',
    '          npm test',
    '  ok:',
    '    permissions:',
    '      contents: read',
    '    steps:',
    '      - uses: actions/checkout@0000000000000000000000000000000000000000',
    '        with:',
    '          persist-credentials: false',
    '      - run: npm test',
  ].join('\n');

  it('reads jobs, permissions, run blocks and checkout settings', () => {
    const wf = readWorkflow(sample);
    assert.deepEqual(wf.permissions, { contents: 'write' });
    assert.deepEqual(wf.jobs.map(j => j.name), ['test', 'ok']);
    assert.equal(wf.jobs[0].permissions, null);
    assert.deepEqual(wf.jobs[1].permissions, { contents: 'read' });
    assert.match(wf.jobs[0].runs.join('\n'), /npm test/);
    assert.deepEqual(wf.jobs[0].checkouts, [{ persist: null }]);
    assert.deepEqual(wf.jobs[1].checkouts, [{ persist: 'false' }]);
  });

  it('names every violation in the sample and none in the compliant job', () => {
    const found = violations('bad.yml', sample);
    assert.ok(found.some(v => /top-level permissions grant contents/.test(v)), found.join('\n'));
    assert.ok(found.some(v => /bad\.yml › test: runs tests holding contents write/.test(v)), found.join('\n'));
    assert.ok(found.some(v => /bad\.yml › test: runs tests with persisted checkout credentials/.test(v)), found.join('\n'));
    assert.ok(found.some(v => /bad\.yml › test: runs npm holding contents write/.test(v)), found.join('\n'));
    assert.ok(!found.some(v => /› ok:/.test(v)), found.join('\n'));
  });

  it('reads every workflow in the repository', () => {
    for (const file of WORKFLOWS) {
      const wf = readWorkflow(read(file));
      assert.ok(wf.jobs.length > 0, `${file}: no jobs read`);
      for (const job of wf.jobs) assert.ok(job.steps > 0 || job.uses.length > 0, `${file} › ${job.name}: no steps read`);
    }
  });
});

describe('no workflow runs code with a write token (FR-001, FR-002, FR-003)', () => {
  it('every workflow defaults to read, and no job runs tests or packages beside a write token', () => {
    const found = WORKFLOWS.flatMap(file => violations(file, read(file)));
    assert.deepEqual(found, []);
  });
});

const job = (file, name) => {
  const j = readWorkflow(read(file)).jobs.find(x => x.name === name);
  assert.ok(j, `${file} has a ${name} job`);
  return j;
};
const holds = (j, scope) => j.permissions?.[scope] === 'write';

describe('release assets are built without credentials (FR-004)', () => {
  it('the extension ZIP and the Claude Desktop bundle are built read-only and attached by a job that does not build', () => {
    for (const name of ['build-extension', 'build-mcpb']) {
      const j = job('release.yml', name);
      assert.deepEqual(writes(j.permissions ?? {}), [], `${name} holds no write`);
      assert.ok(j.checkouts.every(c => c.persist === 'false'), `${name} does not persist credentials`);
      assert.ok(j.uses.some(u => u.startsWith('actions/upload-artifact@')), `${name} uploads an artifact`);
      assert.doesNotMatch(j.runs.join('\n'), /gh release upload/, `${name} does not upload to the release`);
    }
    const attach = job('release.yml', 'attach-assets');
    assert.ok(holds(attach, 'contents'));
    assert.equal(attach.checkouts.length, 0, 'attach-assets checks nothing out');
    assert.ok(attach.uses.some(u => u.startsWith('actions/download-artifact@')));
    assert.match(attach.runs.join('\n'), /gh release upload/);
    assert.doesNotMatch(attach.runs.join("\n"), /(^|\s)(zip|npm|npx)\s/m, "attach-assets builds nothing");
  });

  it('PyPI builds in a read-only job and publishes only the built files', () => {
    const build = job('release.yml', 'build-pypi');
    assert.deepEqual(writes(build.permissions ?? {}), []);
    assert.match(build.runs.join('\n'), /python -m build/);
    assert.ok(build.uses.some(u => u.startsWith('actions/upload-artifact@')));
    const publish = job('release.yml', 'publish-pypi');
    assert.ok(holds(publish, 'id-token'));
    assert.equal(publish.checkouts.length, 0, 'publish-pypi checks nothing out');
    assert.ok(publish.uses.some(u => u.startsWith('actions/download-artifact@')));
    assert.doesNotMatch(publish.runs.join('\n'), /pip install|python -m build/);
  });

  it('every action stays pinned to a full commit SHA', () => {
    for (const file of WORKFLOWS) {
      for (const j of readWorkflow(read(file)).jobs) {
        for (const u of j.uses.filter(x => !x.startsWith('./'))) {
          assert.match(u, /@[0-9a-f]{40}$/, `${file} › ${j.name}: ${u}`);
        }
      }
    }
  });
});

describe('the scheduled release cuts and tests read-only, then pushes the exact patch (FR-005)', () => {
  const file = 'scheduled-release.yml';

  it('cut and verify hold no write; cut uploads the patch and runs no tests', () => {
    const cut = job(file, 'cut');
    const verify = job(file, 'verify');
    for (const j of [cut, verify]) {
      assert.deepEqual(writes(j.permissions ?? {}), [], `${j.name} holds no write`);
      assert.ok(j.checkouts.length > 0 && j.checkouts.every(c => c.persist === 'false'), `${j.name} does not persist credentials`);
    }
    assert.doesNotMatch(cut.runs.join('\n'), /npm (ci|test)/, 'the cut runs no tests');
    assert.match(cut.runs.join('\n'), /validate-release-candidate\.mjs/);
    assert.ok(cut.uses.some(u => u.startsWith('actions/upload-artifact@')));
    assert.match(verify.runs.join('\n'), /npm test/);
    assert.ok(verify.uses.some(u => u.startsWith('actions/download-artifact@')));
  });

  it('open-pr checks the patch paths, applies it, and runs no repository code', () => {
    const open = job(file, 'open-pr');
    for (const scope of ['contents', 'pull-requests', 'actions']) assert.ok(holds(open, scope), `open-pr holds ${scope}: write`);
    const code = open.runs.join('\n');
    assert.doesNotMatch(code, /\bnode\b|\bnpm\b|\bnpx\b|\.github\/scripts/, 'open-pr runs no repository code');
    assert.match(code, /git apply --numstat/);
    assert.match(code, /git apply --index/);
    assert.match(code, /gh pr create/);
    assert.match(read(file), /open-pr:\n(?:.*\n)*?\s+needs: \[cut, verify\]/);
  });

  it('the recovery dispatch holds only actions: write and checks nothing out', () => {
    const recover = job(file, 'recover');
    assert.deepEqual(writes(recover.permissions ?? {}), ['actions']);
    assert.equal(recover.checkouts.length, 0);
    assert.match(recover.runs.join('\n'), /gh workflow run release\.yml/);
  });
});

describe('GHCR logs in only after the image is built and smoke-tested (FR-006)', () => {
  it('docker login follows docker build and the smoke run', () => {
    const code = job('release.yml', 'publish-ghcr').runs.join('\n');
    const login = code.indexOf('docker login');
    assert.ok(login > code.indexOf('docker build') && login > code.indexOf('docker run'), code);
  });
});

describe('the rule is written down (FR-008)', () => {
  it('SECURITY.md states it', () => {
    const security = readFileSync('docs-canonical/SECURITY.md', 'utf8');
    assert.match(security, /persist-credentials: false/);
    assert.match(security, /tests\/workflow-permissions\.test\.mjs/);
  });
});
