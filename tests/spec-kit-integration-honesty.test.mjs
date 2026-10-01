/**
 * Honest Spec Kit integration — `docguard.spec-kit-integration-honesty`.
 *
 * Every defect here was reproduced against the real `specify` 1.0.13. The
 * stub below writes the files that CLI writes: `.specify/integration.json`,
 * the integration install manifest, the extension registry,
 * `.specify/extensions.yml` (copied from the packaged template, which
 * tests/hooks-contract.test.mjs keeps equal to Spec Kit's output), and the
 * extension commands in the integration's layout. Like the real CLI it
 * registers no command file for the `generic` integration.
 *
 * @req docguard.spec-kit-integration-honesty#FR-001
 * @req docguard.spec-kit-integration-honesty#FR-002
 * @req docguard.spec-kit-integration-honesty#FR-003
 * @req docguard.spec-kit-integration-honesty#FR-004
 * @req docguard.spec-kit-integration-honesty#FR-005
 * @req docguard.spec-kit-integration-honesty#FR-006
 * @req docguard.spec-kit-integration-honesty#FR-007
 * @req docguard.spec-kit-integration-honesty#FR-008
 * @req docguard.spec-kit-integration-honesty#FR-009
 * @req docguard.spec-kit-integration-honesty#FR-010
 * @req docguard.spec-kit-integration-honesty#FR-011
 * @req docguard.spec-kit-integration-honesty#SC-001
 * @req docguard.spec-kit-integration-honesty#SC-002
 * @req docguard.spec-kit-integration-honesty#SC-003
 * @req docguard.spec-kit-integration-honesty#SC-004
 * @req docguard.spec-kit-integration-honesty#SC-005
 * @req docguard.spec-kit-integration-honesty#SC-006
 */
import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { MIN_SPEC_KIT_VERSION, PACKAGED_EXTENSION_DIR, packagedExtensionVersion } from '../cli/spec-kit-delegation.mjs';
import { readAgentSurface, readExtensionCommands, verifyHooks, commandHint } from '../cli/agent-surface.mjs';
import { RELEASE_PATH_ALLOWLIST } from '../cli/release-pr-policy.mjs';

const ROOT = resolve('.');
const CLI = resolve('cli/docguard.mjs');
const PKG_VERSION = JSON.parse(readFileSync('package.json', 'utf-8')).version;
const posix = process.platform !== 'win32';

