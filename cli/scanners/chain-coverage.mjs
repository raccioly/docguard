/**
 * Spec Kit chain coverage (specs/085-upstream-coverage): is spec → plan →
 * tasks connected? Pure over file texts.
 *
 *   uncovered        FR/SC IDs the spec defines that neither plan nor tasks cite (GAP)
 *   dangling         unqualified IDs plan or tasks cite that the spec does not define (ORPHAN)
 *   floating         plan/tasks that name neither their upstream file nor any ID
 *   storiesUncovered user stories with no `[USn]` task, when tasks use labels
 *   checked          false when tasks cite no ID of the spec at all (a
 *                    convention choice, not a set of gaps)
 *
 * @implements docguard.upstream-coverage#FR-001
 * @implements docguard.upstream-coverage#FR-002
 * @implements docguard.upstream-coverage#FR-003
 * @implements docguard.upstream-coverage#FR-004
 * @implements docguard.upstream-coverage#FR-005
 */

const ID = '(?:FR|SC)-\\d{3}[a-z]?(?:\\.\\d+)*';
const RANGE_RE = new RegExp(`(?<![\\w.#/-])(${ID})\\s*(?:to|–|—|\\.\\.|-)\\s*(${ID})(?![\\w-])`, 'g');
const CITE_RE = new RegExp(`(?<![\\w.#/-])(${ID})(?![\\w-])`, 'g');
// A requirement is defined by a list item, table row or heading that starts with its ID,
// whatever follows: `- **FR-001**: …`, `- **FR-007** The …`, `- **FR-024 Title.**`, `| FR-001 |`, `### FR-770 — …`.
const DEFINE_RE = new RegExp(`^\\s*(?:[-*]\\s+|\\|\\s*|#{2,6}\\s+)(?:\\*\\*)?(${ID})(?![\\w-])`);

/** Inline code spans blanked: they are literal text (an example ID, a quoted `<!--`). */
const withoutInlineCode = line => line.replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, m => ' '.repeat(m.length));

/** Lines with fenced code, inline code and HTML comments blanked, so line numbers stay true. */
function proseLines(text, { keepInlineCode = false } = {}) {
  const lines = String(text || '').split(/\r?\n/);
  let fence = null;
  let comment = false;
  return lines.map(line => {
    const trimmed = line.trim();
    const f = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return ''; }
    if (f) { fence = f[1]; return ''; }
    let out = '';
    let rest = keepInlineCode ? line : withoutInlineCode(line);
    while (rest.length) {
      if (comment) {
        const end = rest.indexOf('-->');
        if (end < 0) { rest = ''; break; }
        comment = false; rest = rest.slice(end + 3);
      } else {
        const start = rest.indexOf('<!--');
        if (start < 0) { out += rest; break; }
        out += rest.slice(0, start); comment = true; rest = rest.slice(start + 4);
      }
    }
    return out;
  });
}

const parts = id => { const m = id.match(/^(FR|SC)-(\d{3})([a-z]?)$/); return m ? { prefix: m[1], n: Number(m[2]), suffix: m[3] } : null; };
const fmt = (prefix, n) => `${prefix}-${String(n).padStart(3, '0')}`;

export function definedIds(specText) {
  const out = new Map();
  proseLines(specText).forEach((line, i) => {
    const m = line.match(DEFINE_RE);
    if (m && !out.has(m[1])) out.set(m[1], i + 1);
  });
  return out;
}

