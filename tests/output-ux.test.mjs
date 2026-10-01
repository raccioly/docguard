/**
 * Truthful, machine-clean command output (specs/049-output-ux).
 *
 * Every test builds its own temporary project and reproduces one reported
 * defect: machine stdout polluted by notes and banners, colour in pipes, a
 * sync loop whose advice does not work, `upgrade` describing one of its two
 * jobs, smart init writing no config, a shared validator key, ownership roots
 * and ties, instruction lookups that miss nested files and Claude Code
 * imports, and a handful of small defects.
 *
 * @req docguard.output-ux#FR-001
 * @req docguard.output-ux#FR-002
 * @req docguard.output-ux#FR-003
 * @req docguard.output-ux#FR-004
 * @req docguard.output-ux#FR-005
 * @req docguard.output-ux#FR-006
 * @req docguard.output-ux#FR-007
 * @req docguard.output-ux#FR-008
 * @req docguard.output-ux#FR-009
 * @req docguard.output-ux#FR-010
 * @req docguard.output-ux#FR-011
 * @req docguard.output-ux#FR-012
 * @req docguard.output-ux#FR-013
 * @req docguard.output-ux#FR-014
 * @req docguard.output-ux#FR-015
 * @req docguard.output-ux#FR-016
 * @req docguard.output-ux#FR-017
 * @req docguard.output-ux#FR-018
 * @req docguard.output-ux#SC-001
 * @req docguard.output-ux#SC-002
 * @req docguard.output-ux#SC-003
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { devNull, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { colorEnabled } from '../cli/shared.mjs';
import { BLOCKER_CODES, CODES } from '../cli/findings.mjs';
import { runExplain } from '../cli/commands/explain.mjs';
import { runUpgrade } from '../cli/commands/upgrade.mjs';
import { autoDetectProjectType } from '../cli/config.mjs';
import { docsForPath, docStructure } from '../cli/scanners/doc-references.mjs';
import { rulesFor } from '../cli/commands/rules.mjs';
import { validatePathScopedRules } from '../cli/validators/path-scoped-rules.mjs';
import { createContext, fingerprint } from '../cli/scanners/doc-deps.mjs';
import { validateReferenceExistence } from '../cli/validators/reference-existence.mjs';
import { notesSince } from './fixtures/changelog-notes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const BASE_ENV = { ...process.env, DOCGUARD_NO_UPDATE_HINT: '1', GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1' };
delete BASE_ENV.NO_COLOR;
delete BASE_ENV.FORCE_COLOR;
const ANSI = /\x1b\[/;

function project(t, files = {}, { git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-049-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) write(dir, path, content);
  if (git) {
    run(dir, 'git', ['init', '-q']);
    run(dir, 'git', ['config', 'user.email', 't@example.com']);
    run(dir, 'git', ['config', 'user.name', 'T']);
    commit(dir, 'initial');
  }
  return dir;
}

function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

function run(dir, cmd, args) {
  return execFileSync(cmd, args, { cwd: dir, encoding: 'utf8', env: BASE_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
}

function commit(dir, message) {
  run(dir, 'git', ['add', '-A']);
  spawnSync('git', ['commit', '-qm', message, '--allow-empty'], { cwd: dir, env: BASE_ENV });
}

function cli(dir, args, { env = {}, input = '' } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', env: { ...BASE_ENV, ...env }, input, timeout: 120_000,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: `${r.stdout || ''}${r.stderr || ''}` };
}

const json = r => JSON.parse(r.stdout);
const config = (extra = {}) => `${JSON.stringify({ projectName: 'fixture', version: '0.6', profile: 'standard', ...extra }, null, 2)}\n`;

// ── FR-001, SC-001: machine stdout holds only the artifact ─────────────────

describe('machine output parses (FR-001, SC-001)', () => {
  function initialised(t) {
    const dir = project(t, {
      'package.json': '{"name":"fixture","version":"1.0.0"}\n',
      'src/index.js': 'export const a = 1;\n',
    });
    cli(dir, ['init', '--skip-prompts', '--no-spec-kit']);
    commit(dir, 'docs');
    write(dir, 'src/b.js', 'export const b = 2;\n');
    commit(dir, 'b');
    return dir;
  }

  it('every documented --format json|sarif|junit invocation, with and without --changed-only', t => {
    const dir = initialised(t);
    const cases = [
      ['guard', '--format', 'json'], ['guard', '--changed-only', '--format', 'json'],
      ['guard', '--changed-only', '--compact', '--format', 'json'],
      ['guard', '--format', 'sarif'], ['guard', '--changed-only', '--format', 'sarif'],
      ['guard', '--changed-only', '--format', 'junit'], ['guard', '--format', 'junit'],
      ['score', '--format', 'json'], ['ci', '--format', 'json'], ['diff', '--format', 'json'],
      ['sync', '--format', 'json'], ['trace', '--format', 'json'], ['trace', '--owners', '--format', 'json'],
      ['memory', '--format', 'json'], ['verify', '--evidence', '--format', 'json'],
      ['retire', '--plan', '--format', 'json'], ['specs', '--format', 'json'], ['review', '--format', 'json'],
      ['rules', '--for', 'src/index.js', '--format', 'json'], ['reconcile', '--since', 'HEAD~1', '--format', 'json'],
      ['agent', '--format', 'json'], ['generate', '--plan', '--format', 'json'], ['explain', 'STR001', '--format', 'json'],
      ['report', '--format', 'json'], ['diagnose', '--format', 'json'], ['fix', '--format', 'json'],
      ['fix', '--doc', 'architecture', '--format', 'json'],
    ];
    const bad = [];
    for (const args of cases) {
      const r = cli(dir, args);
      if (args.includes('junit')) {
        if (!r.stdout.startsWith('<?xml')) bad.push(`${args.join(' ')} :: ${r.stdout.slice(0, 80)}`);
        continue;
      }
      try { JSON.parse(r.stdout); } catch { bad.push(`${args.join(' ')} :: ${JSON.stringify(r.stdout.slice(0, 80))}`); }
    }
    assert.deepEqual(bad, []);
  });

  it('the --changed-only note moves to stderr in machine formats and stays on stdout in text', t => {
    const dir = initialised(t);
    const machine = cli(dir, ['guard', '--changed-only', '--format', 'json']);
    assert.match(machine.stderr, /--changed-only \(1 file\(s\) changed since HEAD~1\)/);
    const text = cli(dir, ['guard', '--changed-only']);
    assert.match(text.stdout, /--changed-only \(1 file\(s\) changed since HEAD~1\)/);
  });

  it('--stdout prints the artifact without the banner', t => {
    const dir = initialised(t);
    for (const args of [['memory', '--pack', '--stdout'], ['llms', '--stdout']]) {
      const r = cli(dir, args);
      assert.doesNotMatch(r.stdout, /Canonical-Driven Development \(CDD\)/, args.join(' '));
      assert.ok(r.stdout.trim().length > 0, args.join(' '));
    }
  });

  it('fix --doc --format json returns the prompt as JSON', t => {
    const dir = initialised(t);
    const data = json(cli(dir, ['fix', '--doc', 'architecture', '--format', 'json']));
    assert.equal(data.doc, 'docs-canonical/ARCHITECTURE.md');
    assert.match(data.prompt, /TASK: .* the file docs-canonical\/ARCHITECTURE\.md/);
  });
});

// ── FR-002: colour follows the terminal ─────────────────────────────────────

describe('colour (FR-002)', () => {
  it('NO_COLOR, FORCE_COLOR and the TTY decide', () => {
    const tty = { isTTY: true };
    const pipe = { isTTY: false };
    assert.equal(colorEnabled({}, tty), true);
    assert.equal(colorEnabled({}, pipe), false);
    assert.equal(colorEnabled({ NO_COLOR: '1' }, tty), false);
    assert.equal(colorEnabled({ NO_COLOR: '' }, tty), true, 'an empty NO_COLOR does not count');
    assert.equal(colorEnabled({ FORCE_COLOR: '1' }, pipe), true);
    assert.equal(colorEnabled({ FORCE_COLOR: '' }, pipe), true, 'FORCE_COLOR set without a value forces colour');
    assert.equal(colorEnabled({ FORCE_COLOR: '0' }, tty), false);
    assert.equal(colorEnabled({ FORCE_COLOR: '1', NO_COLOR: '1' }, pipe), true, 'FORCE_COLOR wins, as in Node');
  });

  it('a piped run prints no escape codes unless FORCE_COLOR is set', t => {
    const dir = project(t, { 'package.json': '{"name":"x"}\n' }, { git: false });
    assert.doesNotMatch(cli(dir, ['explain', 'STR001']).out, ANSI);
    assert.doesNotMatch(cli(dir, ['explain', 'STR001'], { env: { NO_COLOR: '1' } }).out, ANSI);
    assert.match(cli(dir, ['explain', 'STR001'], { env: { FORCE_COLOR: '1' } }).stdout, ANSI);
  });
});

// ── FR-003–FR-005: the sync loop ends ───────────────────────────────────────

const SERVER_V1 = "import express from 'express';\nconst app = express();\napp.get('/users', (q, r) => r.json([]));\nexport default app;\n";
const SERVER_V2 = "import express from 'express';\nimport { q } from './util.js';\nconst app = express();\napp.get('/users', (q, r) => r.json([]));\napp.post('/orders', (q, r) => r.json([]));\nexport default app;\n";

/** Generated docs with their markers removed, then a code change: GST002's starting point. */
function unmarkedStale(t) {
  const dir = project(t, {
    'package.json': '{"name":"x","version":"1.0.0","dependencies":{"express":"4.0.0"}}\n',
    'src/server.js': SERVER_V1,
    '.docguard.json': config(),
  });
  cli(dir, ['generate', '--plan', '--write']);
  for (const name of readdirSync(join(dir, 'docs-canonical'))) {
    const path = join(dir, 'docs-canonical', name);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/<!--\s*docguard:generated true\s*-->\n?/, ''));
  }
  write(dir, 'src/util.js', 'export const q = 1;\n');
  write(dir, 'src/server.js', SERVER_V2);
  commit(dir, 'change');
  return dir;
}

