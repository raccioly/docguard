/**
 * Section-addressable docs — the foundation for surgical, non-destructive doc
 * maintenance.
 *
 * Canonical docs mix two kinds of content:
 *   - CODE-DERIVED sections (endpoint tables, entity lists, env-var tables) that
 *     DocGuard can regenerate from the codebase, and
 *   - HUMAN prose (rationale, "why", design intent) that must NEVER be clobbered.
 *
 * We mark the regenerable regions with HTML comments so the doc stays plain,
 * readable markdown:
 *
 *   <!-- docguard:section id=api-endpoints source=code -->
 *   | `GET` | `/api/x` | … |
 *   <!-- /docguard:section -->
 *
 * DocGuard rewrites ONLY the bytes between a section's open/close markers.
 * Everything outside any marker (the human writing) is preserved exactly.
 *
 * Pure string transforms — idempotent, no disk I/O. Zero NPM dependencies.
 */

import { findSectionHeading } from '../shared.mjs';
import { firstAlias, idForEnglishLabel } from '../shared-labels.mjs';

const OPEN_RE = /^[ \t]*<!--\s*docguard:section\b([^>]*?)-->[ \t]*$/;
const CLOSE_RE = /^[ \t]*<!--\s*\/docguard:section\s*-->[ \t]*$/;

