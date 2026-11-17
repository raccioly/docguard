/**
 * The label registry (specs/104-document-languages): one closed list of the
 * structural labels DocGuard looks for, each with a stable id, its English
 * label and the aliases of the languages that ship a built-in set (`pt`, `es`).
 * Validators ask "does this heading satisfy id X" through `docHasSection` and
 * `findSectionHeading` (cli/shared.mjs), which read this module; none keeps its
 * own English string for a label that is registered here.
 *
 * This module is a leaf (it imports nothing), so `shared.mjs` can import it.
 * It owns: the registry, the language configuration reader (`docs.language`,
 * `docs.labelAliases`), the heading-marker reader and the Unicode folding the
 * non-English path compares with. The legacy English normalizer stays in
 * `shared.mjs` and is the only one an English project ever meets.
 *
 * The language-neutral form of a label is a comment on the line under a
 * heading: `<!-- docguard:heading <id> -->`. It does not begin with `section`,
 * so the bounded-block grammar of `writers/sections.mjs` never reads it.
 *
 * @implements docguard.document-languages#FR-003
 * @implements docguard.document-languages#FR-004
 * @implements docguard.document-languages#FR-007
 */

/**
 * `kind: 'heading'` ids are what a `docguard:heading` marker may name.
 * `kind: 'word'` ids are words the later stages read (status words, the link
 * words of a supersession, the lifecycle label, `Phase`); they live in the same
 * closed namespace so `docs.labelAliases` has one key space, but no marker
 * names them.
 *
 * Aliases are data to be reviewed by a native speaker (spec 104, D2). They are
 * structural labels (headings), not the prose word lists of Doc-Quality, which
 * stay disabled for every language but English until that review is recorded.
 */
