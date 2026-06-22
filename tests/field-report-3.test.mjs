/**
 * v0.27 — LLM field report #3.
 *
 * The findings architecture + the group-A false-positive/gap fixes + the
 * local-first feedback loop. Each block pairs the fix with a non-vacuous
 * CONTROL (the pre-fix behaviour) so a future change can't silently re-break it
 * — and the security tests assert against the AGENT'S real scenario (a value
 * that reads like prose vs. a genuine single-token secret).
 *
 *   #1  natural-language password VALUE → low-confidence warning, not a blocker
 *   #8  inline `// docguard:ignore <CODE>` suppression
 *   #7  runner/CI/SDK env vars (VITEST, CI, GITHUB_*) not flagged undocumented
 *   #6  TODOs tracked in docs-canonical/ROADMAP.md count as tracked
 *   #9  per-doc passive-voice override parity with negation-load
 *   #3  score recognises Vitest-in-vite.config + scripts.test
 *   +   findings infra, stable guard contract, explain <CODE>, feedback loop
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateSecurity } from '../cli/validators/security.mjs';
import { validateTodoTracking } from '../cli/validators/todo-tracking.mjs';
import { validateDocQuality } from '../cli/validators/doc-quality.mjs';
import { grepEnvUsage } from '../cli/shared-source.mjs';
import { runGuardInternal } from '../cli/commands/guard.mjs';
import { detectTestRunner } from '../cli/commands/score.mjs';
import { suppressesCode, mkFinding, resultFromFindings, CODES } from '../cli/findings.mjs';

const CLI = join(process.cwd(), 'cli/docguard.mjs');
const docguard = (args, opts = {}) => spawnSync('node', [CLI, ...args], { encoding: 'utf-8', ...opts });

function tmp() { return mkdtempSync(join(tmpdir(), 'docguard-fr3-')); }
function write(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
}

describe('field report #3 — findings infrastructure', () => {
  it('suppressesCode handles bare, exact, list, wildcard, and ignore-secret forms', () => {
    assert.equal(suppressesCode('// docguard:ignore', 'SEC001'), true);
    assert.equal(suppressesCode('// docguard:ignore SEC001 — reason', 'SEC001'), true);
    assert.equal(suppressesCode('// docguard:ignore SEC002', 'SEC001'), false);
    assert.equal(suppressesCode('# docguard:ignore SEC001,DQ002', 'DQ002'), true);
    assert.equal(suppressesCode('// docguard:ignore SEC*', 'SEC006'), true);
    assert.equal(suppressesCode('// docguard:ignore-secret', 'SEC003'), true);
    assert.equal(suppressesCode('// docguard:ignore-secret', 'DQ001'), false);
    assert.equal(suppressesCode('a plain code line', 'SEC001'), false);
  });

  it('resultFromFindings derives errors/warnings and keeps findings in sync', () => {
    const fs = [
      mkFinding({ code: 'X1', severity: 'error', message: 'e1' }),
      mkFinding({ code: 'X2', severity: 'warn', confidence: 'low', message: 'w1' }),
    ];
    const r = resultFromFindings(fs, { passed: 1, total: 2 });
    assert.equal(r.errors.length, 1);
    assert.equal(r.warnings.length, 1);
    assert.equal(r.findings.length, 2);
    assert.equal(r.findings[1].reportable, true, 'low confidence ⇒ reportable by default');
  });

  it('every security finding code is registered for `explain`', () => {
    for (const code of ['SEC001', 'SEC002', 'SEC003', 'SEC004', 'SEC005', 'SEC006', 'SEC010', 'SEC011']) {
      assert.ok(CODES[code], `${code} missing from CODES registry`);
    }
  });
});

describe('field report #1/#8 — security false positives + inline suppression', () => {
  let dir;
  beforeEach(() => { dir = tmp(); write(dir, { '.gitignore': '.env\n' }); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('downgrades a natural-language password VALUE to a low-confidence warning, not a blocking error', () => {
    write(dir, { 'auth.js': 'const password = "New password must differ from your current and recent previous passwords";\n' });
    const r = validateSecurity(dir, {});
    assert.equal(r.errors.length, 0, 'prose value must not be a blocking error');
    const f = r.findings.find((x) => x.code === 'SEC001');
    assert.ok(f, 'still flagged — no false-green');
    assert.equal(f.severity, 'warn');
    assert.equal(f.confidence, 'low');
    assert.equal(f.reportable, true);
    assert.ok(f.suggestion?.pragma?.includes('docguard:ignore SEC001'));
  });

  it('CONTROL: still flags a real single-token password ending in punctuation as a blocking error', () => {
    write(dir, { 'auth.js': 'const password = "SuperSecretPassword!";\n' });
    const r = validateSecurity(dir, {});
    assert.equal(r.errors.length, 1, 'one-word password ending in ! is NOT prose');
    assert.equal(r.findings.find((f) => f.code === 'SEC001').severity, 'error');
  });

  it('honors an inline `// docguard:ignore SEC001` pragma on the same line', () => {
    write(dir, { 'auth.js': 'const password = "hunter2hunter2"; // docguard:ignore SEC001 — test fixture\n' });
    const r = validateSecurity(dir, {});
    assert.equal(r.findings.filter((f) => f.code === 'SEC001').length, 0);
  });

  it('honors an inline ignore pragma on the line ABOVE the match', () => {
    write(dir, { 'auth.js': '// docguard:ignore SEC001 — fixture\nconst password = "hunter2hunter2";\n' });
    const r = validateSecurity(dir, {});
    assert.equal(r.findings.filter((f) => f.code === 'SEC001').length, 0);
  });

  it('never leaks the literal value into redactedContext', () => {
    write(dir, { 'auth.js': 'const password = "this is a leaky secret value here";\n' });
    const r = validateSecurity(dir, {});
    const f = r.findings.find((x) => x.code === 'SEC001');
    assert.ok(f.redactedContext && !f.redactedContext.includes('leaky secret value'));
  });
});

describe('field report #7 — runner/CI env vars not flagged undocumented', () => {
  it('grepEnvUsage excludes VITEST/CI/GITHUB_* but keeps real product vars', () => {
    const dir = tmp();
    write(dir, {
      'src/app.js': [
        'if (process.env.VITEST) {}',
        'if (process.env.CI) {}',
        'const sha = process.env.GITHUB_SHA;',
        'const db = process.env.DATABASE_URL;',
      ].join('\n') + '\n',
    });
    const used = grepEnvUsage(dir, {});
    assert.ok(used.has('DATABASE_URL'), 'real product var still detected');
    assert.ok(!used.has('VITEST'));
    assert.ok(!used.has('CI'));
    assert.ok(!used.has('GITHUB_SHA'));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('field report #6 — TODOs tracked in docs-canonical/ROADMAP.md', () => {
  it('a TODO referenced in docs-canonical/ROADMAP.md is not reported as untracked', () => {
    const dir = tmp();
    const todoText = 'wire up the retry backoff scheduler for the worker queue';
    write(dir, {
      'src/parser.js': `// TODO: ${todoText}\nexport const x = 1;\n`,
      // ONLY place the TODO is referenced — there is no root ROADMAP.md, so this
      // passes only because docs-canonical/ROADMAP.md is now scanned.
      'docs-canonical/ROADMAP.md': `# Roadmap\n\n- ${todoText} (tracked) — src/parser.js\n`,
    });
    const r = validateTodoTracking(dir, {});
    const untracked = (r.warnings || []).filter((w) => /Untracked/.test(w));
    assert.equal(untracked.length, 0, 'TODO tracked in docs-canonical/ROADMAP.md must not warn');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('field report #9 — per-doc passive-voice override', () => {
  const passiveDoc = `# Message Flow

The message is received by the gateway. The payload is parsed by the worker. The record is written to the database. The event is emitted by the dispatcher. The response is returned to the caller. The job is queued by the scheduler. The result is cached by the store. The notification is delivered by the channel. The retry is scheduled by the supervisor. The audit row is appended by the logger.
`;

  it('CONTROL: a heavily passive doc warns', () => {
    const dir = tmp();
    write(dir, { 'docs-canonical/MESSAGE-FLOWS.md': passiveDoc });
    const r = validateDocQuality(dir, {});
    assert.ok((r.warnings || []).some((w) => /passive voice/i.test(w)), 'control: passive doc must warn');
    rmSync(dir, { recursive: true, force: true });
  });

  it('`<!-- docguard:quality passive-voice off -->` silences the passive-voice warning', () => {
    const dir = tmp();
    write(dir, { 'docs-canonical/MESSAGE-FLOWS.md': '<!-- docguard:quality passive-voice off — sequence doc -->\n' + passiveDoc });
    const r = validateDocQuality(dir, {});
    assert.equal((r.warnings || []).filter((w) => /passive voice/i.test(w)).length, 0, 'override silences passive-voice');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('field report #3 — score recognises modern test-runner config', () => {
  const detect = (files) => {
    const dir = tmp();
    write(dir, files);
    const got = detectTestRunner(dir, {});
    rmSync(dir, { recursive: true, force: true });
    return got;
  };

  it('counts Vitest configured inside vite.config.ts', () => {
    assert.equal(detect({
      'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }),
      'vite.config.ts': "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { globals: true } });\n",
    }), true, 'vitest-in-vite.config must count as a runner');
  });

  it('counts a package.json scripts.test that runs vitest', () => {
    assert.equal(detect({ 'package.json': JSON.stringify({ name: 'x', version: '1.0.0', scripts: { test: 'vitest run' } }) }), true);
  });

  it('counts a runner config in a workspace subdir (backend/vitest.config.ts)', () => {
    assert.equal(detect({ 'backend/vitest.config.ts': 'export default {};\n' }), true);
  });

  it('CONTROL: still false for a project with genuinely no runner', () => {
    assert.equal(detect({ 'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }) }), false, 'control: no runner ⇒ false');
  });
});

describe('field report #3 — stable guard contract', () => {
  it('runGuardInternal returns findings, reportable, and nextStep', () => {
    const dir = tmp();
    write(dir, {
      '.gitignore': '.env\n',
      'auth.js': 'const password = "this is clearly a natural-language message value here";\n',
    });
    const data = runGuardInternal(dir, { projectName: 'x', validators: { security: true } });
    assert.ok(Array.isArray(data.findings), 'findings[] present');
    assert.ok(Array.isArray(data.reportable), 'reportable[] present');
    assert.ok('nextStep' in data, 'nextStep present');
    assert.ok(data.reportable.some((f) => f.code === 'SEC001'), 'low-confidence SEC001 is reportable');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('field report #3 — explain <CODE> + feedback (CLI)', () => {
  it('`explain SEC001 --format json` returns the code entry', () => {
    const r = docguard(['explain', 'SEC001', '--format', 'json']);
    const out = JSON.parse(r.stdout);
    assert.equal(out.code, 'SEC001');
    assert.equal(out.validator, 'security');
    assert.ok(out.suppress.includes('docguard:ignore SEC001'));
  });

  it('`feedback --format json` emits a redacted, capped, prefilled URL and writes a local record', () => {
    const dir = tmp();
    write(dir, {
      '.gitignore': '.env\n',
      '.docguard.json': JSON.stringify({ projectName: 'x', validators: { security: true } }),
      'auth.js': 'const password = "New password must differ from your recent previous passwords";\n',
    });
    const r = docguard(['feedback', '--format', 'json'], { cwd: dir });
    const out = JSON.parse(r.stdout);
    assert.ok(out.reportable.length >= 1, 'at least one reportable finding');
    const item = out.reportable.find((x) => x.code === 'SEC001');
    assert.ok(item, 'SEC001 is reportable');
    assert.ok(item.url.length < 4000, 'URL stays well under GitHub limit');
    assert.ok(!item.url.includes('New%20password%20must'), 'URL must not contain the literal value');
    assert.ok(existsSync(join(dir, '.docguard', 'feedback')), 'local feedback record written');
    rmSync(dir, { recursive: true, force: true });
  });
});