describe('the sync loop (FR-003, FR-004, FR-005)', () => {
  it('GST002 names a command that refreshes an unmarked doc, and that command works', t => {
    const dir = unmarkedStale(t);
    const findings = json(cli(dir, ['guard', '--format', 'json'])).findings.filter(f => f.code === 'GST002');
    assert.ok(findings.length > 0, 'the fixture reproduces GST002');
    for (const f of findings) {
      assert.equal(f.suggestion.command, 'docguard sync --write --force');
      assert.match(f.message, /docguard sync --write --force/);
    }
    const before = readFileSync(join(dir, 'docs-canonical/API-REFERENCE.md'), 'utf8');
    cli(dir, findings[0].suggestion.command.split(' ').slice(1));
    assert.notEqual(readFileSync(join(dir, 'docs-canonical/API-REFERENCE.md'), 'utf8'), before);
    const after = json(cli(dir, ['guard', '--format', 'json'])).findings.filter(f => f.code === 'GST002');
    assert.deepEqual(after, []);
  });

  it('sync --write without --force names the skipped stale sections instead of "up to date"', t => {
    const dir = unmarkedStale(t);
    const r = cli(dir, ['sync', '--write']);
    assert.doesNotMatch(r.stdout, /up to date/);
    assert.match(r.stdout, /API-REFERENCE\.md → endpoints/);
    assert.match(r.stdout, /docguard sync --write --force/);
    const data = json(cli(dir, ['sync', '--write', '--format', 'json']));
    assert.deepEqual(data.updates, []);
    assert.ok(data.skipped.some(s => s.section === 'endpoints' && s.stale === true && s.command === 'docguard sync --write --force'));
  });

  it('the --force preview prints an apply command that includes --force', t => {
    const dir = unmarkedStale(t);
    const r = cli(dir, ['sync', '--force']);
    assert.match(r.stdout, /Apply mechanical refreshes: docguard sync --write --force/);
  });

  it('a partial graph is reported as skipped, with the flag that writes it', { skip: process.platform === 'win32' ? 'symlinked PATH shim' : false }, t => {
    const marker = '<!-- docguard:section id=module-graph source=code -->\ncommitted elsewhere\n<!-- /docguard:section -->';
    const dir = project(t, {
      'package.json': '{"name":"shop","type":"module"}\n',
      'src/api/routes.js': "import { save } from '../db/store.js';\nexport default save;\n",
      'src/db/store.js': 'export const save = () => 1;\n',
      'src/py/app.py': 'import os\n',
      'docs-canonical/ARCHITECTURE.md': `# Architecture\n<!-- docguard:generated true -->\n\n${marker}\n`,
    });
    const bin = mkdtempSync(join(tmpdir(), 'docguard-049-nopy-'));
    t.after(() => rmSync(bin, { recursive: true, force: true }));
    symlinkSync(process.execPath, join(bin, 'node'));
    const gitBin = process.env.PATH.split(delimiter).map(d => join(d, 'git')).find(p => existsSync(p));
    if (gitBin) symlinkSync(gitBin, join(bin, 'git'));
    const r = cli(dir, ['sync', '--write'], { env: { PATH: bin } });
    assert.doesNotMatch(r.stdout, /up to date/);
    assert.match(r.stdout, /module-graph/);
    assert.match(r.stdout, /docguard sync --write --allow-partial/);
  });

  it('--since with a ref git cannot resolve exits 1 and names the ref', t => {
    const dir = unmarkedStale(t);
    const r = cli(dir, ['sync', '--since', 'nosuchref']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /nosuchref/);
    assert.doesNotMatch(r.out, /git unavailable/);
    const outside = project(t, { 'package.json': '{"name":"x"}\n', '.docguard.json': config() }, { git: false });
    const plain = cli(outside, ['sync', '--since', 'HEAD~1']);
    assert.equal(plain.status, 0);
    assert.match(plain.stdout, /git unavailable/);
  });

  it('prose to review names only sections the doc has, or the doc itself', t => {
    const dir = project(t, {
      'package.json': '{"name":"x","version":"1.0.0","dependencies":{"express":"4.0.0"}}\n',
      'src/server.js': SERVER_V2,
      'src/util.js': 'export const q = 1;\n',
      '.docguard.json': config(),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n<!-- docguard:generated true -->\n\n## Components\n\n<!-- docguard:section id=component-map source=code -->\nstale\n<!-- /docguard:section -->\n',
    });
    const data = json(cli(dir, ['sync', '--format', 'json']));
    assert.ok(data.updates.some(u => u.section === 'component-map'));
    const arch = data.reviews.filter(r => r.doc === 'docs-canonical/ARCHITECTURE.md');
    assert.deepEqual(arch.map(r => r.section), [null], 'no invented section ids');
    const text = cli(dir, ['sync']).stdout;
    assert.doesNotMatch(text, /→ overview|→ components|→ relationships/);
    assert.match(text, /docs-canonical\/ARCHITECTURE\.md \(no marked prose sections\)/);
  });
});