export const LABELS = Object.freeze([
  // ARCHITECTURE.md
  { id: 'system-overview', group: 'architecture', kind: 'heading', en: ['System Overview'], pt: ['Visão geral do sistema', 'Visão geral', 'Panorama do sistema'], es: ['Visión general del sistema', 'Descripción general del sistema', 'Visión general', 'Resumen del sistema'] },
  { id: 'component-map', group: 'architecture', kind: 'heading', en: ['Component Map'], pt: ['Mapa de componentes', 'Componentes'], es: ['Mapa de componentes', 'Componentes'] },
  { id: 'tech-stack', group: 'architecture', kind: 'heading', en: ['Tech Stack'], pt: ['Pilha tecnológica', 'Stack tecnológica', 'Tecnologias', 'Tecnologias utilizadas'], es: ['Stack tecnológico', 'Pila tecnológica', 'Tecnologías'] },
  { id: 'layer-boundaries', group: 'architecture', kind: 'heading', en: ['Layer Boundaries'], pt: ['Limites entre camadas', 'Camadas'], es: ['Límites entre capas', 'Capas'] },
  { id: 'data-flow', group: 'architecture', kind: 'heading', en: ['Data Flow'], pt: ['Fluxo de dados'], es: ['Flujo de datos'] },
  { id: 'external-dependencies', group: 'architecture', kind: 'heading', en: ['External Dependencies'], pt: [], es: [] },
  { id: 'revision-history', group: 'architecture', kind: 'heading', en: ['Revision History'], pt: [], es: [] },
  // DATA-MODEL.md
  { id: 'entities', group: 'data-model', kind: 'heading', en: ['Entities'], pt: ['Entidades', 'Modelo de dados'], es: ['Entidades', 'Modelo de datos'] },
  { id: 'relationships', group: 'data-model', kind: 'heading', en: ['Relationships'], pt: ['Relacionamentos'], es: ['Relaciones'] },
  { id: 'indexes', group: 'data-model', kind: 'heading', en: ['Indexes'], pt: ['Índices'], es: ['Índices'] },
  // SECURITY.md
  { id: 'authentication', group: 'security', kind: 'heading', en: ['Authentication'], pt: ['Autenticação'], es: ['Autenticación'] },
  { id: 'secrets-management', group: 'security', kind: 'heading', en: ['Secrets Management'], pt: ['Gerenciamento de segredos', 'Gestão de segredos'], es: ['Gestión de secretos'] },
  { id: 'authorization', group: 'security', kind: 'heading', en: ['Authorization'], pt: ['Autorização'], es: ['Autorización'] },
  { id: 'security-boundaries', group: 'security', kind: 'heading', en: ['Security Boundaries'], pt: ['Fronteiras de segurança'], es: ['Límites de seguridad'] },
  // TEST-SPEC.md
  { id: 'test-categories', group: 'test-spec', kind: 'heading', en: ['Test Categories'], pt: ['Categorias de teste'], es: ['Categorías de pruebas'] },
  { id: 'coverage-rules', group: 'test-spec', kind: 'heading', en: ['Coverage Rules'], pt: ['Regras de cobertura'], es: ['Reglas de cobertura'] },
  { id: 'test-commands', group: 'test-spec', kind: 'heading', en: ['Test Commands'], pt: ['Comandos de teste'], es: ['Comandos de prueba'] },
  { id: 'source-to-test-map', group: 'test-spec', kind: 'heading', en: ['Source-to-Test Map', 'Service-to-Test Map'], pt: ['Mapa de fontes para testes', 'Mapa de código para testes'], es: ['Mapa de código a pruebas'] },
  // ENVIRONMENT.md
  { id: 'environment-variables', group: 'environment', kind: 'heading', en: ['Environment Variables'], pt: ['Variáveis de ambiente'], es: ['Variables de entorno'] },
  { id: 'setup-steps', group: 'environment', kind: 'heading', en: ['Setup Steps'], pt: ['Passos de configuração', 'Instalação e configuração', 'Como configurar'], es: ['Pasos de configuración', 'Instalación y configuración'] },
  { id: 'prerequisites', group: 'environment', kind: 'heading', en: ['Prerequisites'], pt: ['Pré-requisitos'], es: ['Requisitos previos'] },
  { id: 'configuration-files', group: 'environment', kind: 'heading', en: ['Configuration Files'], pt: ['Arquivos de configuração'], es: ['Archivos de configuración'] },
  // README.md
  { id: 'installation', group: 'readme', kind: 'heading', en: ['Installation'], pt: ['Instalação'], es: ['Instalación'] },
  { id: 'usage', group: 'readme', kind: 'heading', en: ['Usage'], pt: ['Uso', 'Como usar'], es: ['Uso', 'Cómo usar'] },
  { id: 'license', group: 'readme', kind: 'heading', en: ['License', 'Licence'], pt: ['Licença'], es: ['Licencia'] },
  { id: 'contributing', group: 'readme', kind: 'heading', en: ['Contributing'], pt: ['Contribuindo', 'Como contribuir'], es: ['Contribuir', 'Cómo contribuir'] },
  // Spec Kit documents (read by Stage 2)
  { id: 'user-scenarios', group: 'spec', kind: 'heading', en: ['User Scenarios'], pt: ['Cenários de usuário', 'Histórias de usuário', 'Cenários e testes'], es: ['Escenarios de usuario', 'Historias de usuario'] },
  { id: 'requirements', group: 'spec', kind: 'heading', en: ['Requirements'], pt: ['Requisitos', 'Requisitos funcionais'], es: ['Requisitos', 'Requisitos funcionales'] },
  { id: 'success-criteria', group: 'spec', kind: 'heading', en: ['Success Criteria'], pt: ['Critérios de sucesso', 'Critérios de aceite'], es: ['Criterios de éxito', 'Criterios de aceptación'] },
  { id: 'summary', group: 'plan', kind: 'heading', en: ['Summary'], pt: ['Resumo'], es: ['Resumen'] },
  { id: 'technical-context', group: 'plan', kind: 'heading', en: ['Technical Context'], pt: ['Contexto técnico'], es: ['Contexto técnico'] },
  { id: 'project-structure', group: 'plan', kind: 'heading', en: ['Project Structure'], pt: ['Estrutura do projeto'], es: ['Estructura del proyecto'] },
  { id: 'phase', group: 'tasks', kind: 'word', en: ['Phase'], pt: ['Fase'], es: ['Fase'] },
  { id: 'root-cause', group: 'bugfix', kind: 'heading', en: ['Root Cause'], pt: ['Causa raiz'], es: ['Causa raíz'] },
  { id: 'fix', group: 'bugfix', kind: 'heading', en: ['Fix'], pt: ['Correção'], es: ['Corrección'] },
  // CHANGELOG.md: the section is `## [<label>]`; the brackets are syntax, not part of the label.
  { id: 'unreleased', group: 'changelog', kind: 'heading', en: ['Unreleased'], pt: ['Não lançado', 'Não publicado'], es: ['Sin publicar', 'No publicado'] },
  // Decision records (read by Stage 2)
  { id: 'proposed', group: 'decision-status', kind: 'word', en: ['proposed'], pt: ['proposto', 'proposta', 'rascunho'], es: ['propuesto', 'propuesta', 'borrador'] },
  { id: 'accepted', group: 'decision-status', kind: 'word', en: ['accepted'], pt: ['aceito', 'aceita', 'aprovado', 'aprovada'], es: ['aceptado', 'aceptada', 'aprobado', 'aprobada'] },
  { id: 'rejected', group: 'decision-status', kind: 'word', en: ['rejected'], pt: ['rejeitado', 'rejeitada', 'recusado'], es: ['rechazado', 'rechazada'] },
  { id: 'deprecated', group: 'decision-status', kind: 'word', en: ['deprecated'], pt: ['obsoleto', 'descontinuado', 'depreciado'], es: ['obsoleto', 'en desuso', 'deprecado'] },
  { id: 'superseded', group: 'decision-status', kind: 'word', en: ['superseded'], pt: ['substituído', 'substituída', 'superado'], es: ['sustituido', 'sustituida', 'reemplazado', 'superado'] },
  { id: 'supersedes', group: 'decision-link', kind: 'word', en: ['Supersedes'], pt: ['Substitui'], es: ['Sustituye'] },
  { id: 'superseded-by', group: 'decision-link', kind: 'word', en: ['Superseded by'], pt: ['Substituído por'], es: ['Sustituido por'] },
  // Lifecycle `Status:` field label (read by Stage 2)
  { id: 'lifecycle-status', group: 'lifecycle', kind: 'word', en: ['Status'], pt: ['Status', 'Situação'], es: ['Estado'] },
]);

