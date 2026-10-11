/**
 * Policy for Google Jules pull requests: which routines exist and what each
 * may change, what is noise, what is a duplicate, when the queue is full, and
 * what may merge without a maintainer.
 *
 * Spec: specs/067-jules-policy (docguard.jules-policy). Ported from
 * raccioly/testguard#207 and narrowed: here only new test modules merge alone.
 *
 * Pure: no network, no filesystem, no clock. Three consumers pass it data:
 *   .jules/preflight.mjs                 before Jules works (cooperative)
 *   .github/scripts/jules-triage.mjs     when a Jules PR opens (authoritative)
 *   .github/workflows/auto-merge.yml     after CI is green on a Jules PR
 *
 * The default is HOLD. The merge rule is an allowlist; anything it does not
 * recognise goes to a maintainer. A wrongly held PR costs a click; a wrongly
 * merged one ships to npm in the weekly release, and a Markdown file here can
 * be an instruction every adopter's agent follows.
 *
 * No rule looks at what a change is about. A finding is closed only for its
 * shape (empty, repeated, declined, over the queue cap, off its routine's
 * contract), never for its subject, so a real security or speed fix reaches a
 * maintainer.
 *
 * @implements docguard.jules-policy#FR-001
 * @implements docguard.jules-policy#FR-003
 * @implements docguard.jules-policy#FR-004
 * @implements docguard.jules-policy#FR-005
 * @implements docguard.jules-policy#FR-006
 * @implements docguard.jules-policy#FR-008
 * @implements docguard.jules-policy#FR-009
 * @implements docguard.jules-policy#FR-010
 */

export const JULES_LOGIN = 'google-labs-jules[bot]';

/** Open Jules PRs that may wait for review before new ones are closed unread. */
export const QUEUE_CAP = 5;

/** A Jules PR closed unmerged this recently blocks the same work being re-proposed. */
export const DECLINE_WINDOW_DAYS = 60;

/** More files than this is a refactor in disguise, not a set of new tests. */
export const MAX_FILES = 10;

export const LABELS = Object.freeze({
  noise: 'jules-noise',
  duplicate: 'jules-duplicate',
  declined: 'jules-previously-declined',
  queueFull: 'jules-queue-full',
  offContract: 'jules-off-contract',
  review: 'jules-review',
  eligible: 'jules-automerge-eligible',
});

/** The scheduled routines and the weekday each runs. `.jules/README.md` mirrors this. */
export const SCHEDULE = Object.freeze([
  ['bug-hunt', 'Monday'],
  ['test-gaps', 'Wednesday'],
  ['docs-drift', 'Friday'],
]);
export const ROUTINES = Object.freeze(SCHEDULE.map(([name]) => name));