function stripAnsi(s) { return String(s).replace(/\x1B\[[0-9;]*[A-Za-z]/g, ''); }

const STUB = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SPECIFY_STUB_LOG, JSON.stringify(args) + '\\n');
const write = (rel, text) => { fs.mkdirSync(path.dirname(rel), { recursive: true }); fs.writeFileSync(rel, text); };
const readJson = (rel, fallback) => { try { return JSON.parse(fs.readFileSync(rel, 'utf8')); } catch { return fallback; } };
if (args[0] === '--version') { console.log('specify ' + (process.env.SPECIFY_STUB_VERSION || '1.0.13')); process.exit(0); }
if (args[0] === 'init' && args.includes('--help')) {
  for (const o of ['--here', '--force', '--integration', '--integration-options', '--non-interactive', '--ignore-agent-tools', '--script']) console.log('│ ' + o + ' │');
  process.exit(0);
}
function layout(key) {
  const st = readJson('.specify/integration.json', {});
  const dir = st.integration_settings?.generic?.parsed_options?.commands_dir || '.agent/commands/';
  if (key === 'claude') return id => '.claude/skills/speckit-' + id.replace(/\\./g, '-') + '/SKILL.md';
  if (key === 'gemini') return id => '.gemini/commands/speckit.' + id + '.toml';
  return id => path.posix.join(dir, 'speckit.' + id + '.md');
}
if (args[0] === 'init') {
  const key = args[args.indexOf('--integration') + 1];
  const optsAt = args.indexOf('--integration-options');
  const commandsDir = optsAt === -1 ? null : args[optsAt + 1].split(/\\s+/)[1];
  const settings = { [key]: { script: 'sh', invoke_separator: key === 'claude' ? '-' : '.' } };
  if (commandsDir) settings[key].parsed_options = { commands_dir: commandsDir };
  write('.specify/integration.json', JSON.stringify({ integration: key, default_integration: key, installed_integrations: [key], integration_settings: settings }));
  write('.specify/init-options.json', JSON.stringify({ ai: key, integration: key }));
  write('.specify/templates/spec-template.md', '# Spec\\n');
  write('.specify/memory/constitution.md', '# Constitution\\n');
  const files = {};
  for (const id of ['constitution', 'specify', 'plan']) { const rel = layout(key)(id); write(rel, '# ' + id + '\\n'); files[rel] = 'x'; }
  write('.specify/integrations/' + key + '.manifest.json', JSON.stringify({ integration: key, files }));
  process.exit(0);
}
if (args[0] === 'extension' && args[1] === 'add') {
  const dir = args[2];
  const registry = readJson('.specify/extensions/.registry', { extensions: {} });
  if (registry.extensions.docguard && !args.includes('--force')) { console.error('Error: Extension docguard is already installed'); process.exit(1); }
  const manifest = fs.readFileSync(path.join(dir, 'extension.yml'), 'utf8');
  const version = manifest.match(/^  version: "([^"]+)"/m)[1];
  const ids = [...manifest.matchAll(/- name: "speckit\\.(docguard\\.[a-z-]+)"\\n\\s+file: "([^"]+)"/g)];
  const key = readJson('.specify/integration.json', {}).default_integration;
  const registered = {};
  if (key !== 'generic') {
    registered[key] = ids.map(m => 'speckit.' + m[1]);
    for (const [, id, file] of ids) write(layout(key)(id), fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  const at = args.indexOf('--priority');
  registry.extensions.docguard = { version, enabled: true, priority: at === -1 ? 10 : Number(args[at + 1]), registered_commands: registered, registered_skills: [] };
  write('.specify/extensions/.registry', JSON.stringify(registry, null, 2));
  write('.specify/extensions.yml', fs.readFileSync(path.join(dir, 'templates/extensions.yml'), 'utf8'));
  process.exit(0);
}
process.exit(0);
`;

let binDir;
before(() => {
  binDir = mkdtempSync(join(tmpdir(), 'specify-honesty-stub-'));
  writeFileSync(join(binDir, 'specify'), STUB);
  chmodSync(join(binDir, 'specify'), 0o755);
  // `upgrade --apply` must never reach a real global install from a test.
  writeFileSync(join(binDir, 'npm'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(binDir, 'npm'), 0o755);
});
after(() => rmSync(binDir, { recursive: true, force: true }));

function project({ claude = false, specify = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'spec-kit-honesty-'));
  spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  if (claude) mkdirSync(join(dir, '.claude'));
  for (const [rel, value] of Object.entries(specify || {})) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), typeof value === 'string' ? value : JSON.stringify(value));
  }
  return dir;
}

function run(dir, args, env = {}) {
  const log = join(dir, '.stub-argv.log');
  writeFileSync(log, '');
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf-8', timeout: 120000,
    env: { ...process.env, NO_COLOR: '1', PATH: `${binDir}:${process.env.PATH}`, SPECIFY_STUB_LOG: log, ...env },
  });
  const calls = readFileSync(log, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  rmSync(log);
  return { out: stripAnsi(`${r.stdout}${r.stderr}`), status: r.status, calls };
}

const extensionCalls = calls => calls.filter(a => a[0] === 'extension');
const initCalls = calls => calls.filter(a => a[0] === 'init' && !a.includes('--help'));
const read = rel => readFileSync(join(ROOT, rel), 'utf-8');

/** Slash commands printed in `out` (`/speckit-…`, `/speckit.…`, `/docguard.…`). */
function slashTokens(out) {
  return [...new Set([...out.matchAll(/(?:^|[\s(`])(\/(?:speckit|docguard)[.-][a-z][a-z.-]*[a-z])/gm)].map(m => m[1]))];
}