const BY_ID = new Map(LABELS.map(entry => [entry.id, entry]));

/** Languages that ship a built-in alias set, by primary subtag. */
export const BUILTIN_LANGUAGES = Object.freeze(['pt', 'es']);

/** Every id, in registry order. */
export function labelIds() {
  return LABELS.map(entry => entry.id);
}

/** The ids a `docguard:heading` marker may name. */
export function headingIds() {
  return LABELS.filter(entry => entry.kind === 'heading').map(entry => entry.id);
}

export function labelEntry(id) {
  return BY_ID.get(id) || null;
}

/**
 * The legacy English comparison key (lowercase, `[a-z0-9]` runs), the one
 * `shared.mjs` normalizes headings with. Duplicated here only for the registry
 * lookup of an English label; a test pins the two against each other.
 */
function englishKey(text) {
  return String(text)
    .normalize('NFC')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const EN_INDEX = new Map();
for (const entry of LABELS) for (const label of entry.en) EN_INDEX.set(englishKey(label), entry.id);

/** The id whose English label is `text` ("## Tech Stack", "Tech Stack"), or null. */
export function idForEnglishLabel(text) {
  const key = englishKey(text);
  return key && EN_INDEX.has(key) ? EN_INDEX.get(key) : null;
}

/**
 * Compare labels the way the non-English path does: drop the `#` markers and a
 * leading section number, fold case and diacritics (NFD, strip combining marks)
 * and keep Unicode letters and digits (spec 104 FR-006). `Visao geral` and
 * `Visão geral` fold to the same key; so do `5.4 Camadas` and `Camadas`.
 */
export function foldHeading(text) {
  return String(text)
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// ── Language configuration ────────────────────────────────────────────────

/**
 * A pragmatic BCP 47 check: a 2- or 3-letter primary language, an optional
 * script, region and variants. `Intl.getCanonicalLocales` also accepts 5 to 8
 * letter primary subtags, so a word such as "english" would pass it; the
 * primary subtag is required to be a language code, not a word.
 */
const TAG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|\d{3}))?(?:-(?:[A-Za-z0-9]{5,8}|\d[A-Za-z0-9]{3}))*$/;

/** The primary subtag of a valid BCP 47 tag (`pt-BR` is `pt`), or null. */
export function primaryLanguage(tag) {
  if (typeof tag !== 'string' || !TAG_RE.test(tag)) return null;
  try { Intl.getCanonicalLocales(tag); } catch { return null; }
  return tag.split('-')[0].toLowerCase();
}

const ID_SET = new Set(LABELS.map(entry => entry.id));

/**
 * Read `docs.language` and `docs.labelAliases`. Never throws: a malformed value
 * is reported in `problems` and ignored, so a run continues as English only
 * (spec 104 FR-007).
 * @returns {{ language: string|null, tag: string|null, aliases: Object<string,string[]>, problems: string[] }}
 */