// ── FR-006, FR-007: each command says what it does ──────────────────────────

describe('upgrade, smart init and guard exit codes (FR-006, FR-007)', () => {
  it('upgrade --help describes the npm check, the schema migration and the global install', t => {
    const dir = project(t, {}, { git: false });
    const help = cli(dir, ['upgrade', '--help']).stdout;
    assert.match(help, /npm/);
    assert.match(help, /schema/i);
    assert.match(help, /npm install -g/);
    assert.match(help, /--schema-only/);
    assert.match(help, /--check-only/);
  });

  it('the schema note suggests --schema-only, which migrates without contacting npm', t => {
    const dir = project(t, {
      'package.json': '{"name":"x"}\n',
      '.docguard.json': `${JSON.stringify({ projectName: 'x', version: '0.4', profile: 'starter' })}\n`,
    });
    const guard = cli(dir, ['guard']);
    assert.match(guard.stdout, /docguard upgrade --apply --schema-only/);
    const r = cli(dir, ['upgrade', '--apply', '--schema-only'], { env: { HTTPS_PROXY: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9' } });
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.stdout, /latest:/, 'no npm check');
    assert.doesNotMatch(r.stdout, /npm install -g/);
    assert.equal(JSON.parse(readFileSync(join(dir, '.docguard.json'), 'utf8')).version, '0.6');
  });

  it('upgrade --schema-only never calls fetch; plain upgrade does', async t => {
    const dir = project(t, { '.docguard.json': `${JSON.stringify({ projectName: 'x', version: '0.6' })}\n` }, { git: false });
    const calls = [];
    const realFetch = globalThis.fetch;
    const realLog = console.log;
    globalThis.fetch = async url => { calls.push(String(url)); throw new Error('offline'); };
    console.log = () => {};
    try {
      await runUpgrade(dir, {}, { schemaOnly: true });
      assert.deepEqual(calls, []);
      await runUpgrade(dir, {}, {});
      assert.equal(calls.length, 1, 'the plain report checks npm');
    } finally {
      globalThis.fetch = realFetch;
      console.log = realLog;
    }
  });

  it('smart init writes the config it inferred, so guard no longer reports an uninitialised project', t => {
    const dir = project(t, {
      'package.json': '{"name":"x","version":"1.0.0","bin":{"x":"src/index.js"}}\n',
      'src/index.js': 'export const a = 1;\n',
    });
    const before = cli(dir, ['guard', '--format', 'json']);
    assert.equal(before.status, 3, 'no config: exit 3');
    const init = cli(dir, ['init']);
    assert.match(init.stdout, /Smart Mode/);
    const written = JSON.parse(readFileSync(join(dir, '.docguard.json'), 'utf8'));
    assert.equal(written.projectType, 'cli');
    assert.equal(written.profile, 'standard');
    assert.ok(written.requiredFiles.canonical.includes('docs-canonical/ARCHITECTURE.md'));
    assert.notEqual(cli(dir, ['guard', '--format', 'json']).status, 3);
    const again = cli(dir, ['init']);
    assert.match(again.stdout, /\.docguard\.json.*already exists/);
  });

  it('the command reference lists every guard exit code', () => {
    const doc = readFileSync(join(ROOT, 'docs/commands.md'), 'utf8');
    const line = doc.slice(doc.indexOf('**Exit codes:**')).split('\n\n')[0];
    for (const code of ['`0`', '`1`', '`2`', '`3`']) assert.ok(line.includes(code), `${code} in: ${line}`);
  });
});

// ── FR-008, SC-003: Doc Sections has its own key ────────────────────────────

describe('Doc Sections reports as docSections (FR-008, SC-003)', () => {
  const docs = {
    'package.json': '{"name":"x"}\n',
    'AGENTS.md': '# Agents\n',
    'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n',
    'DRIFT-LOG.md': '# Drift\n',
    'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nNo sections.\n',
  };
  const keys = data => data.validators.map(v => v.key);
  const byName = (data, name) => data.validators.find(v => v.name === name);

  it('full and compact output give the two validators distinct keys', t => {
    const dir = project(t, { ...docs, '.docguard.json': config({ profile: 'starter' }) });
    for (const args of [['guard', '--format', 'json'], ['guard', '--compact', '--format', 'json']]) {
      const data = json(cli(dir, args));
      assert.equal(byName(data, 'Structure').key, 'structure');
      assert.equal(byName(data, 'Doc Sections').key, 'docSections');
      assert.equal(keys(data).filter(k => k === 'structure').length, 1, args.join(' '));
    }
    const str003 = json(cli(dir, ['guard', '--format', 'json'])).findings.find(f => f.code === 'STR003');
    assert.equal(str003.validator, 'docSections');
    assert.equal(CODES.STR003.validator, 'docSections');
    // score --diff rolls both results into its structure category; with one
    // shared key its Map kept only the last of the two (Doc Sections).
    const standard = project(t, { ...docs, '.docguard.json': config() });
    const drill = cli(standard, ['score', '--diff']).stdout;
    assert.match(drill, /Missing required file: docs-canonical\/SECURITY\.md/);
    assert.match(drill, /missing section "/);
  });

  it('validators.structure: false still turns both off; docSections: false only Doc Sections', t => {
    const off = project(t, { ...docs, '.docguard.json': config({ profile: 'starter', validators: { structure: false } }) });
    const data = json(cli(off, ['guard', '--format', 'json']));
    assert.equal(byName(data, 'Structure').status, 'skipped');
    assert.equal(byName(data, 'Doc Sections').status, 'skipped');
    const only = project(t, { ...docs, '.docguard.json': config({ profile: 'starter', validators: { docSections: false } }) });
    const data2 = json(cli(only, ['guard', '--format', 'json']));
    assert.notEqual(byName(data2, 'Structure').status, 'skipped');
    assert.equal(byName(data2, 'Doc Sections').status, 'skipped');
  });

  it('severity.structure keeps escalating STR003, and a structure N/A marker covers both', t => {
    const high = project(t, { ...docs, '.docguard.json': config({ profile: 'starter', severity: { structure: 'high' } }) });
    const r = cli(high, ['guard', '--format', 'json']);
    const str003 = json(r).findings.find(f => f.code === 'STR003');
    assert.equal(str003.effectiveSeverity, 'error');
    assert.equal(r.status, 1);
    const na = project(t, {
      ...docs,
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n<!-- docguard:validator structure n/a — fixture -->\n',
      '.docguard.json': config({ profile: 'starter' }),
    });
    const data = json(cli(na, ['guard', '--format', 'json']));
    assert.equal(byName(data, 'Structure').status, 'na');
    assert.equal(byName(data, 'Doc Sections').status, 'na');
  });
});

// ── FR-009: ownership roots, suggestions and ties ───────────────────────────

describe('doc ownership (FR-009)', () => {
  const layout = {
    'package.json': '{"name":"x"}\n',
    'src/api/users.mjs': 'export const users = 1;\n',
    'src/db/store.mjs': 'export const store = 1;\n',
    'src/lib/math.mjs': 'export const add = 1;\n',
    'src/middleware/auth.mjs': 'export const auth = 1;\n',
    'src/pricing.mjs': 'export const price = 1;\n',
    'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n## Components\n',
  };
  const owners = entries => config({ ownership: { entries } });
  const entry = (paths, extra = {}) => ({ doc: 'docs-canonical/ARCHITECTURE.md', purpose: 'fixture', paths, ...extra });

  it('a source file at the root of a source directory is checked under default roots', t => {
    const dir = project(t, { ...layout, '.docguard.json': owners([entry(['src/api/**', 'src/db/**', 'src/lib/**', 'src/middleware/**'])]) });
    const own = json(cli(dir, ['guard', '--format', 'json'])).findings.filter(f => f.code === 'OWN001');
    assert.ok(own.some(f => f.message.includes('src/pricing.mjs')), JSON.stringify(own.map(f => f.message)));
    const report = json(cli(dir, ['trace', '--owners', '--format', 'json']));
    assert.ok(report.unowned.includes('src/pricing.mjs'));
  });

  it('--suggest covers root-level files and names only documents that exist', t => {
    const dir = project(t, { ...layout, '.docguard.json': config() });
    const draft = json(cli(dir, ['trace', '--owners', '--suggest', '--format', 'json'])).ownership;
    assert.ok(draft.roots.includes('src'), JSON.stringify(draft.roots));
    const paths = draft.entries.flatMap(e => e.paths);
    assert.ok(paths.includes('src/pricing.mjs'), JSON.stringify(paths));
    for (const e of draft.entries) assert.ok(existsSync(join(dir, e.doc)), `${e.doc} exists`);
  });

  it('trace --reverse names the entries of a tie', t => {
    const dir = project(t, {
      ...layout,
      '.docguard.json': owners([entry(['src/lib/**'], { section: 'a' }), entry(['src/lib/**'], { section: 'b', doc: 'docs-canonical/ARCHITECTURE.md' })]),
    });
    const data = json(cli(dir, ['trace', '--reverse', 'src/lib/math.mjs', '--format', 'json']));
    assert.equal(data.owner, null);
    assert.equal(data.tie.length, 2);
    assert.match(data.ownerReason, /equally specific/);
    assert.match(cli(dir, ['trace', '--reverse', 'src/lib/math.mjs']).stdout, /Owner: none — 2 entries are equally specific/);
  });
});

// ── FR-010, FR-011: agent instructions and Claude Code imports ──────────────

describe('agent instructions (FR-010, FR-011)', () => {
  it('docs_for_path reads nested and harness-specific instruction files, with each line\'s text', t => {
    const dir = project(t, {
      'package.json': '{"name":"x"}\n',
      'src/api/users.mjs': 'export const users = 1;\n',
      'AGENTS.md': '# Agents\n',
      'src/api/AGENTS.md': '# API\n\nKeep src/api/users.mjs pure.\n',
      '.claude/rules/api.md': '---\npaths: ["src/api/**"]\n---\nValidate input in src/api/users.mjs.\n',
      '.cursor/rules/api.mdc': '---\nglobs: src/api/**\n---\nusers.mjs owns the user list.\n',
      '.github/instructions/api.instructions.md': '---\napplyTo: "src/api/**"\n---\nTest src/api/users.mjs first.\n',
    });
    const result = docsForPath(dir, {}, 'src/api/users.mjs');
    const byDoc = new Map(result.agentInstructions.items.map(i => [i.doc, i]));
    for (const doc of ['src/api/AGENTS.md', '.claude/rules/api.md', '.cursor/rules/api.mdc', '.github/instructions/api.instructions.md']) {
      assert.ok(byDoc.has(doc), `${doc} in ${[...byDoc.keys()].join(', ')}`);
      assert.ok(byDoc.get(doc).text.includes('users.mjs'), doc);
    }
  });

  it('rules --for follows a CLAUDE.md @import and counts its bytes', t => {
    const agents = `# Agents\n\n${'Rule.\n'.repeat(200)}`;
    const dir = project(t, {
      'package.json': '{"name":"x"}\n',
      'src/index.mjs': 'export const a = 1;\n',
      'CLAUDE.md': '@AGENTS.md\n',
      'AGENTS.md': agents,
    });
    const claude = rulesFor(dir, 'src/index.mjs', { harness: 'claude' }).harnesses.claude;
    const imported = claude.files.find(f => f.file === 'AGENTS.md');
    assert.ok(imported, JSON.stringify(claude.files));
    assert.match(imported.reason, /imported by CLAUDE\.md/);
    assert.equal(claude.totalBytes, Buffer.byteLength('@AGENTS.md\n') + Buffer.byteLength(agents));
    const text = cli(dir, ['rules', '--for', 'src/index.mjs', '--harness', 'claude']).stdout;
    assert.match(text, /AGENTS\.md — imported by CLAUDE\.md/);
  });

  it('PSR003 counts imported bytes and PSR002 reports a missing import', t => {
    const dir = project(t, {
      'package.json': '{"name":"x"}\n',
      'src/index.mjs': 'export const a = 1;\n',
      'CLAUDE.md': '# Claude\n\n@docs/guide.md\n@docs/missing.md\n\nIn `@NOTES.md` nothing is imported, nor is @babel/parser or a@b.md.\n',
      'docs/guide.md': `# Guide\n\n${'x'.repeat(3000)}\n`,
    });
    const findings = validatePathScopedRules(dir, { agentInstructions: { maxBytes: 2000 } }).findings;
    const psr002 = findings.filter(f => f.code === 'PSR002').map(f => f.message);
    assert.equal(psr002.length, 1, JSON.stringify(psr002));
    assert.match(psr002[0], /CLAUDE\.md:4 imports @docs\/missing\.md, which does not exist/);
    assert.ok(findings.some(f => f.code === 'PSR003' && f.message.includes('docs/guide.md')), JSON.stringify(findings.map(f => f.message)));
  });

  it('imports resolve relative to the importing file, stop after 5 hops and survive a cycle', t => {
    const files = { 'package.json': '{"name":"x"}\n', 'src/index.mjs': '', 'CLAUDE.md': '@notes/h1.md\n' };
    for (let i = 1; i <= 7; i++) files[`notes/h${i}.md`] = `hop ${i}\n${i < 7 ? `@h${i + 1}.md\n` : ''}`;
    files['loop/a.md'] = '@b.md\n';
    files['loop/b.md'] = '@a.md\n';
    files['src/CLAUDE.md'] = '@../loop/a.md\n';
    const dir = project(t, files);
    const root = rulesFor(dir, 'index.mjs', { harness: 'claude' }).harnesses.claude.files.map(f => f.file);
    assert.deepEqual(root, ['CLAUDE.md', 'notes/h1.md', 'notes/h2.md', 'notes/h3.md', 'notes/h4.md', 'notes/h5.md']);
    const nested = rulesFor(dir, 'src/index.mjs', { harness: 'claude' }).harnesses.claude.files.map(f => f.file);
    assert.ok(nested.includes('loop/a.md') && nested.includes('loop/b.md'), JSON.stringify(nested));
    assert.equal(nested.filter(f => f === 'loop/a.md').length, 1);
  });
});

// ── FR-012–FR-017: small defects ────────────────────────────────────────────

describe('small defects (FR-012–FR-017)', () => {
  it('review --prune with nothing to prune says so; review --suggest needs a document', t => {
    const dir = project(t, { 'package.json': '{"name":"x"}\n', '.docguard.json': config() });
    const prune = cli(dir, ['review', '--prune']);
    assert.equal(prune.status, 0);
    assert.match(prune.stdout, /Nothing to prune/);
    assert.doesNotMatch(prune.stdout, /CURRENT\s*$/m);
    const suggest = cli(dir, ['review', '--suggest']);
    assert.equal(suggest.status, 1);
    assert.match(suggest.stderr, /review --suggest <doc>/);
  });

  it('a covers glob fingerprints tracked files only', t => {
    const dir = project(t, { 'src/lib/a.mjs': 'export const a = 1;\n' });
    const before = fingerprint(createContext(dir), 'src/lib/**');
    write(dir, 'src/lib/new.mjs', 'export const n = 1;\n');
    assert.deepEqual(fingerprint(createContext(dir), 'src/lib/**'), before, 'an untracked file does not count');
    run(dir, 'git', ['add', 'src/lib/new.mjs']);
    assert.notDeepEqual(fingerprint(createContext(dir), 'src/lib/**'), before, 'once added, it does');
    const plain = project(t, { 'src/lib/a.mjs': 'export const a = 1;\n' }, { git: false });
    assert.equal(fingerprint(createContext(plain), 'src/lib/**').ok, true, 'outside git the working tree counts');
  });

  it('doc_structure heading bytes sum to the file size', t => {
    const content = '# Title\n\nIntro.\n\n## A\n\nText.\n\n## B\n\nMore.\n';
    const dir = project(t, { 'docs/x.md': content }, { git: false });
    const data = docStructure(dir, {}, 'docs/x.md');
    assert.equal(data.totalBytes, Buffer.byteLength(content));
    assert.equal(data.headings.items[0].bytes, data.totalBytes);
    const [a, b] = data.headings.items.slice(1);
    assert.equal(data.headings.items[0].bytes, Buffer.byteLength('# Title\n\nIntro.\n\n') + a.bytes + b.bytes);
  });

  it('init records the project type generate detects for Go, Java and Ruby', t => {
    const go = project(t, { 'go.mod': 'module x\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.0\n', 'main.go': 'package main\n' }, { git: false });
    const java = project(t, { 'pom.xml': '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>\n' }, { git: false });
    const ruby = project(t, { Gemfile: "source 'https://rubygems.org'\ngem 'rails', '7.1.0'\n" }, { git: false });
    assert.equal(autoDetectProjectType(go), 'api');
    assert.equal(autoDetectProjectType(java), 'api');
    assert.equal(autoDetectProjectType(ruby), 'webapp');
    cli(go, ['init', '--skip-prompts', '--no-spec-kit']);
    assert.equal(JSON.parse(readFileSync(join(go, '.docguard.json'), 'utf8')).projectType, 'api');
    const node = project(t, { 'package.json': '{"name":"x"}\n' }, { git: false });
    assert.equal(autoDetectProjectType(node), 'unknown', 'package.json rules are unchanged');
  });

  it('REF001 locates a nested doc by its project-relative path', t => {
    const dir = project(t, {
      'src/a.js': 'export function computeLedgerTotals() { return 1; }\n',
      'docs-canonical/guides/LEDGER.md': '# Ledger\n\nTotals come from `computeLedgerTotals`.\n',
    });
    write(dir, 'src/a.js', 'export function sum() { return 1; }\n');
    commit(dir, 'rename');
    const ref = validateReferenceExistence(dir, {}).findings.filter(f => f.code === 'REF001');
    assert.equal(ref.length, 1, JSON.stringify(ref));
    assert.equal(ref[0].location, 'docs-canonical/guides/LEDGER.md');
  });

  it('every registered finding and blocker code explains, and every code the CLI emits is registered', () => {
    const emitted = new Set();
    const walk = dir => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.mjs')) for (const m of readFileSync(path, 'utf8').matchAll(/code:\s*['"]([A-Z]{2,4}\d{3})['"]/g)) emitted.add(m[1]);
      }
    };
    walk(join(ROOT, 'cli'));
    assert.deepEqual([...emitted].filter(code => !CODES[code] && !BLOCKER_CODES[code]), []);
    const original = console.log;
    const missing = [];
    try {
      for (const code of [...Object.keys(CODES), ...Object.keys(BLOCKER_CODES)]) {
        let printed = '';
        console.log = s => { printed += s; };
        runExplain(ROOT, {}, { args: [code], format: 'json' });
        const data = JSON.parse(printed);
        if (data.code !== code || !data.title || !data.help) missing.push(code);
      }
    } finally { console.log = original; }
    assert.deepEqual(missing, []);
  });

  it('the specs require failure names lines that make it pass', t => {
    const dir = project(t, { 'package.json': '{"name":"x"}\n', 'cli/a.mjs': 'export const a = 1;\n', '.docguard.json': config() });
    write(dir, 'cli/a.mjs', 'export const a = 2;\n');
    commit(dir, 'change');
    const uncovered = cli(dir, ['specs', 'require', '--since', 'HEAD~1']);
    assert.equal(uncovered.status, 1, uncovered.out);
    const line = uncovered.stdout.match(/Spec-Exempt: <([a-z|-]+)>/);
    assert.ok(line, uncovered.stdout);
    write(dir, 'msg.txt', `Spec-Exempt: ${line[1].split('|')[0]} — a small fixture change\n`);
    const exempt = cli(dir, ['specs', 'require', '--since', 'HEAD~1', '--message-file', 'msg.txt']);
    assert.equal(exempt.status, 0, exempt.out);
  });
});

// ── FR-018: the docs describe the behaviour ─────────────────────────────────

describe('documentation (FR-018)', () => {
  const read = path => readFileSync(join(ROOT, path), 'utf8');
  it('commands, configuration, DATA-MODEL and the CHANGELOG describe the changes', () => {
    const commands = read('docs/commands.md');
    for (const term of ['NO_COLOR', 'FORCE_COLOR', '--schema-only', '`3`']) assert.ok(commands.includes(term), `commands.md: ${term}`);
    assert.match(read('docs/configuration.md'), /docSections/);
    const model = read('docs-canonical/DATA-MODEL.md');
    assert.match(model, /docSections/);
    assert.match(model, /@path/);
    const unreleased = notesSince(read('CHANGELOG.md'), '0.42.1');
    for (const term of ['NO_COLOR', '--schema-only', 'docSections', '--changed-only']) assert.ok(unreleased.includes(term), `CHANGELOG: ${term}`);
  });
});