export const isJules = (login) => String(login ?? '').toLowerCase().replace(/^app\//, '') === JULES_LOGIN
  || String(login ?? '').toLowerCase() === 'google-labs-jules';

/** `[jules:test-gaps] cli/shared-ignore.mjs — three exports` → { routine, target } */
export function parseTag(title) {
  const m = /^\[jules:([a-z0-9-]+)\]\s+(\S+)/.exec(String(title ?? '').trim());
  return m && ROUTINES.includes(m[1]) ? { routine: m[1], target: m[2] } : null;
}

export const tagTitle = (routine, target) => `[jules:${routine}] ${target}`;

const names = (files) => files.map((f) => f.filename ?? f);

/** Bookkeeping files that do not make two changes different. */
const BOOKKEEPING = new Set(['CHANGELOG.md']);

/** The file set that identifies a change. Bots word one change many ways; the files do not move. */
export const dupKey = (filenames) => [...new Set(filenames)].filter((f) => !BOOKKEEPING.has(f)).sort().join('\n');

/** A top-level test module: what `npm test` runs, outside fixtures and helpers. */
export const isTestModulePath = (f) => /^tests\/[^/]+\.test\.mjs$/.test(f);

/** Hand-written user docs. The finding-code reference is generated (`npm run docs:reference`). */
export const isUserDocPath = (f) => /^README(\.[A-Za-z-]+)?\.md$/.test(f)
  || (f.startsWith('docs/') && f.endsWith('.md') && f !== 'docs/reference/findings.md');

const NO_OP = /\b(?:no (?:changes?|action|issues?|updates?) (?:needed|required|found)|(?:already|is|are) up[- ]to[- ]date|nothing to (?:do|change|fix|update)|verif(?:y|ied|ying) (?:test )?stability)\b/i;
const COUNT_SYNC = /\b(?:sync|update|bump|refresh|fix)\b.{0,40}\b(?:test )?(?:counts?|metrics?|numbers?|totals?)\b/i;

/** Shapes that are reliably regenerated noise. Returns a reason, or null. */
export function noiseReason({ title, files }) {
  const changed = names(files);
  if (changed.length === 0) return 'it changes no files: a status report is a task summary, not a pull request';
  if (NO_OP.test(title ?? '')) return 'its title reports that nothing needed changing';
  if (changed.every((n) => n.startsWith('.jules/'))) return 'it changes only `.jules/`, the routines that steer the agent; those change through a maintainer';
  if (COUNT_SYNC.test(title ?? '') && changed.every(isUserDocPath)) return 'it syncs a count or metric in prose; a count changes with every merge, and the docs checks in CI own it';
  return null;
}

/**
 * What each routine may change. Returns why a tagged PR is outside its
 * routine's contract, or null (also for an untagged PR, which has none).
 */
export function contractReason({ title, files }) {
  const tag = parseTag(title);
  if (!tag) return null;
  const isNewTest = (f) => f.status === 'added' && !f.previous_filename && isTestModulePath(f.filename);
  if (tag.routine === 'bug-hunt' && !files.some(isNewTest)) {
    return 'a bug-hunt fix must arrive with a new test file that fails without it';
  }
  if (tag.routine === 'test-gaps') {
    const other = files.find((f) => !isNewTest(f));
    if (other) return `test-gaps may only add new test files, and \`${other.filename}\` is ${other.status}`;
  }
  if (tag.routine === 'docs-drift') {
    const other = files.find((f) => !isUserDocPath(f.filename) || !['added', 'modified'].includes(f.status) || f.previous_filename);
    if (other) return `docs-drift may only change hand-written user docs (README.md, README.<lang>.md, docs/**/*.md), not \`${other.filename}\``;
  }
  return null;
}

const daysBetween = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/** The same work: the same routine target, or the same changed-file set. */
function sameWork(a, b) {
  const ta = parseTag(a.title), tb = parseTag(b.title);
  if (ta && tb && ta.routine === tb.routine && ta.target === tb.target) return true;
  const ka = dupKey(names(a.files ?? [])), kb = dupKey(names(b.files ?? []));
  return ka !== '' && ka === kb;
}

const labelled = (pr, name) => (pr.labels ?? []).some((l) => (l.name ?? l) === name);

/** Closed for its queue position or its shape, not judged: the work may come back. */
const notJudged = (pr) => labelled(pr, LABELS.queueFull) || labelled(pr, LABELS.offContract);

/** Closed unmerged within the window, after a maintainer or triage judged the work. */
const recentlyDeclined = (pr, now) => !pr.mergedAt && pr.closedAt && daysBetween(pr.closedAt, now) <= DECLINE_WINDOW_DAYS && !notJudged(pr);

/** Open PRs that count toward the cap: those not already closed for overflow. */
const waitingCount = (open) => open.filter((o) => !labelled(o, LABELS.queueFull)).length;

/**
 * Decide what happens to a Jules PR the moment it opens.
 *
 * `pr`     { number, title, files: [{ filename, status, previous_filename? }] }
 * `open`   other OPEN Jules PRs, each { number, title, files: [names], labels }
 * `closed` Jules PRs closed in the window, each { number, title, files, labels, mergedAt, closedAt }
 * `now`    ISO timestamp (passed in: the policy reads no clock)
 *
 * → { action: 'close' | 'keep', label, reason, ref? }
 */
export function triage({ pr, open, closed, now }) {
  const noise = noiseReason({ title: pr.title, files: pr.files });
  if (noise) return { action: 'close', label: LABELS.noise, reason: noise };

  const contract = contractReason({ title: pr.title, files: pr.files });
  if (contract) return { action: 'close', label: LABELS.offContract, reason: contract };

  const others = open.filter((o) => o.number !== pr.number);
  const older = others.filter((o) => o.number < pr.number && sameWork(o, pr)).sort((a, b) => a.number - b.number)[0];
  if (older) return { action: 'close', label: LABELS.duplicate, ref: older.number, reason: `it is the same work as #${older.number}, which is still open` };

  const declined = closed
    .filter((c) => recentlyDeclined(c, now) && sameWork(c, pr))
    .sort((a, b) => b.number - a.number)[0];
  if (declined) return { action: 'close', label: LABELS.declined, ref: declined.number, reason: `the same work was closed without merging in #${declined.number} within the last ${DECLINE_WINDOW_DAYS} days` };

  const waiting = waitingCount(others);
  if (waiting >= QUEUE_CAP) return { action: 'close', label: LABELS.queueFull, reason: `${waiting} Jules PRs are already waiting for review (cap ${QUEUE_CAP}); the work is not lost, the routine proposes it again once the queue drains` };

  const { verdict, reason } = mergeVerdict({ files: pr.files });
  return { action: 'keep', label: verdict === 'merge' ? LABELS.eligible : LABELS.review, reason };
}

/**
 * May a green Jules PR merge without a maintainer?
 *
 * `files` the immutable comparison of the PR base with the CI-verified head:
 *         [{ filename, status, previous_filename? }]
 *
 * Merges only new top-level test modules. Never: an edited, removed, renamed
 * or copied file; fixtures or helpers; any Markdown (instruction files, prompt
 * files that ship to npm, user docs, the changelog); code, CI or packaging.
 */
export function mergeVerdict({ files }) {
  if (!files.length) return { verdict: 'hold', reason: 'no files changed' };
  if (files.length > MAX_FILES) return { verdict: 'hold', reason: `${files.length} files changed (limit ${MAX_FILES}): a refactor in disguise` };
  for (const f of files) {
    const name = f.filename;
    if (f.previous_filename) return { verdict: 'hold', reason: `${name} was ${f.status} from ${f.previous_filename}: renaming or copying a file needs a maintainer` };
    if (f.status !== 'added') {
      if (isTestModulePath(name) && f.status === 'modified') return { verdict: 'hold', reason: `${name} edits an existing test: an assertion that changed is a change to what the suite defends` };
      return { verdict: 'hold', reason: `${name} was ${f.status}: only new files may merge without a maintainer` };
    }
    if (!isTestModulePath(name)) return { verdict: 'hold', reason: `${name} is outside what a bot may merge alone (new top-level test modules, tests/<name>.test.mjs)` };
  }
  return { verdict: 'merge', reason: `${files.length} new test file(s)` };
}

/** ISO-8601 week number, so a weekly routine walks its targets in a fixed order. */
export function isoWeek(iso) {
  const d = new Date(Date.parse(iso));
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const day = (new Date(t).getUTCDay() + 6) % 7;
  const thursday = t - day * 86_400_000 + 3 * 86_400_000;
  const yearStart = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  return 1 + Math.floor((thursday - yearStart) / (7 * 86_400_000));
}

/**
 * The work a routine has been given, or why it has none. Deterministic for a
 * week: the rotation starts at the week number and skips every target
 * declined in the window. A routine with a PR still waiting gets nothing.
 *
 * → { go: true, target } | { go: false, reason }
 */
export function pickTarget({ routine, candidates, open, closed, now }) {
  if (!ROUTINES.includes(routine)) return { go: false, reason: `unknown routine "${routine}"; known: ${ROUTINES.join(', ')}` };
  const waiting = waitingCount(open);
  if (waiting >= QUEUE_CAP) return { go: false, reason: `the review queue is full: ${waiting} Jules PRs are waiting (cap ${QUEUE_CAP})` };
  const own = open.find((o) => !labelled(o, LABELS.queueFull) && parseTag(o.title)?.routine === routine);
  if (own) return { go: false, reason: `${routine} already has #${own.number} waiting for review; one at a time` };
  if (!candidates.length) return { go: false, reason: 'the routine has no candidate targets' };
  const taken = new Set(closed
    .filter((c) => recentlyDeclined(c, now))
    .map((c) => parseTag(c.title))
    .filter((t) => t?.routine === routine)
    .map((t) => t.target));
  const start = isoWeek(now) % candidates.length;
  for (let i = 0; i < candidates.length; i++) {
    const target = candidates[(start + i) % candidates.length];
    if (!taken.has(target)) return { go: true, target };
  }
  return { go: false, reason: `every ${routine} target was declined in the last ${DECLINE_WINDOW_DAYS} days` };
}

const SPEC_REF = /@implements\s+(docguard\.[a-z0-9-]+)#/g;

/** The spec IDs a module says it implements, in first-seen order. */
export const governingSpecs = (source) => [...new Set([...String(source).matchAll(SPEC_REF)].map((m) => m[1]))];

/**
 * bug-hunt targets: validator and scanner modules (where a defect is a wrong
 * finding) that name a governing spec, so the fix can cite it as CI's
 * spec-first gate requires. `modules` is [{ path, source }].
 */
export function bugHuntTargets(modules) {
  return modules
    .filter((m) => /^cli\/(validators|scanners)\/[^/]+\.mjs$/.test(m.path) && governingSpecs(m.source).length)
    .map((m) => m.path)
    .sort();
}

const IDENT = '[A-Za-z_$][\\w$]*';

/** The functions and classes a module exports by name. */
export function exportedFunctions(source) {
  const out = new Set();
  const src = String(source);
  for (const m of src.matchAll(new RegExp(`^export\\s+(?:async\\s+)?function\\s*\\*?\\s*(${IDENT})`, 'gm'))) out.add(m[1]);
  for (const m of src.matchAll(new RegExp(`^export\\s+class\\s+(${IDENT})`, 'gm'))) out.add(m[1]);
  for (const m of src.matchAll(new RegExp(`^export\\s+(?:const|let)\\s+(${IDENT})\\s*=\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)\\s*=>|${IDENT}\\s*=>)`, 'gm'))) out.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}\s*;?\s*$/gm)) {
    for (const part of m[1].split(',')) {
      const exported = part.trim().split(/\s+as\s+/).pop().trim();
      if (exported && exported !== 'default') out.add(exported);
    }
  }
  return [...out];
}