export function readLabelConfig(docs) {
  const problems = [];
  const out = { language: null, tag: null, aliases: {}, problems };
  if (!docs || typeof docs !== 'object' || Array.isArray(docs)) return out;
  if (docs.language !== undefined) {
    const primary = primaryLanguage(docs.language);
    if (primary) { out.language = primary; out.tag = docs.language; }
    else problems.push(`docs.language ${JSON.stringify(docs.language)} is not a BCP 47 language tag (for example "pt-BR", "es" or "de"); treating the documents as English only`);
  }
  if (docs.labelAliases !== undefined) {
    const aliases = docs.labelAliases;
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
      problems.push('docs.labelAliases must be an object keyed by label id, each value a list of strings; ignoring it');
    } else {
      for (const [id, list] of Object.entries(aliases)) {
        if (!ID_SET.has(id)) { problems.push(`docs.labelAliases.${id} is not a label id (the closed list is in \`docguard explain STR009\`); ignoring it`); continue; }
        if (!Array.isArray(list) || list.some(item => typeof item !== 'string' || !item.trim())) { problems.push(`docs.labelAliases.${id} must be a list of non-empty strings; ignoring it`); continue; }
        out.aliases[id] = list.map(item => item.trim());
      }
    }
  }
  return out;
}

/**
 * The label context a validator passes to `docHasSection`: null for a project
 * without a valid `docs.language` (today's behavior byte for byte; project
 * aliases are inert without a language, D6), else
 * `{ language, tag, unicode, builtin, unsupported, project }`.
 *   - `unicode`     the language is not English: compare with `foldHeading`
 *   - `builtin`     the language ships an alias set (`pt`, `es`)
 *   - `unsupported` a valid language with no set (`de`) and not English: a
 *                   missing label is reported as not judgeable, never STR003
 *   - `project`     `docs.labelAliases`, by id
 */
export function labelContext(config) {
  const read = readLabelConfig(config?.docs);
  if (!read.language) return null;
  return contextFor(read.language, read.tag, read.aliases);
}

function contextFor(language, tag, project) {
  const english = language === 'en';
  const builtin = BUILTIN_LANGUAGES.includes(language);
  return Object.freeze({
    language,
    tag,
    unicode: !english,
    builtin,
    unsupported: !english && !builtin,
    project,
  });
}

/** The aliases of `id` for a context: the built-in set first, then the project's. */
export function aliasesFor(id, ctx) {
  if (!ctx) return [];
  const entry = BY_ID.get(id);
  const builtin = entry && ctx.builtin ? entry[ctx.language] || [] : [];
  return [...builtin, ...(ctx.project[id] || [])];
}

/** The label a writer puts in a heading: the first alias of the built-in set, else null. */
export function firstAlias(id, ctx) {
  const entry = BY_ID.get(id);
  return entry && ctx?.builtin ? (entry[ctx.language] || [])[0] ?? null : null;
}

/**
 * The accepted forms of a heading, for a finding's message: the aliases of the
 * configured language and the project's own, the English label, and the marker.
 * Empty without a configured language, so an English project's messages do not change.
 */
export function acceptedFormsHint(id, ctx) {
  if (!ctx || !ID_SET.has(id)) return '';
  // docs.language "en" with no aliases for the id has nothing to add: the message is the English one (FR-006).
  if (ctx.language === 'en' && !(ctx.project[id] || []).length) return '';
  const entry = BY_ID.get(id);
  const forms = [...aliasesFor(id, ctx), ...entry.en].map(text => `"${text}"`);
  const marker = entry.kind === 'heading' ? `, or put <!-- docguard:heading ${id} --> on the line under the heading you already have` : '';
  return ` Accepted headings for "${id}" with docs.language "${ctx.tag}": ${forms.join(', ')}${marker}; your own wording goes in docs.labelAliases.${id}.`;
}

/**
 * One entry of a validator's `unexaminedDocuments` for the cause
 * `language-not-supported`: a document whose labels DocGuard cannot judge
 * because its language has no built-in set (spec 104 FR-011, FR-019). It is the
 * only carrier of the cause: the strict report reads it from there (Stage 1 and
 * 2 kept a separate `languageNotSupported` list and a `partial` applicability;
 * both are gone, so there is one mechanism). `blocking: false` because the
 * project cannot resolve it by declaring more than the fix names, and DocGuard
 * has no rules to apply to it.
 */
export function unsupportedEntry(file, ids, ctx) {
  const word = ids.length > 0 && ids.every(id => BY_ID.get(id)?.kind === 'word');
  const sections = [...new Set(ids)];
  const howToConfigure = word
    ? `Add the words to docs.labelAliases.<id> in .docguard.json (the ids: ${sections.join(', ')}), write them in English, or ask for a built-in set for "${ctx.tag}".`
    : `Write <!-- docguard:heading <id> --> on the line under each heading, add the heading to docs.labelAliases.<id> in .docguard.json, or ask for a built-in set for "${ctx.tag}".`;
  return {
    path: file,
    cause: LANGUAGE_NOT_SUPPORTED,
    blocking: false,
    language: ctx.language,
    tag: ctx.tag,
    sections,
    what: word ? 'word' : 'heading',
    reason: `${sections.length} ${word ? 'word label(s)' : 'required heading(s)'} of ${file} not judged: docs.language "${ctx.tag}" has no built-in ${word ? 'word' : 'heading'} set and the document carries no ${word ? 'docs.labelAliases entry' : '<!-- docguard:heading <id> --> marker or docs.labelAliases entry'} for ${sections.join(', ')}`,
    howToConfigure,
  };
}