describe('mandatory hooks resolve before init calls them active (FR-001, FR-002, SC-001)', { skip: !posix && 'POSIX stub' }, () => {
  it('generic: writes every declared command next to the generic commands, so both mandatory hooks resolve', () => {
    const dir = project();
    try {
      const { out } = run(dir, ['init', '--skip-prompts']);
      for (const { id, file } of readExtensionCommands()) {
        const dest = join(dir, '.agent/commands', `speckit.${id}.md`);
        assert.ok(existsSync(dest), `${dest} missing:\n${out}`);
        assert.equal(readFileSync(dest, 'utf-8'), readFileSync(join(PACKAGED_EXTENSION_DIR, file), 'utf-8'));
      }
      assert.match(out, /Workflow hooks active \(before_specify → \/speckit\.docguard\.brief,.*before_tasks → \/speckit\.docguard\.preflight\)/);
      assert.equal(verifyHooks(dir).status, 'active');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a missing hook command file is reported by name, never as active', () => {
    const dir = project({ claude: true });
    try {
      run(dir, ['init', '--skip-prompts']);
      rmSync(join(dir, '.claude/skills/speckit-docguard-preflight'), { recursive: true });
      const { out, calls } = run(dir, ['init', '--skip-prompts']);
      assert.equal(extensionCalls(calls).length, 0, 'an equal version must not re-register');
      assert.doesNotMatch(out, /Workflow hooks active/);
      assert.match(out, /Workflow hooks are NOT active/);
      assert.match(out, /speckit\.docguard\.preflight \(before_tasks\) — expected \.claude\/skills\/speckit-docguard-preflight\/SKILL\.md/);
      assert.doesNotMatch(out, /speckit\.docguard\.brief \(before_specify\)/, 'a resolved hook is not listed as missing');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('Claude: confirms hooks against the skills Spec Kit registered', () => {
    const dir = project({ claude: true });
    try {
      const { out } = run(dir, ['init', '--skip-prompts']);
      assert.match(out, /Workflow hooks active \(before_specify → \/speckit-docguard-brief/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a generic commands directory outside the project writes nothing and the hooks stay unverified', () => {
    const dir = project({
      specify: {
        '.specify/integration.json': { default_integration: 'generic', integration_settings: { generic: { parsed_options: { commands_dir: '../outside/' } } } },
        '.specify/integrations/generic.manifest.json': { files: { '../outside/speckit.constitution.md': 'x' } },
        '.specify/extensions/.registry': { extensions: { docguard: { version: packagedExtensionVersion(), enabled: true } } },
        '.specify/extensions.yml': read('extensions/spec-kit-docguard/templates/extensions.yml'),
      },
    });
    try {
      const { out } = run(dir, ['init', '--skip-prompts']);
      assert.equal(existsSync(join(dir, '..', 'outside')), false);
      assert.match(out, /Workflow hooks not verified/);
      assert.doesNotMatch(out, /Workflow hooks active/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the registered extension follows the CLI (FR-003, SC-002)', { skip: !posix && 'POSIX stub' }, () => {
  function registered(version, extra = {}) {
    const dir = project({ claude: true });
    run(dir, ['init', '--skip-prompts']);
    const reg = join(dir, '.specify/extensions/.registry');
    const parsed = JSON.parse(readFileSync(reg, 'utf-8'));
    Object.assign(parsed.extensions.docguard, { version, ...extra });
    writeFileSync(reg, JSON.stringify(parsed));
    return dir;
  }

  it('re-registers an older version once, keeping its priority, and reports both versions', () => {
    const dir = registered('0.40.0', { priority: 7 });
    try {
      const { out, calls } = run(dir, ['init', '--skip-prompts']);
      assert.deepEqual(extensionCalls(calls), [['extension', 'add', PACKAGED_EXTENSION_DIR, '--dev', '--force', '--priority', '7']]);
      assert.ok(out.includes(`DocGuard extension updated in Spec Kit (0.40.0 → ${packagedExtensionVersion()})`), out);
      const after = JSON.parse(readFileSync(join(dir, '.specify/extensions/.registry'), 'utf-8'));
      assert.equal(after.extensions.docguard.version, packagedExtensionVersion());
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('makes no registration call when the version already matches', () => {
    const dir = registered(packagedExtensionVersion());
    try {
      const { out, calls } = run(dir, ['init', '--skip-prompts']);
      assert.deepEqual(extensionCalls(calls), []);
      assert.match(out, /DocGuard extension already registered/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('leaves a disabled registration disabled and names the command that re-enables it', () => {
    const dir = registered('0.40.0', { enabled: false });
    try {
      const { out, calls } = run(dir, ['init', '--skip-prompts']);
      assert.deepEqual(extensionCalls(calls), []);
      assert.match(out, /registered but disabled .*specify extension enable docguard/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('upgrade reports and --apply refreshes agent files (FR-004)', { skip: !posix && 'POSIX stub' }, () => {
  it('reports stale files without writing; --apply refreshes them and the extension', () => {
    const dir = project({ claude: true });
    try {
      run(dir, ['init', '--skip-prompts']);
      const skill = join(dir, '.claude/skills/docguard-guard/SKILL.md');
      const bundled = readFileSync(skill, 'utf-8');
      writeFileSync(skill, '# an older DocGuard skill\n');
      const reg = join(dir, '.specify/extensions/.registry');
      const parsed = JSON.parse(readFileSync(reg, 'utf-8'));
      parsed.extensions.docguard.version = '0.40.0';
      writeFileSync(reg, JSON.stringify(parsed));

      const check = run(dir, ['upgrade']);
      assert.match(check.out, /Agent\s+files:\s+1 out of date; Spec Kit extension v0\.40\.0/);
      assert.equal(readFileSync(skill, 'utf-8'), '# an older DocGuard skill\n', 'upgrade without --apply writes nothing');
      assert.deepEqual(extensionCalls(check.calls), []);

      // The stub npm fails, so this run never installs a new CLI and the
      // refresh uses this package's files whatever npm's latest is.
      const apply = run(dir, ['upgrade', '--apply']);
      assert.equal(readFileSync(skill, 'utf-8'), bundled, apply.out);
      assert.equal(extensionCalls(apply.calls).length, 1, apply.out);
      assert.match(apply.out, /Agent files refreshed/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('command files pin the release they ship with (FR-005, SC-003)', () => {
  const files = [
    ...readdirSync('extensions/spec-kit-docguard/commands').map(f => `extensions/spec-kit-docguard/commands/${f}`),
    ...readdirSync('commands').filter(f => /^docguard\.[a-z-]+\.md$/.test(f)).map(f => `commands/${f}`),
    ...readdirSync('extensions/spec-kit-docguard/skills').map(d => `extensions/spec-kit-docguard/skills/${d}/SKILL.md`),
  ];

  it('every file states the runner rule with a pin equal to package.json', () => {
    assert.ok(files.length >= 21, files.join('\n'));
    for (const rel of files) {
      const text = read(rel);
      assert.match(text, /## Running DocGuard\n\nRun `docguard` from PATH when it is installed\. Otherwise run\n`npx --yes docguard-cli@(\d+\.\d+\.\d+)`/, rel);
      for (const [, version] of text.matchAll(/docguard-cli@(\S+?)[`)\s]/g)) assert.equal(version, PKG_VERSION, rel);
      assert.doesNotMatch(text, /@latest/, rel);
      assert.doesNotMatch(text, /npx (?:--yes )?docguard-cli(?!@)/, rel);
    }
  });

  it('the release candidate policy admits every file the version sync rewrites', () => {
    for (const rel of files) assert.match(rel, RELEASE_PATH_ALLOWLIST, rel);
  });
});

describe('hints name only commands that exist (FR-006, SC-004)', { skip: !posix && 'POSIX stub' }, () => {
  function assertResolvable(dir, out, label) {
    const surface = readAgentSurface(dir);
    for (const token of slashTokens(out)) {
      const ok = token.startsWith('/docguard.')
        ? Boolean(surface.commandsDir) && existsSync(join(dir, surface.commandsDir, `${token.slice(1)}.md`))
        : Boolean(surface.layout) && existsSync(join(dir, surface.layout.pathFor(token.replace(/^\/speckit[.-]/, ''))));
      assert.ok(ok, `${label}: ${token} names no installed command\n${out}`);
    }
  }

  it('Claude: guard, diagnose, verify and init print the hyphenated skills or the CLI', () => {
    const dir = project({ claude: true });
    try {
      const init = run(dir, ['init', '--skip-prompts']);
      assert.match(init.out, /1\. \/speckit-constitution/);
      assert.match(init.out, /\/speckit-docguard-fix --doc architecture/);
      const guard = run(dir, ['guard']);
      assert.match(guard.out, /Next: (run )?\/speckit-docguard-(diagnose|score)/);
      assert.match(guard.out, /docguard feedback|Next:/);
      const diagnose = run(dir, ['diagnose']);
      const verify = run(dir, ['verify', '--semantic']);
      for (const [label, out] of [['init', init.out], ['guard', guard.out], ['diagnose', diagnose.out], ['verify', verify.out]]) {
        assert.doesNotMatch(out, /\/docguard\.(diagnose|verify|feedback|init|explain)\b/, label);
        assertResolvable(dir, out, label);
      }
      const jsonOut = run(dir, ['diagnose', '--format', 'json']).out;
      const json = JSON.parse(jsonOut.slice(jsonOut.indexOf('{')));
      for (const issue of json.issues || []) {
        if (issue.llmCommand) assertResolvable(dir, ` ${issue.llmCommand}`, 'diagnose --format json');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('without Spec Kit: /docguard.<name> only for the commands DocGuard installed, the CLI otherwise', () => {
    const dir = project();
    try {
      run(dir, ['init', '--skip-prompts', '--no-spec-kit']);
      const surface = readAgentSurface(dir);
      assert.equal(commandHint(dir, surface, 'guard'), '/docguard.guard');
      assert.equal(commandHint(dir, surface, 'diagnose'), 'docguard diagnose');
      assert.equal(commandHint(dir, surface, 'verify', '--semantic'), 'docguard verify --semantic');
      const guard = run(dir, ['guard']);
      assertResolvable(dir, guard.out, 'guard');
      assert.doesNotMatch(guard.out, /\/docguard\.diagnose/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('no agent files at all: every hint is a CLI command', () => {
    const dir = project();
    try {
      assert.equal(commandHint(dir, readAgentSurface(dir), 'guard'), 'docguard guard');
      assert.equal(commandHint(dir, readAgentSurface(dir), 'fix', '--doc architecture'), 'docguard fix --doc architecture');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('--no-spec-kit and --spec-kit are documented and do what they say (FR-007)', { skip: !posix && 'POSIX stub' }, () => {
  it('--no-spec-kit calls no specify and still installs DocGuard\'s skills', () => {
    const dir = project();
    try {
      const { calls } = run(dir, ['init', '--skip-prompts', '--no-spec-kit']);
      assert.deepEqual(calls, []);
      assert.equal(existsSync(join(dir, '.specify')), false);
      assert.ok(existsSync(join(dir, '.agent/skills/docguard-guard/SKILL.md')));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('init --help lists both flags', () => {
    const { out } = run(ROOT, ['init', '--help']);
    assert.match(out, /--no-spec-kit\s+Skip Spec Kit/);
    assert.match(out, /--spec-kit\s+With --profile starter/);
  });
});

describe('one Spec Kit floor (FR-008, SC-006)', { skip: !posix && 'POSIX stub' }, () => {
  it('the constant is the manifest floor, and the docs state the same one', () => {
    const floor = read('extensions/spec-kit-docguard/extension.yml').match(/speckit_version:\s*">=([\d.]+)"/)[1];
    assert.equal(MIN_SPEC_KIT_VERSION, floor);
    assert.ok(read('README.md').includes(`Spec Kit ≥ ${floor}`), 'README');
    assert.ok(read('docs-canonical/ENVIRONMENT.md').includes(`≥ ${floor}`), 'ENVIRONMENT');
    assert.ok(read('docs-canonical/ARCHITECTURE.md').includes(`Spec Kit ≥ ${floor}`), 'ARCHITECTURE');
    for (const rel of ['README.md', 'docs-canonical/ENVIRONMENT.md', 'docs-canonical/ARCHITECTURE.md']) {
      assert.doesNotMatch(read(rel), /Spec Kit[^.\n]{0,40}≥\s?0\.10\.0/, rel);
    }
  });

  it('a specify below the floor is neither initialized nor registered', () => {
    const dir = project({ claude: true });
    try {
      const { out, calls } = run(dir, ['init', '--skip-prompts'], { SPECIFY_STUB_VERSION: '0.11.1' });
      assert.deepEqual(initCalls(calls), []);
      assert.deepEqual(extensionCalls(calls), []);
      assert.ok(out.includes(`specify 0.11.1 is older than the Spec Kit ${MIN_SPEC_KIT_VERSION}`), out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('an already-initialized project on an old specify is not registered either', () => {
    const dir = project({ claude: true, specify: { '.specify/integration.json': { default_integration: 'claude' } } });
    try {
      const { out, calls } = run(dir, ['init', '--skip-prompts'], { SPECIFY_STUB_VERSION: '0.10.4' });
      assert.deepEqual(extensionCalls(calls), []);
      assert.match(out, /DocGuard extension not registered: specify 0\.10\.4 is older/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('agent files go where the agent reads them, and counts are honest (FR-009, FR-010, SC-005)', { skip: !posix && 'POSIX stub' }, () => {
  it('Claude: skills in .claude/skills, no .agent/, and Spec Kit\'s files counted one by one', () => {
    const dir = project({ claude: true });
    try {
      const { out } = run(dir, ['init', '--skip-prompts']);
      assert.ok(existsSync(join(dir, '.claude/skills/docguard-guard/SKILL.md')), out);
      assert.equal(existsSync(join(dir, '.agent')), false, '.agent/ is not read by Claude Code');
      let expected = 0;
      const walk = rel => {
        for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
          if (e.isDirectory()) walk(`${rel}/${e.name}`); else expected++;
        }
      };
      walk('.specify');
      expected += 3; // constitution, specify, plan skills from the integration manifest
      expected += readExtensionCommands().length;
      assert.match(out, new RegExp(`Spec Kit: ${expected} files written by specify`));
      assert.match(out, /Agent files: 5 installed or updated/);
      assert.match(out, /Created: 11 DocGuard files/);
      assert.doesNotMatch(out, /\.specify\/ \(spec-kit foundation\)/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a commands-style integration gets no DocGuard skill copies, and says why', () => {
    const dir = project({
      specify: {
        '.specify/integration.json': { default_integration: 'gemini' },
        '.specify/integrations/gemini.manifest.json': { files: { '.gemini/commands/speckit.constitution.toml': 'x' } },
      },
    });
    try {
      const { out } = run(dir, ['init', '--skip-prompts']);
      assert.equal(existsSync(join(dir, '.agent')), false);
      assert.ok(existsSync(join(dir, '.gemini/commands/speckit.docguard.guard.toml')), out);
      assert.match(out, /DocGuard's own skills are not copied: the gemini integration reads commands/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('a second init writes no agent file again', () => {
    const dir = project({ claude: true });
    try {
      run(dir, ['init', '--skip-prompts']);
      const skill = join(dir, '.claude/skills/docguard-guard/SKILL.md');
      const mtime = statSync(skill).mtimeMs;
      const { out } = run(dir, ['init', '--skip-prompts']);
      assert.doesNotMatch(out, /Agent files:/);
      assert.equal(statSync(skill).mtimeMs, mtime);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('the docs describe the integration as it behaves (FR-011)', () => {
  it('README, commands reference, extension README, architecture, environment and changelog', () => {
    const readme = read('README.md');
    assert.match(readme, /\| `--no-spec-kit` \| Skip Spec Kit: no `specify` call and no `\.specify\/`; DocGuard's own agent skills still install \| init \|/);
    assert.match(readme, /\| `--spec-kit` \|/);
    assert.match(readme, /re-registers it when the versions differ/);
    assert.match(readme, /`npx --yes docguard-cli@<version>`/);
    assert.match(readme, /\.claude\/skills\//);
    const commands = read('docs/commands.md');
    assert.match(commands, /--no-spec-kit/);
    assert.match(commands, /upgrade --apply[^\n]*agent files/i);
    assert.match(read('extensions/spec-kit-docguard/README.md'), /npx --yes docguard-cli@<version>/);
    assert.match(read('docs-canonical/ARCHITECTURE.md'), /cli\/agent-surface\.mjs/);
    const unreleased = read('CHANGELOG.md').split(/^## \[/m)[1];
    assert.match(unreleased, /^Unreleased\]/);
    assert.match(unreleased, /spec 048/);
  });
});
