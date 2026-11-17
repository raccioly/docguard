/**
 * Spec 104, Stage 5 (T043, FR-020, Decision 9): heading comparison normalizes to
 * NFC for every language, English included, so a composed accent (`ã`, U+00E3)
 * and a decomposed one (`a` + U+0303, what a macOS file name or a pasted heading
 * can carry) compare equal. The English path used to keep only `[a-z0-9]` runs,
 * so the two spellings of one heading produced different keys.
 *
 * Red before the change: the English-path cases (`requiredSections` with an
 * accented heading and no `docs.language`). Green before and after, by design:
 * the `docs.language` path, which folds diacritics already.
 *
 * @req docguard.document-languages#FR-020
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { docHasSection, findSectionHeading } from '../cli/shared.mjs';
import { labelContext, idForEnglishLabel } from '../cli/shared-labels.mjs';
import { isUneditedScaffold, templateText } from '../cli/shared-scaffold.mjs';

const composed = s => s.normalize('NFC');
const decomposed = s => s.normalize('NFD');
const doc = heading => `# Doc\n\n## ${heading}\n\nTexto.\n`;

describe('English path (no docs.language): a composed and a decomposed accent are the same heading', () => {
  for (const heading of ['Visão geral', 'Café Menu', 'Résumé of the Stack', 'Überblick']) {
    it(`"${heading}"`, () => {
      for (const asked of [composed(heading), decomposed(heading)]) {
        for (const written of [composed(heading), decomposed(heading)]) {
          assert.equal(docHasSection(doc(written), `## ${asked}`), true, `asked ${JSON.stringify(asked)}, written ${JSON.stringify(written)}`);
          assert.equal(findSectionHeading(doc(written), `## ${asked}`), 2);
        }
      }
    });
  }

  it('an unaccented heading still does not match an accented one it merely resembles', () => {
    assert.equal(docHasSection(doc('Cafe Menu'), `## ${composed('Café Menu')}`), false);
  });

  it('the registry\'s English lookup is unchanged', () => {
    assert.equal(idForEnglishLabel('## Tech Stack'), 'tech-stack');
    assert.equal(idForEnglishLabel(decomposed('Tech Stack')), 'tech-stack');
  });
});

describe('docs.language path: unchanged, accents already fold', () => {
  const labels = labelContext({ docs: { language: 'pt-BR' } });
  it('composed and decomposed headings satisfy the same alias', () => {
    for (const written of [composed('Visão geral do sistema'), decomposed('Visão geral do sistema'), 'Visao geral do sistema']) {
      assert.equal(docHasSection(doc(written), '## System Overview', labels), true, JSON.stringify(written));
    }
  });
  it('a docs.labelAliases entry in either form matches a heading in either form', () => {
    for (const alias of [composed('Feito até aqui'), decomposed('Feito até aqui')]) {
      const ctx = labelContext({ docs: { language: 'pt-BR', labelAliases: { 'success-criteria': [alias] } } });
      for (const written of [composed('Feito até aqui'), decomposed('Feito até aqui')]) {
        assert.equal(docHasSection(doc(written), '## Success Criteria', ctx), true);
      }
    }
  });
});

describe('scaffold comparison', () => {
  it('a heading written decomposed is the template\'s heading', () => {
    const template = templateText('ARCHITECTURE');
    assert.equal(isUneditedScaffold(template, 'ARCHITECTURE'), true);
    const custom = `${template}\n## ${decomposed('Decisões')}\n`;
    assert.equal(isUneditedScaffold(custom, 'ARCHITECTURE'), false);
  });
});