/** The cause a check reports for a document it cannot judge because of its language (spec 104 FR-019). */
export const LANGUAGE_NOT_SUPPORTED = 'language-not-supported';

/**
 * A document that a check skipped because its rules read English prose (or
 * English words) and the document's language has none: Doc-Quality's prose
 * metrics, Docs-Diff, Metrics-Consistency and semantic claims (spec 104 FR-017,
 * FR-022). Same shape as `unsupportedEntry`, so strict reads one thing.
 * @param {string} file project-relative path
 * @param {object} ctx the document's label context
 * @param {string} what what was not read, for the reason (`'the tech stack'`, `'documented counts'`)
 */
export function unreadEntry(file, ctx, what) {
  return {
    path: file,
    cause: LANGUAGE_NOT_SUPPORTED,
    blocking: false,
    language: ctx.language,
    tag: ctx.tag,
    sections: [],
    what: 'prose',
    reason: `${file} not read for ${what}: the rules read English prose and docs.language "${ctx.tag}" is not English`,
    howToConfigure: `Nothing in this document is wrong and nothing needs configuring: these checks have rules for English only (rules for "${ctx.tag}" need a word list that a native speaker has reviewed, spec 104 T033), so the document is reported here instead of being passed silently.`,
  };
}

/** Scripts whose words are not separated by spaces; sentence length counts spaces, so it is not meaningful for them. */
export const NO_WORD_SPACING = Object.freeze(['zh', 'ja', 'th', 'lo', 'km', 'my']);

/** Whether a document's script separates words with spaces (a closed list of primary subtags, never read from text). */
export function separatesWords(ctx) {
  return !ctx || !NO_WORD_SPACING.includes(ctx.language);
}

// ── Per-document language (spec 104 FR-021) ───────────────────────────────

/** ISO 639-1 language codes: a dotted suffix is a language only when it is one of these. */
const ISO_639_1 = new Set('aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'.split(' '));

/**
 * A language tag as it appears in a name: an ISO 639-1 primary subtag, then an
 * optional script (`Hans`) or region (`BR`, `419`). Three-letter suffixes such
 * as `old`, `api` or `dev` are never languages here, and neither are two-letter
 * words that are not codes (`xx`).
 */
function tagFromName(text) {
  const m = /^([A-Za-z]{2})(?:-([A-Za-z]{4}|[A-Za-z]{2}|\d{3}))?$/.exec(text);
  if (!m || !ISO_639_1.has(m[1].toLowerCase())) return null;
  return text;
}

/**
 * The language tag a document's name gives: `<name>.<lang>.md`, or an
 * `i18n/<lang>/` or `locales/<lang>/` folder segment (spec 104 FR-021,
 * Decision 5). Only the name decides, never the text. The file name wins over a
 * folder, and the deepest folder over a shallower one. Null when the name says
 * nothing.
 * @param {string} relPath project-relative path
 */
export function languageFromNaming(relPath) {
  const parts = String(relPath).replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const file = parts[parts.length - 1];
  const named = /^.+\.([A-Za-z0-9-]+)\.md$/i.exec(file);
  if (named) {
    const tag = tagFromName(named[1]);
    if (tag) return tag;
  }
  for (let i = parts.length - 2; i >= 1; i--) {
    if (/^(?:i18n|locales)$/i.test(parts[i - 1])) {
      const tag = tagFromName(parts[i]);
      if (tag) return tag;
    }
  }
  return null;
}

/**
 * The label context of one document: the project's `labelContext(config)`, or,
 * when the document's name carries a language, the context of that language with
 * the project's aliases. Null without `docs.language`: nothing is inferred
 * (FR-021). An agent-instruction file is excluded by `documentLanguage`
 * (cli/shared-doc-language.mjs), which is what callers use.
 */
export function documentLabelContext(config, relPath) {
  const base = labelContext(config);
  if (!base) return null;
  const tag = languageFromNaming(relPath);
  if (!tag) return base;
  const language = primaryLanguage(tag);
  if (!language) return base;
  return language === base.language ? base : contextFor(language, tag, base.project);
}

// ── The heading marker ────────────────────────────────────────────────────

const MARKER_RE = /^[ \t]*<!--\s*docguard:heading\s+([A-Za-z0-9][\w-]*)\s*-->[ \t]*$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}#{1,6}[ \t]+\S/;

