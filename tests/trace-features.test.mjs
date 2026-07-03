/**
 * `trace --features` — per-feature spec-kit adherence scoring.
 *
 * Direct-imports runTraceFeatures/runTrace (the tests/sync.test.mjs convention
 * for command functions) and captures console output. Spawning the CLI is not
 * used here because the `--features` flag wiring in cli/docguard.mjs lands
 * separately; the command logic is fully exercised through the exports.
 *
 * @req SC-TF-001 — complete feature (all artifacts, covered IDs, evidenced tasks) scores high
 * @req SC-TF-002 — skeletal feature (missing plan, unchecked tasks, uncovered IDs) scores low
 * @req SC-TF-003 — features are ordered worst-first in both text and JSON output
 * @req SC-TF-004 — JSON output has {features:[{name,dir,score,grade,signals}], summary}
 * @req SC-TF-005 — repo without spec-kit features reports N/A cleanly in both formats
 *
 * NB: requirement-ID literals used in fixtures are built by concatenation
 * (same convention as tests/traceability.test.mjs) so this very test file
 * isn't itself scanned as a real requirement/test reference during DocGuard's
 * own self-guard.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { runTrace, runTraceFeatures } from '../cli/commands/trace.mjs';

// Built by concatenation — see NB in the header comment.
const FR1 = ['FR', '001'].join('-');
const FR2 = ['FR', '002'].join('-');

function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function capture(fn) {
  const logs = [];
  const orig = console.log;
  console.log = (...args) => { logs.push(args.join(' ')); };
  try { fn(); } finally { console.log = orig; }
  return logs.join('\n');
}

const CONFIG = { projectName: 'fixture' };

/**
 * Fixture: two legacy-path (specs/**) spec-kit features.
 *   001-complete — spec+plan+tasks, all tasks checked, a checked task names a
 *                  real file, its requirement ID is referenced by a test file.
 *   002-skeletal — spec+tasks only (no plan), all tasks unchecked, its
 *                  requirement ID appears in no test.
 */
function makeTwoFeatureRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-trace-feat-'));

  write(dir, 'specs/001-complete/spec.md',
    `# Feature: Complete\n\n## User Scenarios\nStuff.\n\n## Requirements\n- ${FR1}: parse the input\n\n## Success Criteria\nDone.\n`);
  write(dir, 'specs/001-complete/plan.md',
    '# Plan\n\n## Summary\n\n## Technical Context\n\n## Project Structure\n');
  write(dir, 'specs/001-complete/tasks.md',
    '# Tasks\n\n## Phase 1\n- [x] Create src/lib/core.mjs with the parser\n- [x] Wire everything up\n');
  write(dir, 'src/lib/core.mjs', 'export const core = 1;\n');
  write(dir, 'tests/core.test.mjs',
    `// @req ${FR1}\nimport { core } from '../src/lib/core.mjs';\n`);

  write(dir, 'specs/002-skeletal/spec.md',
    `# Feature: Skeletal\n\n## Requirements\n- ${FR2}: never implemented\n`);
  write(dir, 'specs/002-skeletal/tasks.md',
    '# Tasks\n\n## Phase 1\n- [ ] Do the first thing\n- [ ] Do the second thing\n');

  return dir;
}

