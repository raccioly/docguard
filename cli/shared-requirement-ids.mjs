/**
 * One definition of "is this a requirement?" for the validators that decide
 * whether a project has requirements (specs/097-strict-by-default FR-006):
 * Requirement-Anchors and Traceability. The scanner that reads IDs
 * (`cli/shared-requirements.mjs`) is deliberately wider, because it is also a
 * navigation aid; the question here is narrower: "does this project state
 * requirements that something can be traced or anchored to?".
 *
 * Counted: FR, NFR, SC and REQ IDs (the prefixes of a requirement list such as
 * `- **FR-001**: The system MUST ...`) declared in a spec or requirement
 * document. Not counted:
 *   - an ID in a decision record, an open-item or question list, a task list,
 *     or a template document, whatever its prefix;
 *   - task IDs (T), design elements (ARCH, MOD, SYS), and story, use-case and
 *     acceptance IDs (US, STORY, UC, AC), which describe or test a requirement
 *     rather than state one;
 *   - a template row: a requirement whose only content is a slot (`System MUST [capability]`,
 *     `<capability>`, `{{behaviour}}`), `TBD`, or nothing at all. A real sentence that mentions a
 *     variable (`write {file} to the output directory`) is a requirement.
 * A project that configures `traceability.requirementPattern` has defined a
 * requirement itself: that pattern is the definition, and only placeholder rows
 * are still ignored.
 *
 * @implements docguard.strict-by-default#FR-006
 */

export const REQUIREMENT_PREFIXES = Object.freeze(new Set(['FR', 'NFR', 'SC', 'REQ']));

/** What a non-requirement prefix identifies, for the evidence sentence. */
export const KIND_OF_PREFIX = Object.freeze({
  T: 'task', TASK: 'task',
  ARCH: 'design-element', MOD: 'design-element', SYS: 'design-element',
  US: 'story', STORY: 'story', UC: 'use-case', AC: 'acceptance-check',
  D: 'decision', DEC: 'decision', ADR: 'decision',
  OI: 'open-item', Q: 'open-item', OQ: 'open-item',
});

const DECISION_DOC = /(?:^|\/)(?:adrs?|decisions?)\/|(?:^|\/)[^/]*(?:adr|decision)[^/]*\.md$/i;
const OPEN_ITEM_DOC = /(?:^|\/)[^/]*(?:open[-_ ]?(?:items?|questions?|issues?)|questions|clarifications?)[^/]*\.md$/i;
const TASK_DOC = /(?:^|\/)[^/]*(?:tasks?|todo|plan)[^/]*\.md$/i;
const TEMPLATE_DOC = /(?:^|\/)templates?\/|(?:^|\/)[^/]*templates?[^/]*\.md$|(?:^|\/)_template\//i;

// Placeholder text: a bracket, angle or curly slot holding a word, TBD/TODO, an ellipsis, or nothing.
// A link `[text](url)` and a task checkbox `[ ]` are not placeholders; an HTML tag is not an angle slot.
const ANGLE_SLOT = /<(?!\/?(?:a|b|i|u|p|br|hr|em|kbd|sub|sup|code|pre|img|span|div|strong|details|summary)\b)[A-Za-z][^<>\n]*>/i;
const EMPTY_TEXT = /^(?:tbd|todo|tba|n\/a|\.{2,}|…)?[\s.:;,-]*$/i;