/** Parse `id=foo source=code` style attributes from an open-marker tail. */
function parseAttrs(attrStr) {
  const attrs = {};
  const re = /(\w[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

/**
 * Parse all well-formed sections in a document.
 * A section is an open-marker line, then content lines, then a close-marker
 * line. Sections are FLAT — there is no nesting.
 *
 * Two malformed cases are handled so that a hand-edit mistake can never cause
 * a later regenerate to overwrite human prose:
 *   - An open with no matching close (reached EOF) is dropped, not returned.
 *   - A NEW open encountered while a previous one is still unclosed means the
 *     previous open was malformed (its close was deleted or typo'd). We ABANDON
 *     the previous open and restart at the new one. The earlier, broken
 *     approach kept the first open and paired it with the *next* section's
 *     close — swallowing the human prose and the next section into one body,
 *     which a subsequent replaceSection() would then silently overwrite.
 * A dropped section simply isn't returned, so replaceSection() no-ops on it
 * (returns content unchanged) instead of corrupting the surrounding document.
 * @returns {Array<{ id, source, attrs, openLine, closeLine, body }>}
 */
export function parseSections(content) {
  return inspectSections(content).sections;
}

/**
 * Parse sections and retain malformed-marker evidence for write authorization.
 * @implements docguard.document-languages#FR-002
 */
export function inspectSections(content) {
  const lines = String(content).split('\n');
  const sections = [];
  const issues = [];
  let open = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CLOSE_RE.test(line)) {
      if (open !== null) {
        sections.push({
          id: open.attrs.id || '',
          source: open.attrs.source || 'code',
          attrs: open.attrs,
          openLine: open.openLine,
          closeLine: i,
          body: lines.slice(open.openLine + 1, i).join('\n'),
        });
        open = null;
      } else issues.push({ code: 'unmatched-close', line: i + 1 });
      continue;
    }
    const om = line.match(OPEN_RE);
    if (om) {
      // A comment with no `id=` (the `n/a` marker, a bare id) names a section
      // but does not open a bounded block: it has nothing to close, so it
      // neither abandons an open block nor leaves one open
      // (docguard.document-languages#FR-002).
      const attrs = parseAttrs(om[1] || '');
      if (!Object.hasOwn(attrs, 'id')) continue;
      // Abandon any still-open (malformed) section; start fresh here.
      if (open !== null) issues.push({ code: 'nested-or-unclosed', line: open.openLine + 1 });
      open = { attrs, openLine: i };
    }
  }
  if (open !== null) issues.push({ code: 'unclosed', line: open.openLine + 1 });
  const counts = new Map();
  for (const section of sections) {
    if (!section.id) issues.push({ code: 'missing-id', line: section.openLine + 1 });
    counts.set(section.id, (counts.get(section.id) || 0) + 1);
  }
  for (const [id, count] of counts) if (id && count > 1) issues.push({ code: 'duplicate-id', id, count });
  return { sections, issues };
}

/**
 * Return the unique code-owned section or throw before a mapped write.
 * @implements docguard.language-repository-coverage#FR-009
 */
export function assertOwnedCodeSection(content, id, path = 'document') {
  const inspected = inspectSections(content);
  if (inspected.issues.length) {
    throw new Error(`${path}: malformed or duplicate docguard:section markers; no write was applied.`);
  }
  const matches = inspected.sections.filter(section => section.id === id);
  if (matches.length !== 1) throw new Error(`${path}: section ${id} must exist exactly once before a bounded write.`);
  if (matches[0].source !== 'code') throw new Error(`${path}: section ${id} is source=${matches[0].source}; only source=code is writable.`);
  return matches[0];
}

/** Get a single section by id, or null. */
export function getSection(content, id) {
  return parseSections(content).find(s => s.id === id) || null;
}

/** List section ids present in a document. */
export function listSections(content) {
  return parseSections(content).map(s => s.id);
}

/** Render a full marked section block (open marker + body + close marker). */
export function renderSection(id, body, { source = 'code' } = {}) {
  const inner = String(body).replace(/^\n+/, '').replace(/\n+$/, '');
  return `<!-- docguard:section id=${id} source=${source} -->\n${inner}\n<!-- /docguard:section -->`;
}

/**
 * Replace ONLY the body of an existing section, preserving its markers and all
 * surrounding content. Idempotent: if the new body matches, returns unchanged.
 * @returns {{ content: string, replaced: boolean }}
 */
export function replaceSection(content, id, newBody) {
  const lines = String(content).split('\n');
  const sections = parseSections(content);
  const sec = sections.find(s => s.id === id);
  if (!sec) return { content, replaced: false };

  const inner = String(newBody).replace(/^\n+/, '').replace(/\n+$/, '');
  if (sec.body === inner) return { content, replaced: false }; // idempotent no-op

  const before = lines.slice(0, sec.openLine + 1);
  const after = lines.slice(sec.closeLine);
  const next = [...before, ...inner.split('\n'), ...after].join('\n');
  return { content: next, replaced: true };
}

/**
 * Replace a section's body if it exists; otherwise INSERT a new section.
 * Insert position: `after:<id>` (after another section), 'top' (after the H1 /
 * first heading), or 'end' (default, appended).
 *
 * With `heading`, a new section is titled: when the document already has a
 * heading that satisfies it (same text, a known synonym — the init template's
 * `## Tech Stack` — a `docguard:heading` marker, or an alias of `docs.language`),
 * the section goes directly under that heading (after its marker, so the marker
 * stays the next line); otherwise `## <heading>` is written above the marker. The
 * heading sits outside the marker, so regeneration never rewrites it
 * (docguard.generated-docs-consistency#FR-003).
 *
 * `labels` is the project's `labelContext(config)` (spec 104 D7, FR-008). An
 * English project (null, or `en`) gets the English heading, followed by its id
 * marker when the heading is one the registry knows (FR-023).
 * For a language with a built-in set the new heading is the first alias plus
 * `<!-- docguard:heading <id> -->`; an English heading is never written into a
 * translated document. When the language has no set, or the heading has no alias
 * (a generator heading outside the registry), the block is written without a
 * heading and `languageNotSupported` names the English heading it did not write.
 * @returns {{ content: string, action: 'replaced'|'inserted'|'unchanged', languageNotSupported?: string }}
 * @implements docguard.document-languages#FR-008
 */
export function upsertSection(content, id, newBody, { source = 'code', position = 'end', heading = null, labels = null } = {}) {
  if (getSection(content, id)) {
    const r = replaceSection(content, id, newBody);
    return { content: r.content, action: r.replaced ? 'replaced' : 'unchanged' };
  }

  let block = renderSection(id, newBody, { source });
  const lines = String(content).split('\n');
  let languageNotSupported;

  if (heading) {
    const host = findSectionHeading(content, heading, labels);
    if (host >= 0) {
      // A marker directly under the host stays the next line: the block goes after it.
      let at = host;
      let next = host + 1;
      while (next < lines.length && lines[next].trim() === '') next++;
      if (next < lines.length && /^[ \t]*<!--\s*docguard:heading\s+[A-Za-z0-9][\w-]*\s*-->[ \t]*$/.test(lines[next])) at = next;
      const before = lines.slice(0, at + 1);
      const after = lines.slice(at + 1);
      while (after.length && after[0].trim() === '') after.shift();
      return { content: [...before, '', block, '', ...after].join('\n'), action: 'inserted' };
    }
    if (!labels || labels.language === 'en') {
      // The marker makes the new heading language-ready (spec 104 FR-023); a
      // heading outside the registry has no id and so no marker.
      const headingId = idForEnglishLabel(heading);
      block = `## ${heading}\n${headingId ? `<!-- docguard:heading ${headingId} -->\n` : ''}\n${block}`;
    } else {
      const headingId = idForEnglishLabel(heading);
      const alias = headingId ? firstAlias(headingId, labels) : null;
      if (alias) block = `## ${alias}\n<!-- docguard:heading ${headingId} -->\n\n${block}`;
      else languageNotSupported = heading;
    }
  }

  // Insert after a named section.
  const afterMatch = /^after:(.+)$/.exec(position);
  if (afterMatch) {
    const target = parseSections(content).find(s => s.id === afterMatch[1].trim());
    if (target) {
      const before = lines.slice(0, target.closeLine + 1);
      const after = lines.slice(target.closeLine + 1);
      return { content: [...before, '', block, ...after].join('\n'), action: 'inserted', ...(languageNotSupported ? { languageNotSupported } : {}) };
    }
  }

  // Insert just after the first heading (keeps the doc title on top).
  if (position === 'top') {
    const hIdx = lines.findIndex(l => /^#{1,6}\s/.test(l));
    if (hIdx >= 0) {
      const before = lines.slice(0, hIdx + 1);
      const after = lines.slice(hIdx + 1);
      return { content: [...before, '', block, ...after].join('\n'), action: 'inserted', ...(languageNotSupported ? { languageNotSupported } : {}) };
    }
  }

  // Default: append at end (single trailing newline).
  const base = String(content).replace(/\n+$/, '');
  return { content: `${base}\n\n${block}\n`, action: 'inserted', ...(languageNotSupported ? { languageNotSupported } : {}) };
}