describe('trace --features', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('scores a complete feature high and a skeletal one low', () => {
    dir = makeTwoFeatureRepo();
    const out = capture(() => runTraceFeatures(dir, CONFIG, { format: 'json' }));
    const parsed = JSON.parse(out);

    const complete = parsed.features.find(f => f.name === '001-complete');
    const skeletal = parsed.features.find(f => f.name === '002-skeletal');
    assert.ok(complete, 'complete feature detected');
    assert.ok(skeletal, 'skeletal feature detected');

    // Complete: reqCoverage 1/1, tasks 2/2, evidence 1/1, artifacts 3/3 → 100 A
    assert.ok(complete.score >= 90, `complete should score >=90, got ${complete.score}`);
    assert.equal(complete.grade, 'A');
    assert.equal(complete.signals.reqCoverage.covered, 1);
    assert.equal(complete.signals.reqCoverage.total, 1);
    assert.equal(complete.signals.taskCompletion.checked, 2);
    assert.equal(complete.signals.taskCompletion.total, 2);
    assert.equal(complete.signals.taskEvidence.evidenced, 1);
    assert.equal(complete.signals.taskEvidence.considered, 1);
    assert.equal(complete.signals.artifactCompleteness.pct, 100);
    assert.equal(complete.fixHint, null);

    // Skeletal: reqCoverage 0/1, tasks 0/2, evidence n/a, artifacts 70% → F
    assert.ok(skeletal.score <= 40, `skeletal should score <=40, got ${skeletal.score}`);
    assert.equal(skeletal.grade, 'F');
    assert.equal(skeletal.signals.reqCoverage.covered, 0);
    assert.deepEqual(skeletal.signals.reqCoverage.uncovered, [FR2]);
    assert.equal(skeletal.signals.taskCompletion.checked, 0);
    // No checked task names a path → neutral, pct null
    assert.equal(skeletal.signals.taskEvidence.pct, null);
    assert.equal(skeletal.signals.artifactCompleteness.pct, 70);
    assert.equal(skeletal.signals.artifactCompleteness.plan, false);
    // Weakest applicable signal is the highest-weight zero: reqCoverage
    assert.equal(skeletal.weakest, 'reqCoverage');
    assert.match(skeletal.fixHint, new RegExp(FR2));
  });

  it('orders features worst-first in JSON and summary points at the worst', () => {
    dir = makeTwoFeatureRepo();
    const out = capture(() => runTraceFeatures(dir, CONFIG, { format: 'json' }));
    const parsed = JSON.parse(out);

    assert.equal(parsed.features.length, 2);
    assert.equal(parsed.features[0].name, '002-skeletal');
    assert.equal(parsed.features[1].name, '001-complete');
    assert.ok(parsed.features[0].score <= parsed.features[1].score);

    assert.equal(parsed.summary.features, 2);
    assert.equal(parsed.summary.worst.name, '002-skeletal');
    assert.equal(parsed.summary.worst.score, parsed.features[0].score);
    assert.equal(parsed.summary.avgScore,
      Math.round((parsed.features[0].score + parsed.features[1].score) / 2));
    assert.ok(parsed.timestamp);
  });

  it('emits the expected JSON shape per feature', () => {
    dir = makeTwoFeatureRepo();
    const out = capture(() => runTraceFeatures(dir, CONFIG, { format: 'json' }));
    const parsed = JSON.parse(out);

    for (const f of parsed.features) {
      assert.equal(typeof f.name, 'string');
      assert.equal(typeof f.dir, 'string');
      assert.match(f.dir, /^specs\//);
      assert.equal(typeof f.score, 'number');
      assert.match(f.grade, /^[ABCDF]$/);
      for (const key of ['reqCoverage', 'taskCompletion', 'taskEvidence', 'artifactCompleteness']) {
        assert.ok(f.signals[key], `signal ${key} present`);
      }
    }
  });

  it('renders text output worst-first with score, grade, signal detail and fix hint', () => {
    dir = makeTwoFeatureRepo();
    const out = capture(() => runTraceFeatures(dir, CONFIG, {}));

    assert.match(out, /DocGuard Trace \(features\)/);
    // Worst-first ordering in text mode
    const skeletalAt = out.indexOf('002-skeletal');
    const completeAt = out.indexOf('001-complete');
    assert.ok(skeletalAt !== -1 && completeAt !== -1);
    assert.ok(skeletalAt < completeAt, 'skeletal (worst) must render before complete');

    // n/m signal detail + weakest-signal hint for the skeletal feature
    assert.match(out, /0\/1 spec IDs referenced by tests/);
    assert.match(out, /0\/2 tasks checked/);
    assert.match(out, /no checked task names a file path/);
    assert.match(out, /spec ✓ · plan ✗ · tasks ✓/);
    assert.match(out, /Fix first:/);
    assert.match(out, new RegExp(FR2));

    // Summary line
    assert.match(out, /2 feature\(s\) · avg \d+\/100 · worst: /);
  });

  it('dispatches from runTrace when flags.features is set', () => {
    dir = makeTwoFeatureRepo();
    const out = capture(() => runTrace(dir, CONFIG, { features: true, format: 'json' }));
    const parsed = JSON.parse(out);
    assert.equal(parsed.features.length, 2);
    assert.equal(parsed.summary.worst.name, '002-skeletal');
  });

  it('reports N/A cleanly when no spec-kit features exist (text)', () => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-trace-feat-'));
    write(dir, 'src/index.js', 'console.log(1);\n');
    const out = capture(() => runTraceFeatures(dir, CONFIG, {}));
    assert.match(out, /No spec-kit features detected/);
    assert.match(out, /specify init/);
  });

  it('reports N/A cleanly when no spec-kit features exist (JSON stays parseable)', () => {
    dir = mkdtempSync(join(tmpdir(), 'docguard-trace-feat-'));
    const out = capture(() => runTraceFeatures(dir, CONFIG, { format: 'json' }));
    const parsed = JSON.parse(out);
    assert.deepEqual(parsed.features, []);
    assert.equal(parsed.summary.features, 0);
    assert.equal(parsed.summary.avgScore, null);
    assert.equal(parsed.summary.worst, null);
    assert.match(parsed.error, /no spec-kit features/);
  });
});
