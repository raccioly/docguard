import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ci = read('.github/workflows/ci.yml');
const consumers = [
  ['generic CI', read('templates/ci/github-actions.yml'), false],
  ['extension guard', read('extensions/spec-kit-docguard/templates/github-workflows/docguard-guard.yml'), true],
];
// Verified via the official Git refs API (object.type=commit for each tag).
// These are commit objects, not annotated-tag object IDs. Tests stay offline.
const pins = {
  'actions/checkout': {
    '3d3c42e5aac5ba805825da76410c181273ba90b1': 'https://api.github.com/repos/actions/checkout/git/ref/tags/v7.0.1',
    '11d5960a326750d5838078e36cf38b85af677262': 'https://api.github.com/repos/actions/checkout/git/ref/tags/v4.4.0',
  },
  'actions/setup-node': {
    '820762786026740c76f36085b0efc47a31fe5020': 'https://api.github.com/repos/actions/setup-node/git/ref/tags/v7.0.0',
    '49933ea5288caeca8642d1e84afbd3f7d6820020': 'https://api.github.com/repos/actions/setup-node/git/ref/tags/v4.4.0',
  },
  'actions/upload-artifact': {
    '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a': 'https://api.github.com/repos/actions/upload-artifact/git/ref/tags/v7.0.1',
    'ea165f8d65b6e75b540449e92b4886f43607fa02': 'https://api.github.com/repos/actions/upload-artifact/git/ref/tags/v4.6.2',
  },
};

function script(workflow, name) {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => line.trim() === `- name: ${name}`);
  assert.ok(start >= 0, `missing step ${name}`);
  const run = lines.findIndex((line, i) => i > start && line.trim() === 'run: |');
  assert.ok(run > start, `missing script ${name}`);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && !line.startsWith('          ')) break;
    body.push(line.slice(10));
  }
  return body.join('\n');
}

function inTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-ci-repro-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('CI reproducibility contracts', () => {
  for (const [name, workflow] of [['repository', ci], ...consumers]) {
    it(`${name} keeps runner context out of job env and initializes real temp paths`, () => inTemp(dir => {
      // Inspect YAML indentation, not just validity: GitHub resolves job env
      // before a runner exists. A YAML parser alone accepts this invalid scope.
      const jobEnvs = workflow.matchAll(/^    env:\s*\n((?:^      .*\n|^\s*\n)*)/gm);
      for (const [, body] of jobEnvs) assert.doesNotMatch(body, /\$\{\{[^}]*\brunner\./);
      const envFile = join(dir, 'github-env');
      const runnerTemp = join(dir, 'runner temp');
      const result = spawnSync('bash', ['-eo', 'pipefail', '-c', script(workflow, 'Initialize report paths')], {
        encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: runnerTemp, GITHUB_ENV: envFile },
      });
      assert.equal(result.status, 0, result.stderr);
      const values = Object.fromEntries(readFileSync(envFile, 'utf8').trim().split('\n').map(line => line.split('=')));
      assert.equal(values.DOCGUARD_REPORT, join(runnerTemp, 'docguard-report.json'));
      if (name !== 'repository') assert.equal(values.DOCGUARD_LOG, join(runnerTemp, 'docguard-stderr.log'));
      if (name === 'extension guard') assert.equal(values.DOCGUARD_SCORE, join(runnerTemp, 'docguard-score.json'));
    }));

    it(`${name} uses only verified action commit pins and read-only permissions`, () => {
      const uses = [...workflow.matchAll(/uses:\s*([^@\s]+)@([^\s]+)/g)];
      assert.ok(uses.length >= 3);
      for (const [, action, sha] of uses) {
        assert.match(sha, /^[a-f0-9]{40}$/);
        assert.ok(pins[action]?.[sha], `unverified action ${action}@${sha}`);
      }
      assert.match(workflow, /permissions:\n  contents: read/);
      assert.doesNotMatch(workflow, /pull_request_target|pull-requests: write|contents: write|continue-on-error/);
      assert.match(workflow, /if: always\(\)[\s\S]*uses: actions\/upload-artifact@/);
    });
  }

  it('preserves the four Node versions and lockfile install', () => {
    assert.match(ci, /node-version: \[18, 20, 22, 24\]/);
    assert.match(ci, /run: npm ci/);
    assert.match(ci, /name: docguard-report-node-\$\{\{ matrix.node-version \}\}/);
    assert.match(ci, /node --test --test-reporter=tap tests\/\*\.test\.mjs/);
  });

  for (const [name, workflow, allowsWarnings] of consumers) {
    it(`${name} pins the shipped CLI version and reads full history`, () => {
      const { version } = JSON.parse(read('package.json'));
      const installs = [...workflow.matchAll(/npm install --global --ignore-scripts docguard-cli@([^\s]+)/g)];
      assert.equal(installs.length, 1);
      assert.equal(installs[0][1], version, 'Update the copyable template pin with each release');
      assert.match(workflow, /fetch-depth: 0/);
      assert.match(workflow, /persist-credentials: false/);
      assert.doesNotMatch(workflow, /@latest|npx |raccioly\/docguard@/);
      assert.match(workflow, /DOCGUARD_REPORT=\$RUNNER_TEMP\/docguard-report.json/);
      if (!allowsWarnings) assert.match(workflow, /ci --format json --threshold 70 --no-history/);
    });

    for (const status of [0, 1, 2, 7]) {
      it(`${name} preserves exit ${status} policy and reports the actual verdict`, () => inTemp(dir => {
        const bin = join(dir, 'bin');
        mkdirSync(bin);
        writeFileSync(join(bin, 'docguard'), '#!/bin/sh\nprintf \'%s\\n\' "$MOCK_REPORT"\nprintf \'diagnostic\\n\' >&2\nexit "$MOCK_STATUS"\n', { mode: 0o755 });
        const report = join(dir, 'report.json');
        const log = join(dir, 'stderr.log');
        const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script(workflow, 'Run DocGuard')], {
          cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
            DOCGUARD_REPORT: report, DOCGUARD_LOG: log, FAIL_ON_WARNING: 'false',
            MOCK_STATUS: String(status), MOCK_REPORT: JSON.stringify({ status: 'PASS', findings: [], padding: 'x'.repeat(20000) }) },
        });
        assert.equal(result.status, status === 2 && allowsWarnings ? 0 : status, result.stderr);
        assert.equal(JSON.parse(readFileSync(report, 'utf8')).status, status === 0 ? 'PASS' : status === 2 ? 'WARN' : 'FAIL');
        assert.equal(readFileSync(log, 'utf8'), 'diagnostic\n');
      }));
    }

    it(`${name} fails closed on malformed JSON`, () => inTemp(dir => {
      const bin = join(dir, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'docguard'), '#!/bin/sh\necho "not JSON"\nexit 0\n', { mode: 0o755 });
      const result = spawnSync('bash', ['-eo', 'pipefail', '-c', script(workflow, 'Run DocGuard')], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
          DOCGUARD_REPORT: join(dir, 'report.json'), DOCGUARD_LOG: join(dir, 'stderr.log') },
      });
      assert.notEqual(result.status, 0);
    }));

    it(`${name} can summarize installation failures without a report`, () => inTemp(dir => {
      const summary = join(dir, 'summary.md');
      const result = spawnSync('bash', ['-eo', 'pipefail', '-c', script(workflow, 'Display Results')], {
        encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary, DOCGUARD_REPORT: join(dir, 'absent.json') },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(readFileSync(summary, 'utf8'), /No report produced/);
    }));
  }

  it('lets extension users make warnings blocking without changing findings', () => inTemp(dir => {
    writeFileSync(join(dir, 'docguard'), '#!/bin/sh\necho \'{"status":"WARN","findings":[]}\'\nexit 2\n', { mode: 0o755 });
    const report = join(dir, 'report.json');
    const result = spawnSync('bash', ['-eo', 'pipefail', '-c', script(consumers[1][1], 'Run DocGuard')], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
        DOCGUARD_REPORT: report, DOCGUARD_LOG: join(dir, 'stderr.log'), FAIL_ON_WARNING: 'true' },
    });
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(readFileSync(report, 'utf8')).status, 'WARN');
  }));

  for (const status of [0, 1, 2, 7]) {
    it(`repository guard preserves warning policy for exit ${status}`, () => inTemp(dir => {
      writeFileSync(join(dir, 'node'), '#!/bin/sh\necho \'{"findings":[]}\'\nexit "$MOCK_STATUS"\n', { mode: 0o755 });
      const result = spawnSync('bash', ['-eo', 'pipefail', '-c', script(ci, 'Guard (self-check)')], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
          DOCGUARD_REPORT: join(dir, 'report.json'), MOCK_STATUS: String(status) },
      });
      assert.equal(result.status, status === 0 || status === 2 ? 0 : 1, result.stderr);
    }));
  }

  for (const [duration, status, expected] of [['30.25', 0, 0], ['120001', 0, 1], ['', 0, 1], ['30', 1, 1]]) {
    it(`enforces the runtime budget with duration=${duration || 'missing'} and test exit=${status}`, () => inTemp(dir => {
      writeFileSync(join(dir, 'node'), '#!/bin/sh\n[ -z "$MOCK_DURATION" ] || echo "# duration_ms $MOCK_DURATION"\nexit "$MOCK_STATUS"\n', { mode: 0o755 });
      const body = script(ci, 'Run Tests (with runtime budget)').replaceAll('/tmp/test-output.txt', join(dir, 'output.txt'));
      const result = spawnSync('bash', ['-eo', 'pipefail', '-c', body], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`,
          TEST_BUDGET_MS: '120000', MOCK_DURATION: duration, MOCK_STATUS: String(status) },
      });
      assert.equal(result.status, expected, result.stderr);
    }));
  }

  for (const status of [0, 1, 2, 127]) {
    it(`baseline assertion accepts only its expected error exit, got ${status}`, () => inTemp(dir => {
      writeFileSync(join(dir, 'node'), '#!/bin/sh\ncase "$*" in *--no-baseline*) exit "$MOCK_STATUS";; *) exit 0;; esac\n', { mode: 0o755 });
      const body = script(ci, 'Baseline roundtrip (freeze → pass → restore)').replaceAll('/tmp/docguard-baseline', join(dir, 'fixture'));
      const result = spawnSync('bash', ['-eo', 'pipefail', '-c', body], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_WORKSPACE: '/workspace with spaces', MOCK_STATUS: String(status) },
      });
      assert.equal(result.status, status === 1 ? 0 : 1, result.stderr + result.stdout);
    }));
  }

  it('executes the real baseline freeze, pass and error-restoration roundtrip', () => inTemp(dir => {
    const body = script(ci, 'Baseline roundtrip (freeze → pass → restore)').replaceAll('/tmp/docguard-baseline', join(dir, 'fixture'));
    const result = spawnSync('bash', ['-eo', 'pipefail', '-c', body], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, GITHUB_WORKSPACE: fileURLToPath(new URL('../', import.meta.url)) },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }));
});
