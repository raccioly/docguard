/**
 * What counts as a requirement ID, in one place, for the validators that ask "does this project declare a
 * requirement?" (Requirement-Anchors, Traceability): a template row is not one, and neither is an ID that
 * a decision record, an open-item list, a task list or a design element carries
 * (specs/097-strict-by-default FR-006).
 *
 * @implements docguard.strict-by-default#FR-006
 */
import { collectRequirementIds } from './scanners/requirement-docs.mjs';
import { requirementPatterns } from './shared-requirements.mjs';

// A requirement line whose text is a bracketed placeholder ("System MUST [capability]") is a template row, not a requirement.
// (a task checkbox, `[ ]` or `[x]`, is not a placeholder: the bracket must hold a word)
export const PLACEHOLDER_TEXT = /\[[^\]\n]*[A-Za-z][^\]\n]*\](?!\()/;
export const isPlaceholder = def => PLACEHOLDER_TEXT.test(String(def.text || '').replace(def.id, '').replace(/[*_`]/g, ''));
// What counts as a requirement ID when the project has not configured its own pattern. The scanner reads more
// shapes (it is also a navigation aid), but "this project has requirements to anchor" is a narrower question.
// Counted: FR, NFR, SC and REQ, the prefixes of a requirement list (`- **FR-001**: The system MUST ...`).
// Not counted: T (a task ID), ARCH, MOD and SYS (design elements), US, STORY, UC and AC (stories, use cases and
// acceptance checks, which describe or test a requirement rather than state one).
const REQUIREMENT_PREFIXES = new Set(['FR', 'NFR', 'SC', 'REQ']);
const KIND_OF_PREFIX = { T: 'task', ARCH: 'design-element', MOD: 'design-element', SYS: 'design-element', US: 'story', STORY: 'story', UC: 'use-case', AC: 'acceptance-check' };
// Where an ID is not a requirement whatever its prefix: a decision record, an open-item or question list, a task list.
const DECISION_DOC = /(?:^|\/)(?:adrs?|decisions?)\/|(?:^|\/)[^/]*(?:adr|decision)[^/]*\.md$/i;
const OPEN_ITEM_DOC = /(?:^|\/)[^/]*(?:open[-_ ]?(?:items?|questions?|issues?)|questions|clarifications?)[^/]*\.md$/i;
const TASK_DOC = /(?:^|\/)[^/]*(?:tasks?|todo|plan)[^/]*\.md$/i;

/** Why a declared ID is not a requirement, or null when it is one (or the project's own pattern says it is). */
export function nonRequirementKind(def, custom) {
  if (custom) return null;
  const file = String(def.file || '');
  if (DECISION_DOC.test(file)) return 'decision';
  if (OPEN_ITEM_DOC.test(file)) return 'open-item';
  if (TASK_DOC.test(file)) return KIND_OF_PREFIX[def.id.split('-')[0]] || 'task-list';
  const prefix = def.id.split('-')[0];
  if (!REQUIREMENT_PREFIXES.has(prefix)) return KIND_OF_PREFIX[prefix] || 'other';
  return null;
}


/**
 * The requirement IDs a project declares, by the definition above: `real` are the declared IDs that are
 * requirements; `placeholders` counts template rows; `skipped` counts the declared IDs that are not
 * requirements, by kind (decision, open-item, task, design-element and so on).
 */
export function classifyRequirements(projectDir, config = {}) {
  const patterns = requirementPatterns(config);
  const custom = Boolean(config.traceability?.requirementPattern);
  const all = [...collectRequirementIds(projectDir, config, patterns).values()];
  const declared = all.filter(d => !isPlaceholder(d));
  const skipped = new Map();
  const real = declared.filter(d => {
    const kind = nonRequirementKind(d, custom);
    if (kind) skipped.set(kind, (skipped.get(kind) || 0) + 1);
    return !kind;
  });
  const skippedText = [...skipped].map(([k, n]) => `${n} ${k}`).join(', ');
  return { patterns, custom, real, placeholders: all.length - declared.length, skipped, skippedText };
}
