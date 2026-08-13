/**
 * Phase 2 of the nested-canonical-docs fix: the remaining 14 sites found
 * after the initial 5-file fix (see canonical-docs-nested.test.mjs and
 * bug-252/253 in .wolf/buglog.json). Same invariant: a doc grouped under
 * docs-canonical/<subfolder>/ must be visible everywhere a flat doc is.
 *
 * Prioritized here: sites where the flat read caused SILENT, hard-to-diagnose
 * failures — a validator going dark entirely (generated-staleness), or a
 * reference/smell check silently skipping content that exists on disk.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateApiDocSmells } from '../cli/validators/api-doc-smells.mjs';
import { validateReferenceExistence } from '../cli/validators/reference-existence.mjs';
import { validateTraceability } from '../cli/validators/traceability.mjs';
import { validateGeneratedStaleness } from '../cli/validators/generated-staleness.mjs';

function git(dir, ...args) { spawnSync('git', args, { cwd: dir, encoding: 'utf-8' }); }

let tmpDir;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'docguard-nested-p2-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

function put(rel, content) {
  const abs = join(tmpDir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

describe('nested canonical docs — phase 2 consumer regressions', () => {
  it('api-doc-smells: a lazy API unit in a nested doc is still flagged', () => {
    put('docs-canonical/01-modules/API.md', '## GET /foo\nTODO\n');

    const r = validateApiDocSmells(tmpDir, {});

    assert.equal(r.total, 1, 'the one unit in the nested doc must be counted');
    assert.ok(r.findings.some(f => f.code === 'APS002'), 'lazy-doc finding must fire');
  });

  it('api-doc-smells: message/location use the bare basename on a flat tree (no format regression)', () => {
    put('docs-canonical/API.md', '## GET /foo\nTODO\n');

    const r = validateApiDocSmells(tmpDir, {});

    assert.match(r.findings[0].message, /^API\.md:/, 'flat-tree message must stay unprefixed, matching pre-fix format');
    assert.equal(r.findings[0].location.file, 'API.md');
  });

  it('generated-staleness: the pre-flight scan must SEE a marker in a NESTED doc', () => {
    // This was the worst failure in phase 2: _quickScan's flat read missed
    // the marker entirely, so the pre-flight concluded "no markers anywhere"
    // and short-circuited to N/A with that specific note — buildMemoryPlan
    // never even ran, silently disabling drift detection. The distinguishing
    // signal is `note`: the false-negative path stamps the "no markers" note;
    // once quickScan sees the marker, the validator moves past that gate
    // entirely (a *different*, unrelated N/A may still follow from
    // buildMemoryPlan in a minimal fixture — that's not what's under test).
    put('docs-canonical/01-modules/MODULE.md',
      '# Modules\n\n<!-- docguard:section id=x source=code -->\nbody\n<!-- /docguard:section -->\n');

    const r = validateGeneratedStaleness(tmpDir, {});

    assert.notEqual(
      r.note, 'no docguard:section markers and no status:draft docs',
      'pre-flight must not report "no markers" — the nested doc HAS one'
    );
  });

  it('generated-staleness: no markers anywhere (flat or nested) still short-circuits to N/A', () => {
    put('docs-canonical/01-modules/MODULE.md', '# Modules\n\nJust prose, no markers.\n');

    const r = validateGeneratedStaleness(tmpDir, {});

    assert.equal(r.applicable, false);
  });

  it('reference-existence: a symbol referenced only in a nested doc is indexed and checked', () => {
    git(tmpDir, 'init', '-q', '-b', 'main');
    git(tmpDir, 'config', 'user.email', 't@t.co'); git(tmpDir, 'config', 'user.name', 'T');
    put('src/auth.ts', 'export function validateToken(t){}\n');
    put('docs-canonical/01-modules/API.md', '# API\n\nUse `validateToken` to check the session.\n');
    git(tmpDir, 'add', '-A'); git(tmpDir, 'commit', '-qm', 'c1');
    // Now remove the symbol the nested doc referenced.
    put('src/auth.ts', 'export function verifyToken(t){}\n');
    git(tmpDir, 'add', '-A'); git(tmpDir, 'commit', '-qm', 'c2 rename');

    const r = validateReferenceExistence(tmpDir, {});

    assert.equal(r.applicable, true);
    assert.ok(
      r.findings.some(f => f.code === 'REF001' && /validateToken/.test(f.message)),
      `expected validateToken flagged as stale; got ${JSON.stringify((r.findings || []).map(f => f.message))}`
    );
  });

  it('traceability: a stray nested doc sharing a TRACE_MAP basename is still flagged as orphaned', () => {
    // ARCHITECTURE.md nested under a subfolder, NOT the one in requiredFiles —
    // must be detected as an orphan (exists, but not required) with a real,
    // findable location (not a fabricated top-level path).
    put('docs-canonical/99-archive/ARCHITECTURE.md', '# Old architecture\n');

    const r = validateTraceability(tmpDir, { requiredFiles: { canonical: ['docs-canonical/SECURITY.md'] } });

    const orphan = r.findings.find(f => f.code === 'TRC003');
    assert.ok(orphan, 'nested orphaned doc must be detected');
    assert.equal(orphan.location, 'docs-canonical/99-archive/ARCHITECTURE.md', 'location must point at the real nested file');
  });
});
