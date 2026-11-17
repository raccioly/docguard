/**
 * One definition of an unedited scaffold: a canonical document whose authored
 * lines are all lines of the template `docguard init` wrote it from.
 *
 * Comparing with the shipped template is exact where placeholder heuristics
 * are not. `generate --plan --write` leaves the placeholder owner and the
 * unchosen status in place, so those cannot be evidence of an unedited
 * document, and the example rows of one template (REQUIREMENTS) are another
 * template's blank cells. A document that drifted from its template reads as
 * edited, which is the safe direction: a missed scaffold hides one warning, a
 * false scaffold would invent one.
 *
 * Zero NPM dependencies — pure Node.js built-ins.
 *
 * @implements docguard.doc-validator-fidelity#FR-006
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleMarkdown } from './shared-html-comments.mjs';
import { DOC_ROLES, docRolePath } from './shared-doc-roles.mjs';
import { findSectionHeading } from './shared.mjs';
import { firstAlias, headingMarkerLine, headingMarked, labelEntry, scanHeadingMarkers } from './shared-labels.mjs';
import { CANONICAL_SECTIONS } from './authoring-contract.mjs';

const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const PLACEHOLDER_OWNER = '@your-github-username';
const GENERATED_MARKER = /<!--\s*docguard:generated\b/;
// A reasoned section N/A marker is an authored decision about the document
// (`<!-- docguard:section authentication n/a — CLI, no auth -->`), so a
// document that carries one is owned, not unedited.
const OWNED_MARKER = /<!--\s*docguard:section\s+[A-Za-z0-9_-]+\s+n\/a\s*[—-]+\s*[A-Za-z0-9]/i;

const analysisCache = new Map();

/** Heading text as a matcher key: no `#`, no section number, lowercase alphanumerics. */
function headingKey(line) {
  return line.normalize('NFC').replace(/^#{1,6}\s*/, '').replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// A heading is compared as before (its text, lowercase alphanumerics) and, when
// a `docguard:heading` marker under it names an id, also by that id: a translated
// heading whose marker says `tech-stack` is the template's `## Tech Stack`. The
// id comes from the marker only, never from guessing that a heading's words are
// an alias, so a project without markers is compared exactly as before (D6).
function markerClaims(markdown) {
  const claims = new Map();
  for (const marker of scanHeadingMarkers(markdown).placed) if (marker.valid && !claims.has(marker.heading)) claims.set(marker.heading, marker.id);
  return claims;
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

/**
 * What a document says: its headings, and the lines that carry content once
 * comments, headings, dividers, the Metadata table, separator rows, empty
 * cells, dates and the placeholder owner are set aside.
 * @param {string} markdown
 * @returns {{ headings: Set<string>, headingIds: Map<string, string>, lines: Set<string> }}
 */
export function scaffoldLines(markdown) {
  const headings = new Set();
  const headingIds = new Map(); // heading key -> the id a marker gave it
  const lines = new Set();
  const claims = markerClaims(markdown);
  let inMetadata = false;
  for (const raw of visibleMarkdown(markdown).split('\n')) {
    const line = raw.trim();
    if (!line) { inMetadata = false; continue; }
    if (/^#{1,6}\s/.test(line)) {
      const key = headingKey(line);
      headings.add(key);
      if (claims.has(line)) headingIds.set(key, claims.get(line));
      inMetadata = false;
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) continue;
    if (line.startsWith('|')) {
      const cells = tableCells(line);
      if (cells.every(cell => /^:?-{2,}:?$/.test(cell) || cell === '')) continue;
      if (/^metadata$/i.test(cells[0]) && /^value$/i.test(cells[1] ?? '')) { inMetadata = true; continue; }
      if (inMetadata) continue;
    } else {
      inMetadata = false;
    }
    const normalized = line
      .replaceAll(PLACEHOLDER_OWNER, '')
      .replace(/\d{4}-\d{2}-\d{2}/g, 'YYYY-MM-DD')
      .replace(/\s+/g, ' ')
      .trim();
    if (normalized && !/^[|\s:-]*$/.test(normalized)) lines.add(normalized);
  }
  return { headings, headingIds, lines };
}

/** The template `docguard init` writes for a document, or null: `templateName` is `ARCHITECTURE` for `docs-canonical/ARCHITECTURE.md`. */
export function templateText(templateName) {
  const file = resolve(TEMPLATES, `${basename(String(templateName), '.md')}.md.template`);
  if (!/^[A-Z0-9-]+\.md\.template$/.test(basename(file)) || !existsSync(file)) return null;
  try { return readFileSync(file, 'utf-8'); } catch { return null; }
}

function templateAnalysis(templateName) {
  const key = basename(String(templateName), '.md');
  if (!analysisCache.has(key)) {
    const text = templateText(key);
    analysisCache.set(key, text === null ? null : scaffoldLines(text));
  }
  return analysisCache.get(key);
}

/**
 * True when `content` has nothing a reader wrote beyond its template.
 * A document with no shipped template is never a scaffold; neither is an empty
 * file or a bare skeleton of headings (no template line at all: STR003 judges
 * its sections), one that shares no heading with its template, or one carrying
 * a DocGuard-generated section or a reasoned section N/A marker.
 * @param {string} content - the document
 * @param {string} templateName - the template to compare with, e.g. `ARCHITECTURE`
 * @returns {boolean}
 */
export function isUneditedScaffold(content, templateName) {
  const template = templateAnalysis(templateName);
  if (!template || typeof content !== 'string' || !content.trim()) return false;
  if (GENERATED_MARKER.test(content) || OWNED_MARKER.test(content)) return false;
  const doc = scaffoldLines(content);
  if (doc.lines.size === 0) return false;
  // A heading the template does not have was written by someone (an entity
  // name in DATA-MODEL, a component in ARCHITECTURE). A heading whose marker
  // names an id is the template's heading for that id, in any language.
  const inTemplate = heading => template.headings.has(heading)
    || (doc.headingIds.has(heading) && (labelEntry(doc.headingIds.get(heading))?.en || []).some(label => template.headings.has(headingKey(label))));
  if ([...doc.headings].some(heading => !inTemplate(heading))) return false;
  if (![...doc.headings].some(inTemplate)) return false;
  return [...doc.lines].every(line => template.lines.has(line));
}

/** Placeholder text a scaffold still carries, for the finding message. */
export function scaffoldEvidence(content) {
  const evidence = [];
  if (String(content).includes(PLACEHOLDER_OWNER)) evidence.push(`owner ${PLACEHOLDER_OWNER}`);
  if (/docguard:status\s+draft\s*\|\s*review\s*\|\s*approved/.test(content)) evidence.push('status not chosen (draft | review | approved)');
  return evidence;
}

/**
 * The template name for a canonical document at `relPath`: the default name of
 * the role it fills when `docs.roles` remaps it (`docs/architecture.md` →
 * `ARCHITECTURE`), otherwise its own base name.
 * @param {object} config
 * @param {string} relPath - project-relative, `/`-separated
 * @returns {string}
 */
export function scaffoldTemplateName(config, relPath) {
  for (const role of Object.keys(DOC_ROLES)) {
    let mapped;
    try { mapped = docRolePath(config, role); } catch { continue; }
    if (mapped === relPath) return basename(DOC_ROLES[role], '.md');
  }
  return basename(String(relPath), '.md');
}

/**
 * The documents the scaffold check reports (STR006) and scores (docQuality):
 * the canonical documents STR003 checks. Machine markers excludes a scaffold
 * only among these, so every score it moves has a finding that explains it.
 */
export const SCAFFOLD_CHECKED = Object.freeze(['ARCHITECTURE', 'DATA-MODEL', 'SECURITY', 'TEST-SPEC', 'ENVIRONMENT']);

// ── Writing a scaffold in the project's language (spec 104 FR-023, D7) ────

// The headings a generated document carries an id for: the required sections of
// the authoring contract, plus the Test-Spec source-to-test map, which the
// Test-Spec validator resolves through the registry. Recommended headings (Layer
// Boundaries, Revision History, ...) stay as they are: some readers still match
// them by their English text, so relabeling them would hide them.
const EXTRA_IDS = Object.freeze({ 'TEST-SPEC': ['source-to-test-map'] });

function scaffoldIds(docName) {
  const name = basename(String(docName), '.md');
  const sections = CANONICAL_SECTIONS[`docs-canonical/${name}.md`];
  if (!sections) return [];
  return [...sections.filter(section => section.required).map(section => section.id), ...(EXTRA_IDS[name] || [])];
}

/** `## 5. Building Block View` with the label replaced and the section number kept. */
function relabel(line, alias) {
  const m = /^( {0,3}#{2,6}[ \t]+)(\d+(?:\.\d+)*\.?[ \t]+)?/.exec(line);
  return `${m[1]}${m[2] || ''}${alias}`;
}

/**
 * The marker under each required heading of a generated or templated document
 * and, for a `docs.language` with a built-in set, the heading written as the
 * first alias (a language without a set keeps the English heading, so the
 * marker alone carries the id). A heading is found the way STR003 finds it (the
 * English label or a synonym, `## 1. Introduction and Goals` for
 * `system-overview`), each id once, and a heading that already has a marker is
 * left alone. Only the document's required sections and the Test-Spec map are
 * read. Nothing but those headings and their marker lines changes.
 * @param {string} markdown a document DocGuard is about to create
 * @param {string} docName `ARCHITECTURE`, `DATA-MODEL`, `SECURITY`, `TEST-SPEC` or `ENVIRONMENT` (with or without `.md`)
 * @param {object|null} labels `labelContext(config)`
 * @returns {string}
 * @implements docguard.document-languages#FR-023
 */
export function languageReadyDocument(markdown, docName, labels = null) {
  let text = markdown;
  for (const id of scaffoldIds(docName)) {
    if (headingMarked(text, id)) continue;
    let at = -1;
    for (const label of labelEntry(id).en) {
      at = findSectionHeading(text, `## ${label}`, null);
      if (at >= 0) break;
    }
    if (at < 0) continue;
    const lines = text.split('\n');
    const alias = firstAlias(id, labels);
    if (alias) lines[at] = relabel(lines[at], alias);
    lines.splice(at + 1, 0, headingMarkerLine(id));
    text = lines.join('\n');
  }
  return text;
}

/**
 * The changelog `## [Unreleased]` heading in the project's language: for a
 * language with a built-in set `## [<first alias>]` plus the marker, exactly as
 * `fix --write` inserts it; English and a language without a set keep
 * `## [Unreleased]` with no marker (the bracketed label is Keep a Changelog's own).
 * @implements docguard.document-languages#FR-023
 */
export function languageReadyChangelog(markdown, labels = null) {
  const alias = firstAlias('unreleased', labels);
  if (!alias) return markdown;
  return markdown.replace(/^## \[Unreleased\][ \t]*$/m, () => `## [${alias}]\n${headingMarkerLine('unreleased')}`);
}

/** One entry for every writer of a template: the changelog heading or the registered headings of a canonical document. */
export function languageReadyScaffold(docName, markdown, labels = null) {
  return basename(String(docName), '.md') === 'CHANGELOG'
    ? languageReadyChangelog(markdown, labels)
    : languageReadyDocument(markdown, docName, labels);
}
