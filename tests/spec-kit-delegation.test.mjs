/**
 * Spec Kit init delegation — `docguard.specify-init-delegation`.
 *
 * Spec Kit 0.10 removed `--ai`, `--ai-skills`, `--ai-commands-dir` and
 * `--no-git`. DocGuard kept passing them, every delegation failed, and the
 * failure was swallowed. These tests drive the real CLI against a stub
 * `specify` placed first on PATH, so the subprocess contract is exercised end
 * to end rather than mocked.
 *
 * Stub modes (SPECIFY_STUB_MODE):
 *   current      — accepts the integration model, rejects removed options
 *   legacy-help  — `init --help` lists no --integration (pre-0.7 CLI)
 *   fail-init    — init exits 1 with a marker message
 *   fail-ext     — init succeeds, `extension add` exits 1
 *   hang         — init sleeps past DocGuard's timeout
 *
 * @req docguard.specify-init-delegation#FR-001
 * @req docguard.specify-init-delegation#FR-002
 * @req docguard.specify-init-delegation#FR-003
 * @req docguard.specify-init-delegation#FR-004
 * @req docguard.specify-init-delegation#FR-007
 * @req docguard.specify-init-delegation#FR-008
 * @req docguard.specify-init-delegation#FR-009
 * @req docguard.specify-init-delegation#FR-010
 * @req docguard.specify-init-delegation#FR-012
 * @req docguard.specify-init-delegation#FR-011
 * @req docguard.specify-init-delegation#FR-013
 * @req docguard.specify-init-delegation#SC-001
 * @req docguard.specify-init-delegation#SC-002
 * @req docguard.specify-init-delegation#SC-003
 * @req docguard.specify-init-delegation#SC-004
 * @req docguard.specify-init-delegation#SC-005
 */
import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = resolve('cli/docguard.mjs');
const posix = process.platform !== 'win32';

function stripAnsi(s) { return s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, ''); }

