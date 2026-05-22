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
 * A section is a line matching the open marker, then content lines, then a
 * close-marker line. An open with no matching close is ignored (not corrupted).
 * @returns {Array<{ id, source, attrs, openLine, closeLine, body }>}
 */
export function parseSections(content) {
  const lines = String(content).split('\n');
  const sections = [];
  let open = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (open === null) {
      const om = line.match(OPEN_RE);
      if (om) {
        const attrs = parseAttrs(om[1] || '');
        open = { attrs, openLine: i };
      }
    } else if (CLOSE_RE.test(line)) {
      sections.push({
        id: open.attrs.id || '',
        source: open.attrs.source || 'code',
        attrs: open.attrs,
        openLine: open.openLine,
        closeLine: i,
        body: lines.slice(open.openLine + 1, i).join('\n'),
      });
      open = null;
    }
    // Note: a second open before a close just extends the search for a close;
    // we keep the FIRST open's start, so malformed nesting can't corrupt content.
  }
  return sections;
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
 * @returns {{ content: string, action: 'replaced'|'inserted'|'unchanged' }}
 */
export function upsertSection(content, id, newBody, { source = 'code', position = 'end' } = {}) {
  if (getSection(content, id)) {
    const r = replaceSection(content, id, newBody);
    return { content: r.content, action: r.replaced ? 'replaced' : 'unchanged' };
  }

  const block = renderSection(id, newBody, { source });
  const lines = String(content).split('\n');

  // Insert after a named section.
  const afterMatch = /^after:(.+)$/.exec(position);
  if (afterMatch) {
    const target = parseSections(content).find(s => s.id === afterMatch[1].trim());
    if (target) {
      const before = lines.slice(0, target.closeLine + 1);
      const after = lines.slice(target.closeLine + 1);
      return { content: [...before, '', block, ...after].join('\n'), action: 'inserted' };
    }
  }

  // Insert just after the first heading (keeps the doc title on top).
  if (position === 'top') {
    const hIdx = lines.findIndex(l => /^#{1,6}\s/.test(l));
    if (hIdx >= 0) {
      const before = lines.slice(0, hIdx + 1);
      const after = lines.slice(hIdx + 1);
      return { content: [...before, '', block, ...after].join('\n'), action: 'inserted' };
    }
  }

  // Default: append at end (single trailing newline).
  const base = String(content).replace(/\n+$/, '');
  return { content: `${base}\n\n${block}\n`, action: 'inserted' };
}
