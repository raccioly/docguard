/**
 * A document's declared lifecycle status, read from its header. A leaf
 * module: `speckit.mjs` needs it, and importing it from
 * `document-lifecycle.mjs` closed an import cycle through `spec-registry.mjs`.
 *
 * The label (`Status`, `Situação`, `Estado`) and the retired words of the
 * project's `docs.language` are read through the label registry; the English
 * label and words are the legacy rule, unchanged (spec 104 FR-014).
 *
 * @implements docguard.upstream-coverage#FR-007
 * @implements docguard.dora-evidence#FR-005
 * @implements docguard.document-languages#FR-014
 */
import { aliasesFor, foldText, hasTerminalWord, isRetiredWord, isSupersededWord, lifecycleLabelKeys } from '../shared-labels.mjs';

export const RETIRED_STATUSES = new Set(['archived', 'deprecated', 'obsolete', 'superseded']);

const TERMINAL_STATUS_RE = /\b(?:superseded|retired|archived|withdrawn|obsolete|abandoned)\b/i;

/**
 * The status of a document: the first `Status` field of its first 40 lines.
 * With a label context that has aliases for the label (`Situação`, `Estado`, or
 * a `docs.labelAliases.lifecycle-status` entry) a field written with one of them
 * is read too, whole-word and accent-insensitive; the legacy match is tried first.
 *
 * @param {string} content
 * @param {object|null} [labels] `labelContext(config)`
 */
export function parseLifecycleStatus(content, labels = null) {
  const header = content.split('\n').slice(0, 40).join('\n');
  const match = header.match(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?Status(?::)?(?:\*\*)?\s*:?\s*(?:\*\*)?([^*\n]+)/i);
  if (match?.[1]?.trim()) return match[1].trim();
  if (!labels || !aliasesFor('lifecycle-status', labels).length) return null;
  const keys = lifecycleLabelKeys(labels);
  const lines = header.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const field = /^\s*(?:[-*>]\s*)?(?:\*\*)?(\p{L}+)(?:\*\*)?\s*:\s*(?:\*\*)?([^*\n]+)/u.exec(lines[i]);
    if (field && keys.has(foldText(field[1])) && field[2].trim()) return field[2].trim();
    const heading = /^\s*#{1,6}\s+(\p{L}+)\s*$/u.exec(lines[i]);
    if (heading && keys.has(foldText(heading[1]))) {
      const next = lines.slice(i + 1).find(line => line.trim());
      if (next && !/^\s*#/.test(next)) return next.replace(/[*_`]/g, '').trim();
    }
  }
  return null;
}

/**
 * Whether a lifecycle status value is a retired one: the English words
 * (`RETIRED_STATUSES`), or, with a label context, the aliases of `deprecated`
 * and `superseded` of the language and of `docs.labelAliases`.
 */
export function isRetiredStatus(status, labels = null) {
  if (!status) return false;
  return RETIRED_STATUSES.has(String(status).trim().toLowerCase()) || isRetiredWord(status, labels);
}

/**
 * The English kind agents are told for a document that is not active: `superseded`,
 * `retired`, or null for a status that is neither (the caller keeps the status as written).
 */
export function retiredKind(status, labels = null) {
  const s = String(status || '').trim().toLowerCase();
  if (s === 'superseded' || isSupersededWord(status, labels)) return 'superseded';
  if (RETIRED_STATUSES.has(s) || s === 'retired' || isRetiredWord(status, labels)) return 'retired';
  return null;
}

/** Whether a status text names a terminal state: the legacy English words, or the same aliases of the language. */
export function isTerminalStatus(text, labels = null) {
  return TERMINAL_STATUS_RE.test(text || '') || hasTerminalWord(text, labels);
}
