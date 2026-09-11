import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { safeWrite } from '../cli/writers/generate-io.mjs';

const helper = fileURLToPath(new URL('../extensions/spec-kit-docguard/scripts/bash/docguard-check-docs.sh', import.meta.url));
const scoreJSON = JSON.stringify({ score: 73 }, null, 2);
const guardJSON = (status = 'PASS', passed = 4, total = 5) => JSON.stringify({ status, passed, total }, null, 2);

// Execute a real Node CLI fixture through the shipped Bash helper. A closed PATH
// excludes host installs and turns any attempted npx download into a local trap.
function withProject(options, check) {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'docguard-helper-')));
  try {
    const root = join(temp, options.specialPath ? 'project spaces;$(touch INJECTED);\x60touch INJECTED\x60 "quote"' : 'project');
    const bin = join(temp, 'bin');
    const calls = join(temp, 'calls.jsonl');
    mkdirSync(bin);
    safeWrite(join(root, '.docguard.json'), '{}');
    symlinkSync(process.execPath, join(bin, 'node'));
    for (const name of ['dirname', 'basename', 'grep', 'sed', 'tr', 'head', 'cat', 'pwd', 'mktemp', 'rm']) {
      const executable = ['/usr/bin/', '/bin/'].map(prefix => prefix + name).find(existsSync);
      assert.ok(executable, name + ' must be available');
      symlinkSync(executable, join(bin, name));
    }
    const fixture = [
      "import { appendFileSync } from 'node:fs';",
      'const args = process.argv.slice(2);',
      'appendFileSync(process.env.CALLS, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");',
      'if (args.length !== 3 || args[1] !== "--format" || args[2] !== "json") process.exit(91);',
      'if (args[0] === "score") { process.stdout.write(process.env.SCORE_JSON); process.exit(Number(process.env.SCORE_EXIT)); }',
      'if (args[0] === "guard") { process.stdout.write(process.env.GUARD_JSON); process.exit(Number(process.env.GUARD_EXIT)); }',
      'process.exit(92);',
    ].join('\n');
    if (options.install !== 'missing') {
      safeWrite(join(root, options.install === 'package' ? 'node_modules/docguard-cli/cli/docguard.mjs' : 'cli/docguard.mjs'), fixture);
    }
    for (const name of ['npx', ...(options.global ? ['docguard', 'docguard-cli'] : [])]) {
      const executable = join(bin, name);
      safeWrite(executable, '#!/bin/sh\nprintf "%s\\n" "' + name + '" >> "$TRAPS"\nexit 93\n');
      chmodSync(executable, 0o755);
    }
    const result = spawnSync('/bin/bash', [helper, '--json', '--verbose'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      env: {
        PATH: bin, HOME: temp, TMPDIR: temp, CALLS: calls, TRAPS: join(temp, 'traps'),
        SCORE_JSON: scoreJSON, SCORE_EXIT: '0', GUARD_JSON: guardJSON(), GUARD_EXIT: '0',
        ...options.env,
      },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    assert.equal(existsSync(join(temp, 'traps')), false, 'must not invoke global CLI or npx');
    assert.equal(existsSync(join(root, 'INJECTED')), false, 'project path must remain literal');
    assert.equal(existsSync(join(temp, 'INJECTED')), false, 'must not evaluate command substitutions');
    check(result, root, existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function expectReport(result, root, calls, status) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.projectRoot, root);
  assert.deepEqual({ score: report.score, guardPass: report.guardPass, guardTotal: report.guardTotal, guardStatus: report.guardStatus },
    { score: 73, guardPass: 4, guardTotal: 5, guardStatus: status });
  assert.deepEqual(calls, ['score', 'guard'].map(command => ({ args: [command, '--format', 'json'], cwd: root })));
}

function expectFailure(result) {
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  let report;
  try { report = JSON.parse(result.stdout); } catch { return; }
  assert.ok(report && typeof report === 'object' && !Array.isArray(report) && report.error,
    'failure must not emit a successful helper JSON report: ' + result.stdout);
  for (const key of ['score', 'guardPass', 'guardTotal', 'guardStatus']) {
    assert.equal(Object.hasOwn(report, key), false, 'failure must not include success field ' + key);
  }
}

describe('Spec Kit helper JSON contract', () => {
  for (const [status, exit] of [['PASS', 0], ['WARN', 2], ['FAIL', 1]]) {
    it('reports pretty JSON ' + status + ' with helper exit zero', () => {
      withProject({ env: { GUARD_JSON: guardJSON(status), GUARD_EXIT: String(exit) } },
        (result, root, calls) => expectReport(result, root, calls, status));
    });
  }

  for (const install of ['dev', 'package']) {
    it('safely executes ' + install + ' CLI in a path with spaces and shell metacharacters', () => {
      withProject({ install, specialPath: true }, (result, root, calls) => expectReport(result, root, calls, 'PASS'));
    });
  }

  it('prefers installed project package over global executables', () => {
    withProject({ install: 'package', global: true }, (result, root, calls) => expectReport(result, root, calls, 'PASS'));
  });

  it('fails without an installed CLI and never falls back to npx', () => {
    withProject({ install: 'missing' }, (result, root, calls) => {
      expectFailure(result);
      assert.deepEqual(calls, []);
    });
  });

  for (const value of ['', 'not JSON', '{"score":73', '{"score":73} trailing', '{}', 'null', '[]',
    '{"score":"73"}', '{"score":null}', '{"score":true}', '{"score":-1}', '{"score":101}', '{"score":1e999}']) {
    it('rejects invalid score ' + JSON.stringify(value), () => {
      withProject({ env: { SCORE_JSON: value } }, expectFailure);
    });
  }

  const invalidGuards = ['', 'not JSON', '{"status":"PASS","passed":4,"total":5', guardJSON() + ' trailing',
    '{}', 'null', '[]', '{"status":"PASS","passed":4}', guardJSON('UNKNOWN'), guardJSON('pass'), guardJSON(null)];
  for (const value of ['4', null, true, -1, 1.5]) {
    invalidGuards.push(guardJSON('PASS', value, 5), guardJSON('PASS', 0, value));
  }
  invalidGuards.push(guardJSON('PASS', 6, 5), '{"status":"PASS","passed":1e999,"total":5}');
  for (const value of invalidGuards) {
    it('rejects invalid guard ' + JSON.stringify(value), () => {
      withProject({ env: { GUARD_JSON: value } }, expectFailure);
    });
  }

  for (const [status, validExit] of [['PASS', 0], ['WARN', 2], ['FAIL', 1]]) {
    for (const exit of [0, 1, 2, 3, 127]) {
      if (exit === validExit) continue;
      it('rejects guard status ' + status + ' with exit ' + exit, () => {
        withProject({ env: { GUARD_JSON: guardJSON(status), GUARD_EXIT: String(exit) } }, expectFailure);
      });
    }
  }

  for (const exit of [1, 2, 127]) {
    it('rejects valid score JSON when score exits ' + exit, () => {
      withProject({ env: { SCORE_EXIT: String(exit) } }, expectFailure);
    });
  }
});
