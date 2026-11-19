/**
 * Spec 105: the outcomes checked once rather than unit-tested, and the
 * documentation requirements (the pattern of `program-verification`).
 *
 * SC-001 to SC-004 and FR-030 are results of a run and a review: they are
 * checked by their recorded result in the spec's Verification Notes. FR-016 and
 * FR-029 are documentation: each named document carries the terms they ask for.
 *
 * @req docguard.glossary-and-plain-writing#FR-016
 * @req docguard.glossary-and-plain-writing#FR-029
 * @req docguard.glossary-and-plain-writing#FR-030
 * @req docguard.glossary-and-plain-writing#SC-001
 * @req docguard.glossary-and-plain-writing#SC-002
 * @req docguard.glossary-and-plain-writing#SC-003
 * @req docguard.glossary-and-plain-writing#SC-004
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SPEC = 'specs/105-glossary-and-plain-writing/spec.md';

function notes() {
  const spec = readFileSync(SPEC, 'utf8');
  const at = spec.indexOf('## Verification Notes');
  assert.ok(at >= 0, 'spec 105 has Verification Notes');
  const end = spec.indexOf('\n## ', at + 5);
  return spec.slice(at, end === -1 ? undefined : end);
}

/** Each document carries each term. */
function describes(table) {
  for (const [file, terms] of table) {
    const text = readFileSync(file, 'utf8');
    for (const term of terms) assert.ok(text.includes(term), `${file} mentions ${term}`);
  }
}

describe('spec 105 verification notes', () => {
  // @req docguard.glossary-and-plain-writing#SC-001
  // @req docguard.glossary-and-plain-writing#SC-002
  // @req docguard.glossary-and-plain-writing#SC-003
  // @req docguard.glossary-and-plain-writing#SC-004
  it('records SC-001 to SC-004', () => {
    const n = notes();
    for (const id of ['SC-001', 'SC-002', 'SC-003', 'SC-004']) assert.match(n, new RegExp(`\\b${id}\\b`));
    assert.match(n, /release-ab/);
    assert.match(n, /no exit code/);
  });

  // @req docguard.glossary-and-plain-writing#FR-030
  it('lists every non-English string for review (FR-030)', () => {
    const n = notes();
    assert.match(n, /FR-030/);
    for (const s of ['# Glossário', '# Glosario', 'Usar', 'Evitar', 'Significado', 'Definição']) assert.ok(n.includes(s), `review table lists ${s}`);
  });
});

describe('spec 105 documentation', () => {
  // @req docguard.glossary-and-plain-writing#FR-029
  it('documents the glossary, the six codes, the keys and the markers (FR-029)', () => describes([
    ['docs/configuration.md', ['docs.glossary', 'GLS001', 'GLS002', 'GLS003', 'GLS004', 'DQ009', 'DQ010', 'docQuality', 'sentenceLimit', 'stepSentenceLimit', 'docguard:glossary allow', 'docguard:glossary off', 'sentence-limit', 'step-verbs', 'init --with glossary', 'fix --doc glossary']],
    ['docs/languages.md', ['DQ009', 'DQ010', 'GLS001', 'Usar']],
    ['docs/reference/findings.md', ['GLS001', 'GLS002', 'GLS003', 'GLS004', 'DQ009', 'DQ010']],
    ['README.md', ['Glossary', 'DQ009', 'DQ010', 'GLS001']],
    ['CHANGELOG.md', ['GLS001', 'GLS002', 'GLS003', 'GLS004', 'DQ009', 'DQ010']],
  ]));

  // @req docguard.glossary-and-plain-writing#FR-016
  it('documents the opt-outs that replace validators.glossary: false under strict (FR-016)', () => describes([
    ['docs/configuration.md', ['docguard:validator glossary n/a', 'docguard:ignore GLS001']],
    ['cli/findings.mjs', ["'<!-- docguard:validator glossary n/a — reason -->'"]],
  ]));
});