/** The text of a requirement line after its ID and markup. */
function bodyText(def) {
  return String(def.text || '').replace(def.id, '').replace(/[*_`|]/g, ' ').replace(/^[\s\-+>#.:)\d]*/, '').trim();
}

const MODAL = /\b(?:must|shall|should|may|will|can)\b/i;
// What may remain of a requirement sentence once its slots are removed for it to be a bare scaffold: an optional
// article, up to two more subject words, a modal verb, and at most three filler words ("System MUST", "Users MUST be
// able to", "The system SHOULD support").
const SCAFFOLD = /^(?:(?:the|a|an|each|every|all)\s+)?(?:[a-z][\w-]*\s+){0,2}(?:must|shall|should|may|will|can)(?:\s+not)?(?:\s+(?:be|able|to|support|provide|allow|enable|have|include|implement)){0,3}$/i;

/** Remove every slot token (balanced square and curly slots, angle slots) from `text`; returns the rest and the count removed. */
function removeSlots(text) {
  let out = '';
  let removed = 0;
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === '[' || ch === '{') {
      const close = ch === '[' ? ']' : '}';
      let depth = 0;
      let j = i;
      for (; j < text.length && text[j] !== '\n'; j++) {
        if (text[j] === ch) depth++;
        else if (text[j] === close && --depth === 0) break;
      }
      const inner = depth === 0 && text[j] === close ? text.slice(i + 1, j) : null;
      const isLink = ch === '[' && text[j + 1] === '(';
      if (inner !== null && /[A-Za-z]/.test(inner) && !isLink) { out += ' '; removed++; i = j + 1; continue; }
    }
    if (ch === '<') {
      const m = ANGLE_SLOT.exec(text.slice(i));
      if (m && m.index === 0) { out += ' '; removed++; i += m[0].length; continue; }
    }
    out += ch;
    i++;
  }
  return { rest: out, removed };
}

/** The cell that carries the requirement: the text after the ID, or in a table row the first cell with a modal verb, else the longest. */
function requirementCell(raw) {
  if ((raw.match(/\|/g) || []).length < 2) return raw;
  const cells = raw.split('|').map(c => c.trim()).filter(Boolean);
  return cells.find(c => MODAL.test(c)) || cells.sort((x, y) => y.length - x.length)[0] || '';
}

/**
 * Is this declaration a template row: a slot (`[capability]`, `<capability>`, `{{behaviour}}`) that carries the
 * requirement? The rule: remove every slot token from the requirement text; the row is a template row only when what
 * is left is the bare scaffold of a requirement sentence ("System MUST", "Users MUST be able to") or nothing. A sentence
 * that still states something without its slots ("The exporter MUST write {file} to the output directory") is a real
 * requirement that happens to mention a variable. A filled default row with no slot at all is filled text and counts.
 */
export function hasPlaceholderSlot(def) {
  // Brackets, angles and braces inside an inline code span are code, not a template slot:
  // `[Unreleased]`, `--stage [slug]`, `{ mode, asOf }`, `pending: [...]`.
  // A span that opens and does not close on this line (the sentence wraps) is code to the end of the line.
  const raw = String(def.text || '').replace(def.id, ' ').replace(/`[^`\n]*`/g, '').replace(/`.*$/, '').replace(/[*_]/g, '');
  const { rest, removed } = removeSlots(requirementCell(raw));
  if (!removed) return false;
  const left = rest.replace(/^[\s\-+>#.:)\d]*(?:\[[ xX]\]\s*)?/, '').replace(/[\s.:;,!?"'()-]+/g, ' ').trim();
  return left === '' || SCAFFOLD.test(left);
}

/** Is this declaration a template row rather than a requirement? A slot-carried row, or no text at all. */
export function isPlaceholderRequirement(def) {
  if (hasPlaceholderSlot(def)) return true;
  if (!EMPTY_TEXT.test(bodyText(def).replace(/^(?:\[[ xX]\]|[-+*]|\d+[.)])\s*/, ''))) return false;
  // An ID line with no text may state its requirement on the lines under it (`- **SC-001**:` then an indented
  // paragraph): the scanner's block holds them, and a block with text of its own is a real requirement.
  const under = String(def.block || '').split('\n').slice(1).join(' ').replace(/[*_`|#>\-+\s]+/g, ' ').trim();
  return !/[A-Za-z]{2,}/.test(under);
}

/**
 * Why a declared ID is not a requirement, or null when it is one. `custom` is true
 * when the project configured its own requirement pattern, which is then the definition.
 */
export function nonRequirementKind(def, { custom = false } = {}) {
  const file = String(def.file || '');
  const prefix = String(def.id || '').split('-')[0];
  if (custom) return TEMPLATE_DOC.test(file) ? 'template' : null;
  if (TEMPLATE_DOC.test(file)) return 'template';
  if (DECISION_DOC.test(file)) return 'decision';
  if (OPEN_ITEM_DOC.test(file)) return 'open-item';
  if (TASK_DOC.test(file)) return KIND_OF_PREFIX[prefix] || 'task-list';
  if (!REQUIREMENT_PREFIXES.has(prefix)) return KIND_OF_PREFIX[prefix] || 'other';
  return null;
}

/**
 * Split declared IDs into requirements, placeholder rows and the kinds that are not requirements.
 * @param {Array<{id: string, file?: string, text?: string}>} defs
 * @returns {{ requirements: object[], placeholders: number, skipped: Map<string, number> }}
 */
export function classifyRequirementIds(defs, { custom = false } = {}) {
  const requirements = [];
  const skipped = new Map();
  let placeholders = 0;
  for (const def of defs) {
    if (isPlaceholderRequirement(def)) { placeholders++; continue; }
    const kind = nonRequirementKind(def, { custom });
    if (kind) skipped.set(kind, (skipped.get(kind) || 0) + 1);
    else requirements.push(def);
  }
  return { requirements, placeholders, skipped };
}

/** `2 task, 1 decision` for an evidence sentence. */
export function describeSkipped(skipped) {
  return [...skipped].map(([kind, n]) => `${n} ${kind}`).join(', ');
}