/** Resolve `../cli/x.mjs` against `tests/a.test.mjs` to `cli/x.mjs`. */
function resolveFrom(fromPath, spec) {
  if (!spec.startsWith('.')) return null;
  const parts = fromPath.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

/** module path → the names a test file imports from it. */
export function importedNames(testPath, source) {
  const out = new Map();
  const add = (spec, name) => {
    const mod = resolveFrom(testPath, spec);
    if (!mod) return;
    if (!out.has(mod)) out.set(mod, new Set());
    out.get(mod).add(name);
  };
  const src = String(source);
  const named = (list, spec) => {
    for (const part of list.split(',')) {
      const name = part.trim().split(/\s+as\s+|\s*:\s*/)[0].trim();
      if (name) add(spec, name);
    }
  };
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) named(m[1], m[2]);
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*['"]([^'"]+)['"]\s*\)/g)) named(m[1], m[2]);
  for (const m of src.matchAll(new RegExp(`import\\s*\\*\\s*as\\s+(${IDENT})\\s+from\\s*['"]([^'"]+)['"]`, 'g'))) {
    for (const use of src.matchAll(new RegExp(`\\b${m[1].replace(/\$/g, '\\$')}\\.(${IDENT})`, 'g'))) add(m[2], use[1]);
  }
  return out;
}

