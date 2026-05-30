/**
 * v0.24 — CLI behaviors from field report #2.
 *   #10  `<command> --help` shows usage instead of executing (no scaffolding)
 *   #7   `explain` resolves the exact casing guard prints (Traceability)
 *   #6   `explain traceability` documents the "unlinked doc" check too
 *   #1   invalid severity values warn; explain shows how to mute a validator
 *   #2   `fix` agrees with `guard` — reports advisory warnings, not "complete"
 *   #4   `trace` doesn't list markdown command docs as SECURITY auth modules
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI = join(process.cwd(), 'cli/docguard.mjs');
const stripAnsi = (s) => (s || '').replace(/\x1b\[[0-9;]*m/g, '');
const docguard = (args, opts = {}) => spawnSync('node', [CLI, ...args], { encoding: 'utf-8', ...opts });

function gitInit(dir) {
  const env = { ...process.env };
  spawnSync('git', ['init', '-q'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: dir, env });
  spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: dir, env });
}

function tmp() { return mkdtempSync(join(tmpdir(), 'docguard-fr2-')); }
function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
}

describe('field report #2 — CLI', () => {
  let dir;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } });

  it('#10: `generate --help` prints usage and scaffolds nothing', () => {
    dir = tmp();
    write(dir, { 'package.json': '{"name":"t","version":"0.1.0"}' });
    const r = docguard(['generate', '--help', '--dir', dir]);
    assert.match(stripAnsi(r.stdout), /Usage:/, 'should print help');
    const created = readdirSync(dir).filter(f => f !== 'package.json');
    assert.deepEqual(created, [], `--help must not scaffold; created: ${created.join(', ')}`);
  });

  it('#7: explain resolves the exact casing guard prints', () => {
    const r = docguard(['explain', 'Traceability', '--format', 'json', '--quiet']);
    const j = JSON.parse(r.stdout);
    assert.equal(j.match && j.match.key, 'traceability');
  });

  it('#6: explain traceability documents the "unlinked doc" check', () => {
    const r = docguard(['explain', 'traceability', '--quiet']);
    assert.match(stripAnsi(r.stdout), /unlinked doc/i);
  });

  it('#1: explain shows how to mute a validator from config', () => {
    const out = stripAnsi(docguard(['explain', 'testSpec', '--quiet']).stdout);
    assert.match(out, /validators\.testSpec: false/, 'should document the disable switch');
    assert.match(out, /severity\.testSpec/, 'should document the severity knob');
  });

  it('#1: an invalid severity value warns on stderr but keeps stdout JSON clean', () => {
    dir = tmp();
    write(dir, {
      'package.json': '{"name":"t","version":"0.1.0"}',
      'docs-canonical/ARCHITECTURE.md': '# A\nstub\n',
      'CHANGELOG.md': '# Changelog\n## [Unreleased]\n',
      'AGENTS.md': '# Agents\n',
      'DRIFT-LOG.md': '# Drift\n',
      '.docguard.json': '{"projectName":"t","severity":{"testSpec":"off"}}',
    });
    gitInit(dir);
    const r = docguard(['guard', '--dir', dir, '--format', 'json', '--quiet']);
    assert.match(stripAnsi(r.stderr), /severity\.testSpec.*not a valid level/i);
    assert.match(stripAnsi(r.stderr), /validators\.testSpec: false/, 'should point at the real disable switch');
    assert.doesNotThrow(() => JSON.parse(r.stdout), 'stdout must stay parseable JSON');
  });

  it('#2: fix agrees with guard — advisory warnings, not "documentation is complete"', () => {
    dir = tmp();
    write(dir, {
      'package.json': '{"name":"t","version":"0.1.0","scripts":{"test":"node --test"}}',
      'tests/a.test.mjs': 'x\n',
      // Needs >10 non-empty lines and ≥5 content lines to read as "real
      // content" to `fix`'s quality check (one sentence per line).
      'docs-canonical/ARCHITECTURE.md':
        '# Architecture\n\n' +
        '## System Overview\n' +
        'This service ingests webhook events and snapshots state to object storage.\n' +
        'It runs as a single long-running process behind a load balancer.\n' +
        'It scales horizontally and favors observability over cleverness.\n\n' +
        '## Component Map\n' +
        'The ingest layer validates and enqueues incoming events.\n' +
        'The worker layer drains the queue and applies idempotent transitions.\n' +
        'The storage layer persists snapshots to object storage.\n\n' +
        '## Tech Stack\n' +
        'Node.js with TypeScript and an in-memory queue.\n' +
        'S3-compatible object storage holds durable snapshots.\n' +
        'Tests run under node:test.\n',
      'CHANGELOG.md': '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n- initial\n',
      'AGENTS.md': '# Agents\n\nStack: Node + TS. Run `npm test`.\n',
      'DRIFT-LOG.md': '# Drift Log\n\n| Date | Drift | Reason |\n|---|---|---|\n| 2026-01-01 | none | n/a |\n',
      '.docguard.json': '{"projectName":"t","profile":"starter"}',
    });
    gitInit(dir);

    const fixJson = JSON.parse(docguard(['fix', '--dir', dir, '--format', 'json']).stdout);
    assert.equal(fixJson.status, 'clean', 'no mechanically-fixable issues in this fixture');

    const guardJson = JSON.parse(docguard(['guard', '--dir', dir, '--format', 'json', '--quiet']).stdout);
    const guardWarnings = guardJson.validators.reduce((n, v) => n + (v.warnings ? v.warnings.length : 0), 0);

    // The whole point: fix's advisory count equals guard's warning count.
    assert.equal(fixJson.advisoryWarnings, guardWarnings,
      'fix advisoryWarnings must match guard warning count');
    if (guardWarnings > 0) {
      const text = stripAnsi(docguard(['fix', '--dir', dir]).stdout);
      assert.doesNotMatch(text, /documentation is complete/i,
        'must not claim complete while guard has warnings');
      assert.match(text, /advisory warning/i);
    }
  });

  it('#4: trace does not list markdown command docs as SECURITY auth modules', () => {
    dir = tmp();
    write(dir, {
      'package.json': '{"name":"t","version":"0.1.0"}',
      'docs-canonical/SECURITY.md': '# Security\n## Authentication\nBasic auth.\n## Secrets Management\nenv.\n',
      'docs-canonical/ARCHITECTURE.md': '# A\n## System Overview\nx\n',
      'commands/docguard.guard.md': 'guard command doc\n',
      'src/auth.ts': 'export function authMiddleware(){}\n',
      'CHANGELOG.md': '# Changelog\n## [Unreleased]\n',
      'AGENTS.md': '# Agents\n',
      'DRIFT-LOG.md': '# Drift\n',
      '.docguard.json': '{"projectName":"t","profile":"enterprise"}',
    });
    gitInit(dir);
    const out = stripAnsi(docguard(['trace', '--dir', dir]).stdout);
    assert.doesNotMatch(out, /docguard\.guard\.md/, 'a markdown doc must not be traced as auth source');
    assert.match(out, /auth\.ts/, 'real auth code should still be traced');
  });
});
