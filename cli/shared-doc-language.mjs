/**
 * The language of one document (specs/104-document-languages FR-021, Decision 5
 * and Decision 6).
 *
 * `docs.language` says what the project writes in. A document's own name may say
 * otherwise: `<name>.<lang>.md`, an `i18n/<lang>/` folder, a `locales/<lang>/`
 * folder. Nothing else decides: the text of a document never does, and without
 * `docs.language` nothing is inferred.
 *
 * An agent-instruction file (`AGENTS.md`, `CLAUDE.md`, ... spec 094) has no
 * language here, whatever its name or `docs.language`: its rules are DocGuard's
 * own and stay as they are, so it is read as English and gets no alias, no skip
 * and no `language-not-supported` entry.
 *
 * @implements docguard.document-languages#FR-021
 */
import { agentInstructionKind } from './shared-agent-instructions.mjs';
import { documentLabelContext } from './shared-labels.mjs';

/**
 * The label context of a document, or null when it has no language of its own
 * to apply: no `docs.language`, or an agent-instruction file.
 * @param {object} config merged configuration
 * @param {string} relPath project-relative path (any separator)
 */
export function documentLanguage(config, relPath) {
  const rel = String(relPath).replace(/\\/g, '/').replace(/^\.\//, '');
  const ctx = documentLabelContext(config, rel);
  // No `docs.language` is the common case and stays free: nothing else is looked at.
  if (!ctx || agentInstructionKind(rel)) return null;
  return ctx;
}

/**
 * The context of a document whose language is not English, or null: the
 * documents an English-prose rule cannot read. English (declared, by name or by
 * default) and an agent-instruction file are null.
 */
export function nonEnglishDocument(config, relPath) {
  const ctx = documentLanguage(config, relPath);
  return ctx && ctx.language !== 'en' ? ctx : null;
}