/** `export { a as b } from './x.mjs'` and `export * from './x.mjs'`: [{ from, name, as }] ('*' for all). */
function reExports(path, source) {
  const out = [];
  for (const m of String(source).matchAll(/^export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/gm)) {
    const from = resolveFrom(path, m[2]);
    for (const part of m[1].split(',')) {
      const [name, as = name] = part.trim().split(/\s+as\s+/).map((s) => s.trim());
      if (from && name) out.push({ from, name, as });
    }
  }
  for (const m of String(source).matchAll(/^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm)) {
    const from = resolveFrom(path, m[1]);
    if (from) out.push({ from, name: '*', as: '*' });
  }
  return out;
}

/**
 * test-gaps targets: CLI modules (the entry point aside) with exported
 * functions that no test imports, directly or through a re-export, most
 * untested first. `modules` and `tests` are [{ path, source }].
 * → [{ file, names }]
 */
export function untestedExports({ modules, tests }) {
  const imported = new Map();
  const mark = (mod, name) => {
    if (!imported.has(mod)) imported.set(mod, new Set());
    if (imported.get(mod).has(name)) return false;
    imported.get(mod).add(name);
    return true;
  };
  for (const t of tests) {
    for (const [mod, set] of importedNames(t.path, t.source)) for (const n of set) mark(mod, n);
  }
  // A name imported from a module that re-exports it covers the original.
  const forwards = modules.flatMap((m) => reExports(m.path, m.source).map((r) => ({ ...r, via: m.path })));
  for (let changed = true; changed;) {
    changed = false;
    for (const r of forwards) {
      for (const n of [...(imported.get(r.via) ?? [])]) {
        if (r.as === '*' || r.as === n) changed = mark(r.from, r.as === '*' ? n : r.name) || changed;
      }
    }
  }
  return modules
    .filter((m) => m.path.startsWith('cli/') && m.path !== 'cli/docguard.mjs')
    .map((m) => ({ file: m.path, names: exportedFunctions(m.source).filter((n) => !imported.get(m.path)?.has(n)).sort() }))
    .filter((r) => r.names.length)
    .sort((a, b) => b.names.length - a.names.length || a.file.localeCompare(b.file));
}

/**
 * docs-drift targets: the subcommands `docguard --help` lists under its
 * command sections, before the `init --with` scaffolders and the aliases.
 */
export function helpSubcommands(helpText) {
  const text = String(helpText).replace(/\x1b\[[0-9;]*m/g, '');
  const end = text.search(/^init --with/m);
  const body = end === -1 ? text : text.slice(0, end);
  return [...new Set([...body.matchAll(/^ {2}([a-z][a-z-]*) {2,}\S/gm)].map((m) => m[1]))];
}
