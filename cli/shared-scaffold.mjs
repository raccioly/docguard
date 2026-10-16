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
  return line.replace(/^#{1,6}\s*/, '').replace(/^\d+(?:\.\d+)*\.?\s+/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
}

/**
 * What a document says: its headings, and the lines that carry content once
 * comments, headings, dividers, the Metadata table, separator rows, empty
 * cells, dates and the placeholder owner are set aside.
 * @param {string} markdown
 * @returns {{ headings: Set<string>, lines: Set<string> }}
 */
export function scaffoldLines(markdown) {
  const headings = new Set();
  const lines = new Set();
  let inMetadata = false;
  for (const raw of visibleMarkdown(markdown).split('\n')) {
    const line = raw.trim();
    if (!line) { inMetadata = false; continue; }
    if (/^#{1,6}\s/.test(line)) { headings.add(headingKey(line)); inMetadata = false; continue; }
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
  return { headings, lines };
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
  if (![...doc.headings].some(heading => template.headings.has(heading))) return false;
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