const STUB = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const mode = process.env.SPECIFY_STUB_MODE || 'current';
fs.appendFileSync(process.env.SPECIFY_STUB_LOG, JSON.stringify(args) + '\\n');
const REMOVED = ['--ai', '--ai-skills', '--ai-commands-dir', '--no-git'];
if (args[0] === 'init' && args.includes('--help')) {
  const opts = mode === 'legacy-help'
    ? ['--ai', '--ai-skills', '--no-git', '--here', '--force', '--script']
    : ['--script', '--ignore-agent-tools', '--here', '--force', '--non-interactive', '--integration', '--integration-options'];
  console.log('\\u001b[1m Usage: specify init [OPTIONS]\\u001b[0m');
  for (const o of opts) console.log('│ ' + o + '   some help text │');
  process.exit(0);
}
if (args[0] === 'init') {
  const bad = args.find(a => REMOVED.includes(a));
  if (bad) { console.error('╭─ Error ─╮\\n│ No such option: ' + bad + ' │'); process.exit(2); }
  if (mode === 'fail-init') { console.error('Error: STUB-INIT-FAILURE-MARKER'); process.exit(1); }
  if (mode === 'hang') { setTimeout(() => {}, 120000); return; }
  const key = args[args.indexOf('--integration') + 1];
  fs.mkdirSync('.specify', { recursive: true });
  fs.writeFileSync('.specify/integration.json', JSON.stringify({ default_integration: key, installed_integrations: [key] }));
  fs.writeFileSync('.specify/init-options.json', JSON.stringify({ ai: key, integration: key }));
  process.exit(0);
}
if (args[0] === 'extension' && args[1] === 'add') {
  if (mode === 'fail-ext') { console.error('Error: STUB-EXT-FAILURE-MARKER'); process.exit(1); }
  fs.mkdirSync('.specify/extensions', { recursive: true });
  fs.writeFileSync('.specify/extensions/.registry', JSON.stringify({ extensions: { docguard: { version: 'x' } } }));
  process.exit(0);
}
process.exit(0);
`;

let stubDir;
before(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'specify-stub-'));
  writeFileSync(join(stubDir, 'specify'), STUB);
  chmodSync(join(stubDir, 'specify'), 0o755);
});
after(() => { rmSync(stubDir, { recursive: true, force: true }); });

function fixture({ claude = true, specify = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'spec-kit-deleg-'));
  spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  if (claude) writeFileSync(join(dir, 'CLAUDE.md'), '# Agent\n');
  if (specify) {
    mkdirSync(join(dir, '.specify'), { recursive: true });
    for (const [name, value] of Object.entries(specify)) {
      writeFileSync(join(dir, '.specify', name), typeof value === 'string' ? value : JSON.stringify(value));
    }
  }
  return dir;
}

function run(dir, command, mode = 'current', extraEnv = {}) {
  const log = join(dir, '.stub-argv.log');
  writeFileSync(log, '');
  const r = spawnSync(process.execPath, [CLI, ...command], {
    cwd: dir,
    encoding: 'utf-8',
    timeout: 120000,
    env: {
      ...process.env,
      NO_COLOR: '1',
      PATH: `${stubDir}:${process.env.PATH}`,
      SPECIFY_STUB_MODE: mode,
      SPECIFY_STUB_LOG: log,
      ...extraEnv,
    },
  });
  const calls = readFileSync(log, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  return { out: stripAnsi(`${r.stdout}${r.stderr}`), status: r.status, calls };
}

const initCall = calls => calls.find(a => a[0] === 'init' && !a.includes('--help'));

describe('Spec Kit delegation against a current specify CLI', { skip: !posix && 'POSIX stub' }, () => {
  it('initializes Spec Kit with --integration and no removed option (SC-005)', () => {
    const dir = fixture();
    try {
      const { out, calls } = run(dir, ['init', '--skip-prompts']);
      const call = initCall(calls);
      assert.ok(call, `specify init was never invoked:\n${out}`);
      assert.deepEqual(call.filter(a => ['--ai', '--ai-skills', '--ai-commands-dir', '--no-git'].includes(a)), []);
      assert.equal(call[call.indexOf('--integration') + 1], 'claude');
      assert.ok(call.includes('--non-interactive'), 'must never fall through to Spec Kit\'s default agent');
      assert.ok(existsSync(join(dir, '.specify/integration.json')), out);
      assert.match(out, /Spec Kit initialized.*claude/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('registers the packaged DocGuard extension from a local directory (FR-010)', () => {
    const dir = fixture();
    try {
      const { out, calls } = run(dir, ['init', '--skip-prompts']);
      const add = calls.find(a => a[0] === 'extension' && a[1] === 'add');
      assert.ok(add, out);
      assert.ok(add.includes('--dev'));
      assert.equal(add[2], resolve('extensions/spec-kit-docguard'));
      assert.match(out, /DocGuard extension registered/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('skips registration when the registry already lists docguard', () => {
    const dir = fixture({ specify: { 'integration.json': { default_integration: 'claude' } } });
    mkdirSync(join(dir, '.specify/extensions'), { recursive: true });
    writeFileSync(join(dir, '.specify/extensions/.registry'), JSON.stringify({ extensions: { docguard: {} } }));
    try {
      const { out, calls } = run(dir, ['init', '--skip-prompts']);
      assert.equal(initCall(calls), undefined, 'an initialized project must not be re-initialized');
      assert.equal(calls.find(a => a[0] === 'extension'), undefined);
      assert.match(out, /already registered/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('registers the extension in a project Spec Kit already initialized', () => {
    const dir = fixture({ specify: { 'integration.json': { default_integration: 'codex' } } });
    try {
      const { out, calls } = run(dir, ['init', '--skip-prompts']);
      assert.equal(initCall(calls), undefined);
      assert.ok(calls.find(a => a[0] === 'extension' && a[1] === 'add'), out);
      assert.match(out, /Spec Kit already initialized.*codex/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('uses the generic integration pointed at .agent/commands when no agent signal exists (FR-004)', () => {
    const dir = fixture({ claude: false });
    try {
      const { out, calls } = run(dir, ['init', '--skip-prompts']);
      const call = initCall(calls);
      assert.ok(call, out);
      assert.equal(call[call.indexOf('--integration') + 1], 'generic');
      const opt = call[call.indexOf('--integration-options') + 1];
      assert.equal(opt, '--commands-dir .agent/commands/');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not treat the shared .agents/ directory as a single agent', () => {
    const dir = fixture({ claude: false });
    mkdirSync(join(dir, '.agents/skills'), { recursive: true });
    try {
      const { calls } = run(dir, ['init', '--skip-prompts']);
      const call = initCall(calls);
      assert.equal(call[call.indexOf('--integration') + 1], 'generic');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('Spec Kit delegation failures are reported, never swallowed', { skip: !posix && 'POSIX stub' }, () => {
  it('prints the CLI error text and the manual command when init fails (FR-007, SC-002)', () => {
    const dir = fixture();
    try {
      const { out } = run(dir, ['init', '--skip-prompts'], 'fail-init');
      assert.match(out, /STUB-INIT-FAILURE-MARKER/);
      assert.match(out, /specify init --here --force .*--integration claude/);
      assert.doesNotMatch(out, /Spec Kit initialized/);
      assert.doesNotMatch(out, /\.specify\/ \(spec-kit foundation\)/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports a CLI without the integration model as unsupported and does not invoke init (FR-002)', () => {
    const dir = fixture();
    try {
      const { out, calls } = run(dir, ['init', '--skip-prompts'], 'legacy-help');
      assert.equal(initCall(calls), undefined);
      assert.match(out, /0\.10\.0/);
      assert.match(out, /specify self upgrade|uv tool install specify-cli/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports registration failure separately from a successful init', () => {
    const dir = fixture();
    try {
      const { out } = run(dir, ['init', '--skip-prompts'], 'fail-ext');
      assert.match(out, /Spec Kit initialized/);
      assert.match(out, /STUB-EXT-FAILURE-MARKER/);
      assert.match(out, /specify extension add .*--dev/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('times out a hanging CLI and reports failure (FR-012)', () => {
    const dir = fixture();
    try {
      const { out } = run(dir, ['init', '--skip-prompts'], 'hang', { DOCGUARD_SPECIFY_TIMEOUT_MS: '1500' });
      assert.match(out, /timed out/i);
      assert.doesNotMatch(out, /Spec Kit initialized/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('never prints a hardcoded skill count (FR-008, SC-004)', () => {
    for (const mode of ['current', 'fail-init']) {
      const dir = fixture();
      try {
        const { out } = run(dir, ['init', '--skip-prompts'], mode);
        assert.doesNotMatch(out, /\b\d+ (AI |Spec Kit AI )?skills\b/, `mode ${mode}:\n${out}`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });
});

describe('DocGuard\'s own skills still install without Spec Kit (FR-011)', { skip: !posix && 'POSIX stub' }, () => {
  it('--no-spec-kit installs .agent/ skills and never invokes specify', () => {
    const dir = fixture();
    try {
      const { calls } = run(dir, ['init', '--skip-prompts', '--no-spec-kit']);
      assert.deepEqual(calls, []);
      assert.ok(existsSync(join(dir, '.agent/skills/docguard-guard/SKILL.md')));
      assert.equal(existsSync(join(dir, '.specify')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('only an explicit init may initialize Spec Kit (FR-009)', { skip: !posix && 'POSIX stub' }, () => {
  for (const command of [['sync'], ['fix', '--doc', 'architecture'], ['diagnose']]) {
    it(`docguard ${command[0]} never invokes specify init`, () => {
      const dir = fixture();
      try {
        const { calls } = run(dir, command);
        assert.equal(initCall(calls), undefined);
        assert.equal(existsSync(join(dir, '.specify')), false);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  }
});
