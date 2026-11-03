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

const ID = '(?:FR|SC)-\\d{3}[a-z]?';
const RANGE_RE = new RegExp(`(?<![\\w.#/-])(${ID})\\s*(?:to|–|—|\\.\\.|-)\\s*(${ID})(?![\\w-])`, 'g');
const CITE_RE = new RegExp(`(?<![\\w.#/-])(${ID})(?![\\w-])`, 'g');
const DEFINE_RE = new RegExp(`^\\s*(?:[-*]\\s+|\\|\\s*)(?:\\*\\*)?(${ID})(?:\\*\\*)?(?:\\s*\\*?\\([^)]*\\)\\*?)?\\s*[:|]`);

/** Inline code spans blanked: they are literal text (an example ID, a quoted `<!--`). */
const withoutInlineCode = line => line.replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, m => ' '.repeat(m.length));

/** Lines with fenced code, inline code and HTML comments blanked, so line numbers stay true. */
function proseLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  let fence = null;
  let comment = false;
  return lines.map(line => {
    const trimmed = line.trim();
    const f = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return ''; }
    if (f) { fence = f[1]; return ''; }
    let out = '';
    let rest = withoutInlineCode(line);
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
// A canonical document's own IDs ("REQUIREMENTS FR-024") belong to it too.
const OTHER_SPEC_BEFORE = /(?:\b[Ss]pecs?\s+\d{1,4}(?:'s)?|`[a-z0-9-]+\.[a-z0-9.-]+`(?:'s)?|(?<![\w-])\d{3}'s|\b[A-Z][A-Z]{2,}(?:-[A-Z]+)*(?:\.md)?)\s*(?:\(|,|and|or|\s)*$/;
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

const namesFile = (text, name) => new RegExp(`(?<![\\w-])${name.replace('.', '\\.')}(?![\\w-])`).test(proseLines(text).join('\n'));

/**
 * @param {{ spec: string, plan?: string|null, tasks: string }} texts
 */
export function chainCoverage({ spec, plan = null, tasks }) {
  const defined = definedIds(spec);
  const fromTasks = citedIds(tasks);
  const fromPlan = plan ? citedIds(plan) : new Map();
  const tasksCiteSpec = [...fromTasks.keys()].some(id => defined.has(id));
  const planCitesSpec = [...fromPlan.keys()].some(id => defined.has(id));

  const uncovered = tasksCiteSpec
    ? [...defined].filter(([id]) => !fromTasks.has(id) && !fromPlan.has(id)).map(([id, line]) => ({ id, line }))
    : [];
  const dangling = [
    ...[...fromTasks].filter(([id]) => !defined.has(id)).map(([id, line]) => ({ id, line, file: 'tasks.md' })),
    ...[...fromPlan].filter(([id]) => !defined.has(id)).map(([id, line]) => ({ id, line, file: 'plan.md' })),
  ];
  const floating = [];
  if (plan !== null && !planCitesSpec && !namesFile(plan, 'spec.md')) floating.push('plan.md');
  if (!tasksCiteSpec && !namesFile(tasks, 'plan.md') && !namesFile(tasks, 'spec.md')) floating.push('tasks.md');

  const labels = new Set([...String(tasks || '').matchAll(/\[US(\d+)\]/g)].map(m => Number(m[1])));
  const storiesUncovered = labels.size ? storyNumbers(spec).filter(n => !labels.has(n)) : [];

  return { uncovered, dangling, floating, storiesUncovered, checked: tasksCiteSpec };
}
