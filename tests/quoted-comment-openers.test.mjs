/**
 * A quoted comment opener hides nothing (specs/074-quoted-comment-openers):
 * `<!--` inside an inline code span is text, so the requirement parser and
 * the instruction-pointer reader keep reading after it, while a real HTML
 * comment still hides what it holds.
 *
 * @req docguard.quoted-comment-openers#FR-001
 * @req docguard.quoted-comment-openers#FR-002
 * @req docguard.quoted-comment-openers#FR-003
 * @req docguard.quoted-comment-openers#FR-004
 * @req docguard.quoted-comment-openers#SC-001
 * @req docguard.quoted-comment-openers#SC-002
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectRequirementIdsFromContent } from '../cli/shared-requirements.mjs';
import { extractInstructionPointers } from '../cli/scanners/instruction-audit.mjs';
import { stripHtmlComments } from '../cli/shared-html-comments.mjs';

const ids = md => [...collectRequirementIdsFromContent(md, 'spec.md').values()].map(r => r.id);
const pointers = md => extractInstructionPointers(md).map(p => p.path);

describe('requirements after a quoted comment opener (FR-001)', () => {
  it('a single-backtick `<!--` opens nothing', () => {
    assert.deepEqual(ids('# S\n\n- **FR-001**: Strip the `<!--` marker.\n- **FR-002**: Second.\n- **FR-003**: Third.\n'), ['FR-001', 'FR-002', 'FR-003']);
  });
  it('a double-backtick span opens nothing either', () => {
    assert.deepEqual(ids('# S\n\n- **FR-001**: Quote ``a `<!--` b`` here.\n- **FR-002**: Second.\n'), ['FR-001', 'FR-002']);
  });
  it('only a run of the same length closes a span: a lone backtick inside a double-backtick span does not', () => {
    assert.deepEqual(ids('# S\n\n- **FR-001**: Quote ``x ` y <!-- z`` here.\n- **FR-002**: Second.\n'), ['FR-001', 'FR-002']);
  });
  it('inside a real comment, backticks are comment text: the comment ends at its first `-->`', () => {
    assert.deepEqual(ids('# S\n\n- **FR-001**: First.\n<!-- hidden: `-->`\n- **FR-009**: after the comment\n- **FR-002**: Second.\n'), ['FR-001', 'FR-009', 'FR-002']);
  });
  it('an ID inside a code span is still a declaration, as before', () => {
    assert.deepEqual(ids('# S\n\n- `FR-001`: Strip `<!--`.\n- `FR-002`: Second.\n'), ['FR-001', 'FR-002']);
  });
});

describe('real comments still hide what they hold (FR-003)', () => {
  it('a single-line comment', () => {
    assert.deepEqual(ids('# S\n\n- **FR-001**: First. <!-- FR-009 -->\n<!-- - **FR-008**: hidden -->\n- **FR-002**: Second.\n'), ['FR-001', 'FR-002']);
  });
  it('a multi-line comment', () => {
    assert.deepEqual(ids('# S\n\n- **FR-001**: First.\n<!--\n- **FR-009**: hidden\n-->\n- **FR-002**: Second.\n'), ['FR-001', 'FR-002']);
  });
  it('an unclosed backtick is literal, so a real opener after it still opens a comment', () => {
    assert.deepEqual(ids('# S\n\n- **FR-001**: A lone ` then <!--\n- **FR-009**: hidden\n-->\n- **FR-002**: Second.\n'), ['FR-001', 'FR-002']);
  });
  it('a comment ends at its first `-->`', () => {
    const r = stripHtmlComments('a --> b <!-- c --> d', true);
    assert.equal(r.text, ' b  d');
    assert.equal(r.inComment, false);
  });
});

describe('instruction pointers after a quoted opener (FR-002)', () => {
  it('a pointer on a later line is read', () => {
    const md = '# Agents\n\nWrap generated text in `<!-- docguard:section -->` and `<!--` markers.\n\nRead `docs/missing.md` first.\n';
    assert.ok(pointers(md).includes('docs/missing.md'), JSON.stringify(pointers(md)));
  });
  it('a pointer inside a real comment is not', () => {
    const md = '# Agents\n\n<!--\nRead `docs/hidden.md`.\n-->\nRead `docs/shown.md`.\n';
    assert.deepEqual(pointers(md), ['docs/shown.md']);
  });
});

describe('one implementation (FR-004)', () => {
  it('both readers import the shared helper and keep no tracker of their own', () => {
    for (const rel of ['cli/shared-requirements.mjs', 'cli/scanners/instruction-audit.mjs']) {
      const src = readFileSync(resolve(rel), 'utf8');
      assert.match(src, /shared-html-comments\.mjs/, rel);
      assert.doesNotMatch(src, /indexOf\('<!--'\)/, rel);
    }
  });
});

describe('this repository (SC-002)', () => {
  it('this spec declares every requirement, though its requirement lines quote `<!--`', () => {
    const md = readFileSync(resolve('specs/074-quoted-comment-openers/spec.md'), 'utf8');
    assert.match(md, /- \*\*FR-001\*\*:[^\n]*`<!--`/);
    assert.deepEqual(ids(md), ['FR-001', 'FR-002', 'FR-003', 'FR-004', 'SC-001', 'SC-002']);
  });
});
