/**
 * The slot rule of cli/shared-requirement-ids.mjs: a template slot in a requirement's text makes it a
 * template row; the same characters inside an inline code span, or inside a span that wraps past the end of
 * the line, are code. `hasPlaceholderSlot` is the slot-only test (Traceability), `isPlaceholderRequirement`
 * adds the empty-text rule (Requirement-Anchors).
 *
 * @req docguard.strict-by-default#FR-006
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateTraceability } from '../cli/validators/traceability.mjs';
import { classifyRequirementIds, hasPlaceholderSlot, isPlaceholderRequirement } from '../cli/shared-requirement-ids.mjs';

const def = text => ({ id: 'FR-001', file: 'specs/001-x/spec.md', text: `- **FR-001**: ${text}` });

describe('shared requirement IDs: template slots', () => {
  it('square, angle and curly slots make a row a template row', () => {
    for (const text of ['System MUST [capability]', 'System MUST <capability>', 'System MUST {{behaviour}}']) {
      assert.equal(hasPlaceholderSlot(def(text)), true, text);
      assert.equal(isPlaceholderRequirement(def(text)), true, text);
    }
  });

  it('the same characters inside an inline code span are code, not a slot', () => {
    for (const text of ['The cut MUST move the `[Unreleased]` body', 'It MUST accept `--stage [slug]`', 'It MUST print `{ mode, asOf }`', 'It MUST list `pending: [...]`']) {
      assert.equal(hasPlaceholderSlot(def(text)), false, text);
      assert.equal(isPlaceholderRequirement(def(text)), false, text);
    }
  });

  it('a code span that wraps onto the next line is code to the end of the line', () => {
    assert.equal(hasPlaceholderSlot(def('`tool approve --id <id> [--delivery')), false);
  });

  it('a bare ID has no slot but is still an empty-text row for Requirement-Anchors', () => {
    const bare = { id: 'REQ-901', file: 'REQUIREMENTS.md', text: 'REQ-901' };
    assert.equal(hasPlaceholderSlot(bare), false);
    assert.equal(isPlaceholderRequirement(bare), true);
  });
});

// spec 097 T018h. A row is a template row only when nothing but the slot carries the requirement: remove every slot
// token and what is left must be the bare scaffold of a requirement sentence (an optional subject of up to three
// words, a modal verb, and at most a couple of filler words), or nothing. A sentence that still states something
// once the slots are gone is a real requirement that mentions a variable.
export const REAL_REQUIREMENTS_WITH_SLOT_TOKENS = {
  'curly variables inside the sentence': 'The exporter MUST write {file} to the output directory and log {count} rows',
  'a URL template': 'The service MUST resolve https://api.example.com/{name} to the owning account',
  'a key template': 'Each record MUST be stored under the key {name}:{region} and expire after 24 hours',
  'an angle variable mid-sentence': 'The loader MUST read the data for <region> before it accepts requests',
  'a slot at the end of the sentence': 'The exporter MUST write the finished report to {file}',
  'a message template in quotes': 'The CLI MUST print "{count} files changed" and exit with code 0',
  'a bracket word mid-sentence': 'The importer MUST skip rows marked [deprecated] and report how many it skipped',
};

// Every placeholder requirement line of Spec Kit's spec template (.specify/templates/spec-template.md), and the
// row of the DocGuard requirements template, as they are written there.
export const SPEC_KIT_TEMPLATE_ROWS = {
  'FR-001': 'System MUST [specific capability, e.g., "allow users to create accounts"]',
  'FR-002': 'System MUST [specific capability, e.g., "validate email addresses"]',
  'FR-003': 'Users MUST be able to [key interaction, e.g., "reset their password"]',
  'FR-004': 'System MUST [data requirement, e.g., "persist user preferences"]',
  'FR-005': 'System MUST [behavior, e.g., "log all security events"]',
  'SC-001': '[Measurable metric, e.g., "Users can complete account creation in under 2 minutes"]',
  'SC-002': '[Measurable metric, e.g., "System handles 1000 concurrent users without degradation"]',
  'SC-003': '[User satisfaction metric, e.g., "90% of users successfully complete primary task on first attempt"]',
  'SC-004': '[Business metric, e.g., "Reduce support tickets related to [X] by 50%"]',
};

describe('shared requirement IDs: a slot token inside a real sentence (T018h)', () => {
  for (const [kind, text] of Object.entries(REAL_REQUIREMENTS_WITH_SLOT_TOKENS)) {
    it(`${kind} is a real requirement, counted and traced`, () => {
      assert.equal(hasPlaceholderSlot(def(text)), false, text);
      assert.equal(isPlaceholderRequirement(def(text)), false, text);
      const { requirements, placeholders } = classifyRequirementIds([def(text)]);
      assert.equal(requirements.length, 1);
      assert.equal(placeholders, 0);
    });
  }
  for (const [id, text] of Object.entries(SPEC_KIT_TEMPLATE_ROWS)) {
    it(`Spec Kit template row ${id} is a template row`, () => {
      const row = { id, file: 'specs/001-x/spec.md', text: `- **${id}**: ${text}` };
      assert.equal(isPlaceholderRequirement(row), true, text);
      assert.equal(classifyRequirementIds([row]).requirements.length, 0);
    });
  }
  it('every placeholder requirement line of the Spec Kit template in this repository is a template row', () => {
    const file = new URL('../.specify/templates/spec-template.md', import.meta.url);
    if (!existsSync(file)) return;
    const lines = readFileSync(file, 'utf8').split('\n').filter(l => /^- \*\*(?:FR|SC|NFR)-\d+\*\*:/.test(l) && /\[[^\]]*[A-Za-z]/.test(l));
    assert.ok(lines.length >= 9, `found ${lines.length} template lines`);
    for (const line of lines) {
      const id = line.match(/\*\*((?:FR|SC|NFR)-\d+)\*\*/)[1];
      // The two "Example of marking unclear requirements" lines are the one kind that states a sentence
      // around a [NEEDS CLARIFICATION] marker; the template document itself is excluded as a document.
      const unclear = /NEEDS CLARIFICATION/.test(line);
      const row = { id, file: 'specs/001-x/spec.md', text: line };
      assert.equal(isPlaceholderRequirement(row), !unclear, line);
      assert.equal(classifyRequirementIds([{ ...row, file: '.specify/templates/spec-template.md' }]).requirements.length, 0, line);
    }
  });
  it('a DocGuard requirements-template table row is a template row; a filled default row is not', () => {
    const tmpl = { id: 'FR-001', file: 'docs-canonical/REQUIREMENTS.md', text: '| FR-001 | P1 | System MUST [capability] | 🔴 Draft | ❌ |' };
    assert.equal(isPlaceholderRequirement(tmpl), true);
    const sc = { id: 'SC-001', file: 'docs-canonical/REQUIREMENTS.md', text: '| SC-001 | [Measurable user outcome] | [How measured] | [Target value] |' };
    assert.equal(isPlaceholderRequirement(sc), true);
    const filled = { id: 'NFR-002', file: 'docs-canonical/REQUIREMENTS.md', text: '| NFR-002 | Security | All endpoints require authentication | Validated by guard |' };
    assert.equal(isPlaceholderRequirement(filled), false);
    const owner = { id: 'FR-002', file: 'docs-canonical/REQUIREMENTS.md', text: '| FR-002 | P1 | The system MUST page the list | [owner] |' };
    assert.equal(isPlaceholderRequirement(owner), false, 'a slot in another cell does not make the requirement cell a template');
  });
  it('the scaffold forms: a subject, a modal verb and at most a couple of filler words', () => {
    for (const text of ['System MUST <x>', 'The system SHOULD {{x}}', 'Users MUST be able to [x]', 'The system MUST support [x]', 'It shall not [x]', '[x]', '<x>']) {
      assert.equal(isPlaceholderRequirement(def(text)), true, text);
    }
    for (const text of ['System MUST authenticate users via [method]', 'The system MUST provide [x] to every caller']) {
      assert.equal(isPlaceholderRequirement(def(text)), false, text);
    }
  });
});