/** Whether a document may carry a marker at all (a cheap test before scanning). */
export function mentionsHeadingMarker(content) {
  return String(content).includes('docguard:heading');
}

/**
 * Read every `<!-- docguard:heading <id> -->` line of a document. One function
 * reads the marker and every consumer calls it (spec 104 FR-004).
 *
 * A marker is placed when the previous non-blank line is a heading and the
 * marker is outside a code fence and outside any larger comment block. Any
 * other marker line is misplaced and satisfies nothing.
 *
 * @returns {{ placed: Array<{ id: string, line: number, headingLine: number, heading: string, valid: boolean, duplicate: boolean }>,
 *             misplaced: Array<{ id: string, line: number, reason: 'fence'|'comment'|'not-under-heading' }> }}
 *   lines are 0-based
 */
export function scanHeadingMarkers(content) {
  const placed = [];
  const misplaced = [];
  const text = String(content);
  if (!mentionsHeadingMarker(text)) return { placed, misplaced };
  const lines = text.split('\n');
  const seen = new Set();
  let fence = null;
  let inComment = false;
  let previous = null; // the last non-blank line outside fences and comments: a heading, or something else
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      const m = FENCE_RE.exec(line);
      if (m && m[1][0] === fence[0]) { fence = null; previous = { heading: false }; }
      else {
        const marker = MARKER_RE.exec(line);
        if (marker && ID_SET.has(marker[1])) misplaced.push({ id: marker[1], line: i, reason: 'fence' });
      }
      continue;
    }
    if (inComment) {
      const marker = MARKER_RE.exec(line);
      if (marker && ID_SET.has(marker[1])) misplaced.push({ id: marker[1], line: i, reason: 'comment' });
      if (line.includes('-->')) { inComment = false; previous = { heading: false }; }
      continue;
    }
    if (line.trim() === '') continue;
    const open = FENCE_RE.exec(line);
    if (open) { fence = open[1]; previous = { heading: false }; continue; }
    const marker = MARKER_RE.exec(line);
    if (marker) {
      const id = marker[1];
      if (previous?.heading) {
        const valid = BY_ID.get(id)?.kind === 'heading';
        const duplicate = valid && seen.has(id);
        if (valid) seen.add(id);
        placed.push({ id, line: i, headingLine: previous.line, heading: previous.text, valid, duplicate });
      } else if (ID_SET.has(id)) misplaced.push({ id, line: i, reason: 'not-under-heading' });
      previous = { heading: false };
      continue;
    }
    if (line.includes('<!--') && !line.slice(line.indexOf('<!--')).includes('-->')) { inComment = true; previous = { heading: false }; continue; }
    previous = HEADING_RE.test(line) ? { heading: true, line: i, text: line.trim() } : { heading: false };
  }
  return { placed, misplaced };
}

/**
 * STR009 evidence: a marker that names an unknown id, a second marker for an
 * id, a marker whose heading is another label's English heading, and a
 * misplaced marker that names a valid id. A marker on a heading wins over the
 * heading's text, so the conflict is a warning, never a different result.
 * @returns {Array<{ kind: 'unknown-id'|'duplicate-id'|'conflict'|'misplaced', line: number, id: string, message: string }>} 1-based lines
 */
export function headingMarkerIssues(content) {
  const { placed, misplaced } = scanHeadingMarkers(content);
  const issues = [];
  const valid = headingIds().join(', ');
  for (const marker of placed) {
    if (!marker.valid) {
      issues.push({ kind: 'unknown-id', line: marker.line + 1, id: marker.id, message: `line ${marker.line + 1}: <!-- docguard:heading ${marker.id} --> names an id DocGuard does not know, so it satisfies nothing. Valid ids: ${valid}.` });
      continue;
    }
    if (marker.duplicate) {
      issues.push({ kind: 'duplicate-id', line: marker.line + 1, id: marker.id, message: `line ${marker.line + 1}: a second heading is marked "${marker.id}"; the first marked heading counts and this one is ignored.` });
    }
    const other = idForEnglishLabel(marker.heading);
    if (other && other !== marker.id) {
      issues.push({ kind: 'conflict', line: marker.line + 1, id: marker.id, message: `line ${marker.line + 1}: the heading ${JSON.stringify(marker.heading.replace(/^#+\s*/, ''))} is the English label of "${other}", but its marker says "${marker.id}". The marker wins, so "${other}" is not satisfied by this heading; fix whichever is wrong.` });
    }
  }
  for (const marker of misplaced) {
    const where = marker.reason === 'fence' ? 'inside a code fence' : marker.reason === 'comment' ? 'inside a larger comment' : 'not on the line directly under a heading';
    issues.push({ kind: 'misplaced', line: marker.line + 1, id: marker.id, message: `line ${marker.line + 1}: <!-- docguard:heading ${marker.id} --> is ${where}, so it is ignored. Put it on the next non-blank line under the heading it names.` });
  }
  return issues.sort((a, b) => a.line - b.line);
}