// An ID right after another spec's name is that spec's requirement, not this
// one's: "spec 013 FR-020", "`docguard.verdict-contract` FR-002", "060's FR-003".
// A requirements document's own IDs ("REQUIREMENTS FR-024") belong to it too. Only
// documents that define requirements qualify: "TEST-SPEC, CHANGELOG (FR-007)" in a
// task names the docs to update and still cites this spec's FR-007.
const OTHER_SPEC_BEFORE = /(?:\b[Ss]pecs?\s*\d{1,4}(?:'s)?|`[a-z0-9-]+\.[a-z0-9.-]+`(?:'s)?|(?<![\w-])\d{3}'s|\b(?:REQUIREMENTS|PRD|SRS|BRD)(?:\.md)?)\s*(?:\(|,|and|or|\s)*$/;
const qualified = (line, index) => OTHER_SPEC_BEFORE.test(line.slice(Math.max(0, index - 48), index));

/** Every unqualified ID cited, with its first line; same-prefix ranges expand. */
export function citedIds(text) {
  const out = new Map();
  const add = (id, line) => { if (!out.has(id)) out.set(id, line); };
  proseLines(text).forEach((line, i) => {
    for (const m of line.matchAll(RANGE_RE)) {
      if (qualified(line, m.index)) continue;
      const a = parts(m[1]), b = parts(m[2]);
      if (a && b && a.prefix === b.prefix && !a.suffix && !b.suffix && b.n > a.n && b.n - a.n <= 50) {
        for (let n = a.n; n <= b.n; n++) add(fmt(a.prefix, n), i + 1);
      }
    }
    for (const m of line.matchAll(CITE_RE)) if (!qualified(line, m.index)) add(m[1], i + 1);
  });
  return out;
}

export function storyNumbers(specText) {
  const out = [];
  for (const line of proseLines(specText)) {
    const m = line.match(/^#{2,4}\s+User Story\s+(\d+)\b/i);
    if (m) out.push(Number(m[1]));
  }
  return out;
}

// A file name in inline code (`spec.md`) still names the file; only IDs in code spans are examples.
const namesFile = (text, name) => new RegExp(`(?<![\\w-])${name.replace('.', '\\.')}(?![\\w-])`).test(proseLines(text, { keepInlineCode: true }).join('\n'));

/**
 * @param {{ spec: string, plan?: string|null, tasks: string }} texts
 */
export function chainCoverage({ spec, plan = null, tasks }) {
  const defined = definedIds(spec);
  const fromTasks = citedIds(tasks);
  const fromPlan = plan ? citedIds(plan) : new Map();
  const related = id => defined.has(id) || [...defined.keys()].some(d => d.startsWith(`${id}.`) || id.startsWith(`${d}.`));
  const tasksCiteSpec = [...fromTasks.keys()].some(related);
  const planCitesSpec = [...fromPlan.keys()].some(related);

  // A parent and its dotted sub-requirements cover each other (FR-007 ↔ FR-007.1).
  const cited = [...fromTasks.keys(), ...fromPlan.keys()];
  const covered = id => cited.some(c => c === id || c.startsWith(`${id}.`) || id.startsWith(`${c}.`));
  // Each prefix is checked only when the tasks use it: a team that never cites
  // SC IDs in tasks has not left every success criterion uncovered.
  const prefixesUsed = new Set([...fromTasks.keys()].filter(id => defined.has(id) || [...defined.keys()].some(d => d.startsWith(`${id}.`) || id.startsWith(`${d}.`))).map(id => id.slice(0, 2)));
  const uncovered = tasksCiteSpec
    ? [...defined].filter(([id]) => prefixesUsed.has(id.slice(0, 2)) && !covered(id)).map(([id, line]) => ({ id, line }))
    : [];
  const dangling = [
    ...[...fromTasks].filter(([id]) => !related(id)).map(([id, line]) => ({ id, line, file: 'tasks.md' })),
    ...[...fromPlan].filter(([id]) => !related(id)).map(([id, line]) => ({ id, line, file: 'plan.md' })),
  ];
  const floating = [];
  if (plan !== null && !planCitesSpec && !namesFile(plan, 'spec.md')) floating.push('plan.md');
  if (!tasksCiteSpec && !namesFile(tasks, 'plan.md') && !namesFile(tasks, 'spec.md')) floating.push('tasks.md');

  const labels = new Set([...String(tasks || '').matchAll(/\[US(\d+)\]/g)].map(m => Number(m[1])));
  const storiesUncovered = labels.size ? storyNumbers(spec).filter(n => !labels.has(n)) : [];

  return { uncovered, dangling, floating, storiesUncovered, checked: tasksCiteSpec };
}
