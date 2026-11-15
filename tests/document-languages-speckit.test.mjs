/**
 * Spec 104, Stage 2 (T020): Spec Kit documents and the lifecycle label in any
 * language.
 *
 * A Portuguese or Spanish `spec.md`, `plan.md`, `tasks.md` (`Fase 1`) and
 * bugfix spec produce no SPK003 to SPK005; `FR-` and `SC-` ids stay the
 * contract; `Estado:` and `Situação:` are read as the lifecycle label and the
 * retired words of the language make DLC001. No Spec Kit template is modified.
 *
 * Red on origin/main: every test that sets a language or a marker. Green on both
 * sides by design: the English-unchanged checks, the checks that a missing id is
 * still a finding, and "no template is modified".
 *
 * @req docguard.document-languages#FR-014
 * @req docguard.document-languages#FR-015
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { makeTempDir } from './helpers/temp-dir.mjs';
import { fixtureGit } from './helpers/git.mjs';
import { loadConfig } from '../cli/config.mjs';
import { labelContext } from '../cli/shared-labels.mjs';
import { validateSpecKitIntegration } from '../cli/scanners/speckit.mjs';
import { scanDocumentLifecycle } from '../cli/scanners/document-lifecycle.mjs';
import * as lifecycle from '../cli/scanners/lifecycle-status.mjs';

const { parseLifecycleStatus, RETIRED_STATUSES } = lifecycle;
// Namespace access: on a tree without the helpers the tests fail one by one instead of at import.
const isRetiredStatus = (...args) => lifecycle.isRetiredStatus(...args);
const isTerminalStatus = (...args) => lifecycle.isTerminalStatus(...args);

function project(files, docs) {
  const dir = makeTempDir('docguard-lang-speckit-');
  const all = { '.specify/memory/constitution.md': '# Constituição\n', ...files };
  if (docs) all['.docguard.json'] = JSON.stringify({ docs });
  for (const [rel, content] of Object.entries(all)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
const gitProject = (files, docs) => {
  const dir = project(files, docs);
  fixtureGit(dir, ['init', '-q']);
  fixtureGit(dir, ['add', '-A']);
  fixtureGit(dir, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'fixture']);
  return dir;
};
const spk = (result, ...codes) => (result.findings || []).filter(f => codes.includes(f.code));
const ctx = (language, labelAliases) => labelContext({ docs: { language, ...(labelAliases ? { labelAliases } : {}) } });

const PT = {
  'specs/001-coisa/spec.md': '# Especificação\n\n**Status**: Ativo\n\n## Cenários de usuário\n\n### História 1\n\nDado um usuário, quando age, então funciona.\n\n## Requisitos funcionais\n\n- **FR-001**: O sistema DEVE fazer a coisa.\n\n## Critérios de sucesso\n\n- **SC-001**: Funciona.\n',
  'specs/001-coisa/plan.md': '# Plano\n\n## Resumo\n\nx\n\n## Contexto técnico\n\nNode.\n\n## Estrutura do projeto\n\nsrc/\n',
  'specs/001-coisa/tasks.md': '# Tarefas\n\n## Fase 1: Preparação\n\n- [ ] T001 fazer\n',
};
const ES = {
  'specs/001-cosa/spec.md': '# Especificación\n\n**Estado**: Activo\n\n## Escenarios de usuario\n\n### Historia 1\n\nDado un usuario, cuando actúa, entonces funciona.\n\n## Requisitos funcionales\n\n- **FR-001**: El sistema DEBE hacer la cosa.\n\n## Criterios de éxito\n\n- **SC-001**: Funciona.\n',
  'specs/001-cosa/plan.md': '# Plan\n\n## Resumen\n\nx\n\n## Contexto técnico\n\nNode.\n\n## Estructura del proyecto\n\nsrc/\n',
  'specs/001-cosa/tasks.md': '# Tareas\n\n## Fase 1: Preparación\n\n- [ ] T001 hacer\n',
};

describe('SPK003 to SPK005 read Portuguese and Spanish documents (T020)', () => {
  for (const [language, files] of [['pt-BR', PT], ['es', ES], ['es-MX', ES]]) {
    it(`docs.language ${language}: no SPK003, SPK004 or SPK005; without a language they are reported`, () => {
      const dir = project(files, { language });
      assert.deepEqual(spk(validateSpecKitIntegration(dir, loadConfig(dir)), 'SPK003', 'SPK004', 'SPK005').map(f => f.message), []);
      const bare = project(files);
      const codes = new Set(spk(validateSpecKitIntegration(bare, loadConfig(bare)), 'SPK003', 'SPK004', 'SPK005').map(f => f.code));
      assert.deepEqual([...codes].sort(), ['SPK003', 'SPK004', 'SPK005']);
    });
  }

  it('the Fase pattern needs a number: "Fase" without one is still SPK005', () => {
    const dir = project({ ...PT, 'specs/001-coisa/tasks.md': '# Tarefas\n\n## Fase de preparação\n\n- [ ] T001 fazer\n' }, { language: 'pt-BR' });
    assert.equal(spk(validateSpecKitIntegration(dir, loadConfig(dir)), 'SPK005').length, 1);
  });

  it('a Portuguese bugfix spec states its root cause and fix', () => {
    const ok = project({ 'specs/001-erro/spec.md': '# Erro\n\n<!-- docguard:spec-type bugfix -->\n\n## Causa raiz\n\nx\n\n## Correção\n\ny\n' }, { language: 'pt-BR' });
    assert.deepEqual(spk(validateSpecKitIntegration(ok, loadConfig(ok)), 'SPK003'), []);
    const es = project({ 'specs/001-error/spec.md': '# Error\n\n<!-- docguard:spec-type bugfix -->\n\n## Causa raíz\n\nx\n\n## Corrección\n\ny\n' }, { language: 'es' });
    assert.deepEqual(spk(validateSpecKitIntegration(es, loadConfig(es)), 'SPK003'), []);
    const missing = project({ 'specs/001-erro/spec.md': '# Erro\n\n<!-- docguard:spec-type bugfix -->\n\n## Causa raiz\n\nx\n' }, { language: 'pt-BR' });
    assert.equal(spk(validateSpecKitIntegration(missing, loadConfig(missing)), 'SPK003').length, 1);
  });

  it('FR- and SC- ids are unchanged: a Portuguese spec without them is still reported', () => {
    const dir = project({ 'specs/001-coisa/spec.md': PT['specs/001-coisa/spec.md'].replace('FR-001', 'RF-001').replace('SC-001', 'CS-001') }, { language: 'pt-BR' });
    const messages = spk(validateSpecKitIntegration(dir, loadConfig(dir)), 'SPK003').map(f => f.message);
    assert.equal(messages.length, 2);
    assert.match(messages.join('\n'), /No requirement IDs found/);
    assert.match(messages.join('\n'), /No success criteria IDs found/);
  });

  it('the marker satisfies a section in any language, with and without docs.language', () => {
    const spec = '# Spec\n\n## Anforderungen\n<!-- docguard:heading requirements -->\n\n- **FR-001**: x\n\n## Szenarien\n<!-- docguard:heading user-scenarios -->\n\nx\n\n## Erfolgskriterien\n<!-- docguard:heading success-criteria -->\n\n- **SC-001**: x\n';
    for (const docs of [undefined, { language: 'de' }, { language: 'pt-BR' }]) {
      const dir = project({ 'specs/001-a/spec.md': spec }, docs);
      assert.deepEqual(spk(validateSpecKitIntegration(dir, loadConfig(dir)), 'SPK003'), [], JSON.stringify(docs));
    }
  });

  it('docs.labelAliases extends the set: a project wording clears the section', () => {
    const spec = PT['specs/001-coisa/spec.md'].replace('## Critérios de sucesso', '## Feito quando');
    const without = project({ 'specs/001-coisa/spec.md': spec }, { language: 'pt-BR' });
    assert.equal(spk(validateSpecKitIntegration(without, loadConfig(without)), 'SPK003').length, 1);
    const withAlias = project({ 'specs/001-coisa/spec.md': spec }, { language: 'pt-BR', labelAliases: { 'success-criteria': ['Feito quando'] } });
    assert.deepEqual(spk(validateSpecKitIntegration(withAlias, loadConfig(withAlias)), 'SPK003'), []);
  });

  it('a missing section under a configured language names the accepted headings and the marker (FR-010)', () => {
    const spec = PT['specs/001-coisa/spec.md'].replace('## Critérios de sucesso', '## Resultado esperado');
    const dir = project({ 'specs/001-coisa/spec.md': spec }, { language: 'pt-BR' });
    const [finding] = spk(validateSpecKitIntegration(dir, loadConfig(dir)), 'SPK003');
    assert.match(finding.message, /Missing mandatory section: "Success Criteria"/);
    assert.match(finding.message, /Critérios de sucesso/);
    assert.match(finding.message, /docguard:heading success-criteria/);
    assert.match(finding.message, /docs\.labelAliases\.success-criteria/);
  });

  it('a language with no set: no SPK003 to SPK005 for headings it cannot judge, the files are listed as not judged', () => {
    const files = {
      'specs/001-a/spec.md': '# Spec\n\n## Anforderungen\n\n- **FR-001**: x\n\n## Szenarien\n\nx\n\n## Erfolgskriterien\n\n- **SC-001**: x\n',
      'specs/001-a/plan.md': '# Plan\n\n## Zusammenfassung\n\nx\n',
      'specs/001-a/tasks.md': '# Aufgaben\n\n## Phase 1: Vorbereitung\n\n- [ ] T001 x\n',
    };
    const dir = project(files, { language: 'de' });
    const r = validateSpecKitIntegration(dir, loadConfig(dir));
    assert.deepEqual(spk(r, 'SPK003', 'SPK004').map(f => f.message), []);
    assert.deepEqual(r.languageNotSupported.map(e => e.file).sort(), ['specs/001-a/plan.md', 'specs/001-a/spec.md']);
    assert.ok(r.languageNotSupported.every(e => e.cause === 'language-not-supported' && e.language === 'de'));
  });

  it('English is unchanged: the legacy substring rule and messages, with no language and with "en"', () => {
    for (const docs of [undefined, { language: 'en' }]) {
      const dir = project({
        'specs/001-a/spec.md': '# Spec\n\n##### Requirements\n\nFR-001 x\n\n### User Scenarios\n\nx\n',
        'specs/001-a/plan.md': '# Plan\n\n## Overview\n\nx\n',
        'specs/001-a/tasks.md': '# Tasks\n\nPhase 2 work\n\n- [ ] T001 x\n',
      }, docs);
      const messages = spk(validateSpecKitIntegration(dir, loadConfig(dir)), 'SPK003', 'SPK004', 'SPK005').map(f => f.message);
      assert.deepEqual(messages, [
        'specs/001-a/spec.md: Missing mandatory section: "Requirements" (spec-kit spec-template.md)',
        'specs/001-a/spec.md: Missing mandatory section: "Success Criteria" (spec-kit spec-template.md)',
        'specs/001-a/spec.md: No success criteria IDs found (expected SC-001, SC-002, etc.)',
        'specs/001-a/plan.md: Missing mandatory section: "Summary" (spec-kit plan-template.md)',
        'specs/001-a/plan.md: Missing mandatory section: "Technical Context" (spec-kit plan-template.md)',
        'specs/001-a/plan.md: Missing mandatory section: "Project Structure" (spec-kit plan-template.md)',
      ]);
    }
  });
});

describe('the lifecycle label and the retired words (T020)', () => {
  it('parseLifecycleStatus reads Status, Situação and Estado with a language, folding accents', () => {
    assert.equal(parseLifecycleStatus('# T\n\n**Estado**: Obsoleto\n', ctx('es')), 'Obsoleto');
    assert.equal(parseLifecycleStatus('# T\n\nEstado: En desuso\n', ctx('es')), 'En desuso');
    assert.equal(parseLifecycleStatus('# T\n\n**Situação:** Substituído\n', ctx('pt-BR')), 'Substituído');
    assert.equal(parseLifecycleStatus('# T\n\nSituacao: Superado\n', ctx('pt')), 'Superado');
    assert.equal(parseLifecycleStatus('# T\n\n**Status**: Obsoleto\n', ctx('pt')), 'Obsoleto');
    assert.equal(parseLifecycleStatus('# T\n\n## Estado\n\nObsoleto\n', ctx('es')), 'Obsoleto');
  });

  it('a label of another language, or no language, reads nothing new', () => {
    assert.equal(parseLifecycleStatus('# T\n\nEstado: Obsoleto\n'), null);
    assert.equal(parseLifecycleStatus('# T\n\nEstado: Obsoleto\n', ctx('pt')), null);
    assert.equal(parseLifecycleStatus('# T\n\nStatus: Active\n', ctx('pt')), 'Active');
  });

  it('the project can add a label through docs.labelAliases', () => {
    assert.equal(parseLifecycleStatus('# T\n\nZustand: Obsoleto\n', ctx('de', { 'lifecycle-status': ['Zustand'] })), 'Obsoleto');
  });

  it('isRetiredStatus: the English set always, the aliases of deprecated and superseded for the language; nothing invented', () => {
    assert.ok(isRetiredStatus('Archived', ctx('pt')));
    assert.ok(isRetiredStatus('obsoleto', ctx('pt')));
    assert.ok(isRetiredStatus('Substituído', ctx('pt-BR')));
    assert.ok(isRetiredStatus('Descontinuado', ctx('pt')));
    assert.ok(isRetiredStatus('En desuso', ctx('es')));
    assert.ok(isRetiredStatus('sustituido', ctx('es')));
    assert.ok(!isRetiredStatus('Arquivado', ctx('pt')), 'archived has no D2 translation; a project adds one through docs.labelAliases');
    assert.ok(isRetiredStatus('Arquivado', ctx('pt', { deprecated: ['Arquivado'] })));
    assert.ok(!isRetiredStatus('Ativo', ctx('pt')));
    assert.ok(!isRetiredStatus('obsoleto', null), 'without a language, nothing is inferred');
    assert.deepEqual([...RETIRED_STATUSES].sort(), ['archived', 'deprecated', 'obsolete', 'superseded']);
  });

  it('isTerminalStatus: the legacy words, plus the same aliases', () => {
    assert.ok(isTerminalStatus('Superseded by 003', null));
    assert.ok(isTerminalStatus('Abandoned', ctx('pt')));
    assert.ok(isTerminalStatus('Substituído por 003', ctx('pt')));
    assert.ok(isTerminalStatus('Obsoleto', ctx('es')));
    assert.ok(!isTerminalStatus('Ativo', ctx('pt')));
    assert.ok(!isTerminalStatus('Substituído por 003', null));
  });

  it('the document-lifecycle scan makes DLC001 for a retired Portuguese or Spanish document, and not without the language', () => {
    const files = { 'docs/a.md': '# A\n\n**Situação**: Obsoleto\n\nTexto.\n', 'docs/b.md': '# B\n\n**Estado**: Sustituido\n', 'docs/c.md': '# C\n\n**Status**: Ativo\n', 'README.md': '# R\n' };
    const dir = gitProject(files, { language: 'es' });
    const es = scanDocumentLifecycle(dir, loadConfig(dir)).candidates.filter(c => c.code === 'DLC001').map(c => c.path);
    assert.deepEqual(es, ['docs/b.md']);
    const pt = gitProject(files, { language: 'pt-BR' });
    assert.deepEqual(scanDocumentLifecycle(pt, loadConfig(pt)).candidates.filter(c => c.code === 'DLC001').map(c => c.path), ['docs/a.md']);
    const bare = gitProject(files);
    assert.deepEqual(scanDocumentLifecycle(bare, loadConfig(bare)).candidates.filter(c => c.code === 'DLC001'), []);
  });
});

describe('no Spec Kit template is modified (T020)', () => {
  it('validating Portuguese specs leaves .specify/templates byte-identical', () => {
    const template = '# [FEATURE NAME]\n\n## User Scenarios & Testing *(mandatory)*\n\n## Requirements *(mandatory)*\n\n## Success Criteria *(mandatory)*\n';
    const dir = project({ ...PT, '.specify/templates/spec-template.md': template, '.specify/templates/plan-template.md': '# Plan\n\n## Summary\n', '.specify/templates/tasks-template.md': '# Tasks\n\n## Phase 1: Setup\n' }, { language: 'pt-BR' });
    const hash = () => readdirSync(join(dir, '.specify/templates')).sort().map(name => `${name}:${createHash('sha256').update(readFileSync(join(dir, '.specify/templates', name))).digest('hex')}`);
    const before = hash();
    validateSpecKitIntegration(dir, loadConfig(dir));
    assert.deepEqual(hash(), before);
  });
});