describe('the validators keep a real requirement that mentions a slot token (T018h)', () => {
  const build = () => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-slot-'));
    const ids = Object.keys(REAL_REQUIREMENTS_WITH_SLOT_TOKENS).map((_, i) => `FR-${String(i + 1).padStart(3, '0')}`);
    const rows = Object.values(REAL_REQUIREMENTS_WITH_SLOT_TOKENS).map((text, i) => `- **${ids[i]}**: ${text}`);
    mkdirSync(join(dir, 'specs', '001-x'), { recursive: true });
    mkdirSync(join(dir, 'tests'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'specs', '001-x', 'spec.md'), `# Feature: X\n\n## Requirements\n\n${rows.join('\n')}\n\n- **FR-099**: System MUST [specific capability]\n`);
    writeFileSync(join(dir, 'src', 'a.mjs'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'tests', 'a.test.mjs'), `// ${ids.map(i => `@req ${i}`).join(' ')}\nimport test from 'node:test';\ntest('a', () => {});\n`);
    return { dir, ids };
  };
  it('Traceability examines every real requirement, skips the template row, and reports no orphan test', () => {
    const { dir, ids } = build();
    try {
      const result = validateTraceability(dir, { requiredFiles: { canonical: [] }, traceability: {} });
      const text = JSON.stringify(result.findings ?? result.warnings);
      for (const id of ids) assert.doesNotMatch(text, new RegExp(`TRC005[^]*${id}\\b[^]*no such requirement|${id}[^]*not defined`, 'i'), id);
      assert.ok(!(result.findings || []).some(f => f.code === 'TRC005'), text);
      assert.ok(result.total >= ids.length, `total ${result.total}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('an ID line with no text (T018h)', () => {
  it('is a template row when nothing is written under it, and a requirement when its text is on the lines below', () => {
    const bare = { id: 'SC-001', file: 'specs/001-x/spec.md', text: '- **SC-001**:', block: '- **SC-001**:' };
    assert.equal(isPlaceholderRequirement(bare), true);
    const wrapped = { ...bare, block: '- **SC-001**:\n  - With the assets listed, `specs complete` no longer lists any file as unresolved.' };
    assert.equal(isPlaceholderRequirement(wrapped), false);
  });
});
