/**
 * Detecting documents by NAME rather than by exact path.
 *
 * Three detectors probed for literal filenames — canonical docs, TODO tracking
 * docs, and test directories. That misses every spelling not in the list
 * (`PLAN.md`, `docs/ROADMAP.md`, `testing/`), and it is case-insensitive only by
 * accident: `existsSync(resolve(dir, 'ROADMAP.md'))` matches `roadmap.md` on
 * macOS and not on Linux, so CI and a laptop judged the same repository
 * differently. Reading directories and normalising the names fixes both.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { findDocsByName, normaliseDocName } from '../cli/shared-doc-roles.mjs';
import { validateTodoTracking } from '../cli/validators/todo-tracking.mjs';

const TRACKING = ['roadmap', 'currentstate', 'todo', 'backlog', 'plan', 'tasks'];
const DIRS = ['', 'docs', 'documentation', 'docs-canonical'];

describe('findDocsByName', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dg-names-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('matches case and separators explicitly, not by filesystem accident', () => {
    writeFileSync(join(dir, 'roadmap.md'), '#');
    writeFileSync(join(dir, 'CURRENT_STATE.md'), '#');
    const found = findDocsByName(dir, TRACKING, DIRS);
    assert.deepEqual(found.sort(), ['CURRENT_STATE.md', 'roadmap.md'],
      'lowercase and underscored spellings must match on every platform');
  });

  it('searches conventional documentation directories, not just the root', () => {
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs/ROADMAP.md'), '#');
    assert.deepEqual(findDocsByName(dir, TRACKING, DIRS), ['docs/ROADMAP.md']);
  });

  it('accepts alias names for the same concept', () => {
    writeFileSync(join(dir, 'PLAN.md'), '#');
    writeFileSync(join(dir, 'TASKS.md'), '#');
    assert.equal(findDocsByName(dir, TRACKING, DIRS).length, 2);
  });

  it('does not claim unrelated documents', () => {
    for (const n of ['README.md', 'NOTES.md', 'LICENSE', 'roadmap.txt']) {
      writeFileSync(join(dir, n), '#');
    }
    assert.deepEqual(findDocsByName(dir, TRACKING, DIRS), [],
      'a loose matcher would be worse than no matcher');
    assert.equal(normaliseDocName('roadmap.txt'), null, 'non-Markdown is not a document');
  });
});

describe('TODO tracking follows the document, wherever it is named', () => {
  let dir;
  const TODO = 'wire up the retry budget for the upload path';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dg-todo-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/a.mjs'), `// TODO: ${TODO}\nexport const x = 1;\n`);
  });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  const untracked = () => {
    const r = validateTodoTracking(dir, {});
    return (r.findings || []).filter(f => f.code === 'TDO002').length;
  };

  for (const path of ['ROADMAP.md', 'PLAN.md', 'TASKS.md', 'docs/ROADMAP.md']) {
    it(`counts ${path} as a tracking document`, () => {
      const full = join(dir, path);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, `# Plan\n\n- ${TODO} (src/a.mjs)\n`);
      assert.equal(untracked(), 0, `${path} should track the TODO`);
    });
  }

  it('does not treat README or NOTES as a work list', () => {
    writeFileSync(join(dir, 'README.md'), `# R\n\n- ${TODO} (src/a.mjs)\n`);
    writeFileSync(join(dir, 'NOTES.md'), `# N\n\n- ${TODO} (src/a.mjs)\n`);
    assert.ok(untracked() > 0, 'mentioning a TODO in the README is not tracking it');
  });
});