// ── Readers for changelog, decisions, lifecycle and Spec Kit (Stage 2) ─────

/** Fold case and diacritics, nothing else: `Substituído` becomes `substituido`. */
export function foldText(text) {
  return String(text).normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** The aliases of several ids, built-in set first, then the project's (empty without a context). */
export function aliasesOfIds(ids, ctx) {
  return ids.flatMap(id => aliasesFor(id, ctx));
}

/**
 * Whether a document's `docguard:heading` marker names `id` on a heading. A
 * marker is explicit, so it counts with and without `docs.language` (D6).
 */
export function headingMarked(content, id) {
  if (!mentionsHeadingMarker(content)) return false;
  return scanHeadingMarkers(content).placed.some(marker => marker.valid && marker.id === id);
}

/**
 * How a heading of `id` is written in `content`, beyond the English label the
 * caller's legacy rule already matched: `'marker'` for a `docguard:heading`
 * marker under a heading, `'alias'` for a heading that equals (whole heading,
 * folded, a leading section number and any `[` `]` dropped) an alias of the
 * configured language or of `docs.labelAliases`, else null. English labels are
 * not matched here: a caller keeps its legacy English rule first, so an English
 * project (no language, or "en" with no aliases for the id) meets only the
 * marker.
 * @param {{ minLevel?: number, maxLevel?: number }} [levels] heading levels read (default 1 to 6)
 * @returns {'marker'|'alias'|null}
 */
export function headingLabelVia(content, id, ctx, { minLevel = 1, maxLevel = 6 } = {}) {
  if (headingMarked(content, id)) return 'marker';
  const aliases = aliasesFor(id, ctx);
  if (!aliases.length) return null;
  const keys = new Set(aliases.map(foldHeading).filter(Boolean));
  let fence = null;
  for (const line of String(content).split('\n')) {
    const open = FENCE_RE.exec(line);
    if (fence) { if (open && open[1][0] === fence[0]) fence = null; continue; }
    if (open) { fence = open[1]; continue; }
    // Linear in the line: `foldHeading` drops a closing `#` run like any other punctuation.
    const m = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
    if (!m || m[1].length < minLevel || m[1].length > maxLevel) continue;
    if (keys.has(foldHeading(m[2]))) return 'alias';
  }
  return null;
}

/**
 * The state of the changelog's `unreleased` section: `present` (the legacy
 * substring test, a marker, or an alias heading `## [<alias>]`), `unsupported`
 * (absent, and `docs.language` has no built-in set), else `missing`.
 * @implements docguard.document-languages#FR-012
 */
export function unreleasedState(content, ctx) {
  const text = String(content);
  if (text.includes('[Unreleased]') || text.includes('[unreleased]')) return 'present';
  if (headingLabelVia(text, 'unreleased', ctx, { minLevel: 2 })) return 'present';
  return ctx?.unsupported ? 'unsupported' : 'missing';
}

const STATUS_IDS = Object.freeze(['proposed', 'accepted', 'rejected', 'deprecated', 'superseded']);
export const DECISION_STATUS_IDS = STATUS_IDS;

/**
 * The id of a decision-status word written in the language's words or the
 * project's, or null: the raw text is cleaned, folded, and matched against the
 * longest alias that is the whole text or its leading words (`en desuso desde
 * 2026` is `deprecated`). English words are the caller's legacy rule.
 * @implements docguard.document-languages#FR-013
 */
export function statusIdFor(raw, ctx) {
  if (!ctx) return null;
  const text = foldHeading(String(raw).replace(/[*_`]/g, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' '));
  if (!text) return null;
  let best = null;
  for (const id of STATUS_IDS) {
    for (const alias of aliasesFor(id, ctx)) {
      const key = foldHeading(alias);
      if (key && (text === key || text.startsWith(`${key} `)) && (!best || key.length > best.key.length)) best = { id, key };
    }
  }
  return best ? best.id : null;
}

/** For DEC001's message: the accepted words of the language and the project, by id. Empty without any. */
export function statusWordsHint(ctx) {
  if (!ctx) return '';
  const parts = STATUS_IDS.map(id => [id, aliasesFor(id, ctx)]).filter(([, words]) => words.length).map(([id, words]) => `${id}: ${words.join(', ')}`);
  if (!parts.length) return '';
  return ` Accepted words for docs.language "${ctx.tag}" (English words are always accepted): ${parts.join('; ')}. Your own wording goes in docs.labelAliases.<id>.`;
}

/** The folded labels of a lifecycle or decision `Status` line: English `status` and the aliases of the language. */
export function lifecycleLabelKeys(ctx) {
  return new Set(['status', ...aliasesFor('lifecycle-status', ctx).map(foldHeading)]);
}

function retiredKeys(ctx) {
  return [...new Set(aliasesOfIds(['deprecated', 'superseded'], ctx).map(foldHeading).filter(Boolean))];
}

/**
 * Whether a lifecycle status value is a retired word of the language: the whole
 * value, folded, equals an alias of `deprecated` or `superseded` (built-in set
 * and `docs.labelAliases`). The English words are the caller's legacy set.
 * @implements docguard.document-languages#FR-014
 */
export function isRetiredWord(status, ctx) {
  if (!ctx || !status) return false;
  const key = foldHeading(status);
  return !!key && retiredKeys(ctx).includes(key);
}

/** Whether a lifecycle status value is a `superseded` word of the language (the whole value, folded). */
export function isSupersededWord(status, ctx) {
  if (!ctx || !status) return false;
  const key = foldHeading(status);
  return !!key && aliasesFor('superseded', ctx).map(foldHeading).includes(key);
}

/** Whether a status line contains a terminal word of the language (a whole-word match of an alias of `deprecated` or `superseded`). */
export function hasTerminalWord(text, ctx) {
  if (!ctx || !text) return false;
  const padded = ` ${foldHeading(text)} `;
  return retiredKeys(ctx).some(key => padded.includes(` ${key} `));
}

/**
 * Whether a document names `Phase <n>` in the language's word (`Fase 1`), by a
 * word of `phase` (built-in set and `docs.labelAliases`) before a number.
 */
export function hasPhaseWord(content, ctx) {
  const words = aliasesFor('phase', ctx).map(foldText).filter(Boolean);
  if (!words.length) return false;
  const folded = foldText(content);
  return words.some(word => new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d`, 'u').test(folded));
}

// ── Writers and help (Stage 4) ────────────────────────────────────────────

/** The heading ids of one document group (`architecture`, `data-model`, `security`, `test-spec`, `environment`, `readme`, `spec`, `plan`, `bugfix`, `changelog`), in registry order. */
export function headingIdsOfGroup(group) {
  return LABELS.filter(entry => entry.kind === 'heading' && entry.group === group).map(entry => entry.id);
}

/** The marker line for an id, as written under a heading. */
export function headingMarkerLine(id) {
  return `<!-- docguard:heading ${id} -->`;
}

/**
 * The paragraph `explain`, the findings help and the generated reference carry
 * for a finding that reads these ids (spec 104 FR-024): each id with its
 * marker (headings only), its English label and the built-in aliases, and how
 * the three ways of satisfying it work. Generated from the registry, so the
 * help cannot drift from what the validators accept.
 * @param {string[]} ids registry ids
 * @implements docguard.document-languages#FR-024
 */
export function labelHelp(ids) {
  const entries = ids.map(id => BY_ID.get(id)).filter(Boolean);
  const form = entry => {
    const forms = [`English: ${entry.en.join(' / ')}`];
    for (const lang of BUILTIN_LANGUAGES) forms.push(`${lang}: ${entry[lang].length ? entry[lang].join(', ') : 'no alias yet'}`);
    return `\`${entry.id}\`${entry.kind === 'heading' ? ` (${headingMarkerLine(entry.id)})` : ''} [${forms.join('; ')}]`;
  };
  const headings = entries.filter(entry => entry.kind === 'heading');
  const words = entries.filter(entry => entry.kind === 'word');
  const parts = [];
  if (headings.length) {
    parts.push(`Matched by id, not by English text. Headings: ${headings.map(form).join('; ')}. A heading in any language counts when the marker is on the line under it (it works in every language and without docs.language), when docs.language selects the built-in set for it (\`pt\` and \`es\`; English is always accepted), or when docs.labelAliases.<id> in .docguard.json lists it.`);
  }
  if (words.length) {
    parts.push(`Matched by id, not by English text. Words: ${words.map(form).join('; ')}. These are words, not headings, so there is no marker: they match by alias only (docs.language selects the built-in \`pt\` and \`es\` words; English is always accepted; docs.labelAliases.<id> adds your own wording and never replaces the built-in ones).`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** The closed id lists STR009 and the generated reference print: heading ids (a marker may name them) and word ids (docs.labelAliases only). */
export function labelIdLists() {
  return {
    headings: headingIds(),
    words: LABELS.filter(entry => entry.kind === 'word').map(entry => entry.id),
  };
}
