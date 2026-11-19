/**
 * Glossary Validator (specs/105-glossary-and-plain-writing): one term for one concept.
 *
 * The project writes a glossary, a table with a Use and an Avoid column
 * (`docs/GLOSSARY.md`, or the file `docs.glossary` names). This validator reads
 * it and reports each document that uses an Avoid term in prose:
 *
 *   GLS001  a document uses a term the glossary says to avoid (one finding per
 *           document and term: the count and the first five lines)
 *   GLS002  a glossary row is malformed (empty Use cell, duplicate term, more
 *           than 500 rows)
 *   GLS003  glossary rows contradict each other (a term is Use and Avoid)
 *   GLS004  no glossary DocGuard can read (informational: a missing glossary is
 *           not a defect in the documents)
 *
 * Looking for the glossary is itself a check that gets an answer, so a project
 * without one is never an `empty` result and never exits 4 because of this
 * validator (Decision 3). Documents the glossary cannot judge (another
 * language) are listed in `unexaminedDocuments` with `language-not-supported`,
 * which never changes the exit code. No finding is made from code, links, paths,
 * quoted text or the headings DocGuard requires (see `readDocument`).
 *
 * Zero NPM runtime dependencies; reads files only.
 */
import { mkFinding, resultFromFindings, suppressesCode } from '../findings.mjs';
import { contractFields, notApplicable } from '../shared-result-contract.mjs';
import { documentLanguage } from '../shared-doc-language.mjs';
import { LANGUAGE_NOT_SUPPORTED } from '../shared-labels.mjs';
import {
  MAX_DOCUMENT_BYTES, MAX_GLOSSARY_BYTES, glossaryDocuments, glossaryPath, parseGlossary, readBounded, readDocument, termMatcher,
} from '../shared-glossary.mjs';

const VALIDATOR = 'glossary';

/**
 * Whether the Glossary's kind of check belongs to the project: it applies when the project has at
 * least one document to check, whether or not it has a glossary yet.
 * @implements docguard.glossary-and-plain-writing#FR-015
 */
export function applies(projectDir, config = {}) {
  const docs = glossaryDocuments(projectDir, config);
  return docs.length > 0
    ? { applies: true, evidence: `${docs.length} document(s) to check for the project's terms, for example ${docs[0].rel}` }
    : { applies: false, evidence: 'no canonical document, README or documentation-home Markdown file besides the glossary, the changelog, decision records and specs' };
}

/** @implements docguard.glossary-and-plain-writing#FR-014 */
function glossaryContract(projectDir, config, performed, found) {
  return contractFields({
    performed,
    found,
    ran: `looked for the project glossary and checked ${Math.max(0, performed - 1)} document(s) against its terms`,
    decide: () => applies(projectDir, config),
    empty: () => notApplicable(
      'Glossary found no document to check against a project glossary: no canonical document, README.md or Markdown file in a documentation home, apart from the glossary, the changelog, decision records and specs.',
      'documents, such as README.md or Markdown files in docs/: then Glossary checks them against the Use and Avoid terms of docs/GLOSSARY.md (docguard init --with glossary writes a starter)',
    ),
  });
}

/** "3, 7, 9, 12, 15 and 7 more" */
function lineList(lines) {
  const shown = lines.slice(0, 5).join(', ');
  return lines.length > 5 ? `${shown} and ${lines.length - 5} more` : shown;
}

/**
 * Check every document against the glossary. A project with no readable glossary gets GLS004 and
 * nothing else; a glossary with malformed or contradicting rows gets GLS002 and GLS003 at the
 * glossary line and does not check the conflicting terms.
 * @implements docguard.glossary-and-plain-writing#FR-007
 * @implements docguard.glossary-and-plain-writing#FR-011
 * @implements docguard.glossary-and-plain-writing#FR-013
 * @implements docguard.glossary-and-plain-writing#FR-015
 */
export function validateGlossary(projectDir, config = {}) {
  const docs = glossaryDocuments(projectDir, config);
  if (docs.length === 0) return { errors: [], warnings: [], passed: 0, total: 0, ...glossaryContract(projectDir, config, 0, false) };

  const findings = [];
  const unexamined = [];
  const glossary = glossaryPath(projectDir, config);
  const push = (code, message, location, suggestion) => findings.push(mkFinding({ code, validator: VALIDATOR, severity: 'warn', message, location, suggestion }));

  // The lookup is check one: it always has an answer.
  let performed = 1;
  let failed = 0;
  const read = glossary.exists ? readBounded(glossary.abs, MAX_GLOSSARY_BYTES) : null;
  const parsed = read ? parseGlossary(read.text) : null;

  if (!parsed || !parsed.found) {
    const looked = glossary.configured ? glossary.rel : 'docs/GLOSSARY.md, docs-canonical/GLOSSARY.md and GLOSSARY.md';
    push('GLS004',
      glossary.exists
        ? `${glossary.rel} has no table with a Use column and an Avoid column, so DocGuard cannot check terms from it`
        : `No glossary found (looked for ${looked}), so DocGuard cannot check that each concept has one name`,
      glossary.rel,
      { kind: 'fix', text: `Write ${glossary.rel} with a Use and Avoid table, then run docguard guard`, command: 'docguard init --with glossary' });
    return { ...resultFromFindings(findings, { passed: 1, total: 1 }), ...glossaryContract(projectDir, config, performed, true) };
  }

  if (read.truncated) {
    parsed.issues.push({ code: 'GLS002', line: 1, message: `The glossary file is larger than ${MAX_GLOSSARY_BYTES / 1024 / 1024} MB; only the first ${MAX_GLOSSARY_BYTES / 1024 / 1024} MB is read` });
  }
  for (const issue of parsed.issues) {
    push(issue.code, `${glossary.rel}:${issue.line} ${issue.message}`, `${glossary.rel}:${issue.line}`,
      issue.code === 'GLS003'
        ? { kind: 'review', text: 'Keep each term in one role: either the term to use or a term to avoid, and an Avoid term under one Use term' }
        : { kind: 'fix', text: 'Fix the row: one Use term per row, Avoid terms separated by commas, each term once' });
  }
  if (parsed.issues.length > 0) failed++;

  const matcher = termMatcher(parsed);
  const glossaryLanguage = documentLanguage(config, glossary.rel);
  for (const doc of docs) {
    const language = documentLanguage(config, doc.rel);
    // A glossary holds the terms of one language: a document in another one is reported, never passed silently.
    if ((language?.language ?? 'en') !== (glossaryLanguage?.language ?? 'en')) {
      unexamined.push({
        path: doc.rel,
        cause: LANGUAGE_NOT_SUPPORTED,
        blocking: false,
        language: language?.language ?? 'en',
        tag: language?.tag ?? 'en',
        sections: [],
        what: 'prose',
        reason: `${doc.rel} not checked against the glossary: it is written in "${language?.tag ?? 'en'}" and ${glossary.rel} in "${glossaryLanguage?.tag ?? 'en'}", and a glossary holds the terms of one language`,
        howToConfigure: 'Nothing in this document is wrong: the glossary checks documents in its own language, so this one is reported here instead of being passed silently.',
      });
      continue;
    }
    // With no Avoid term to look for there is nothing to check, and a check that looks for nothing is not counted.
    if (matcher.avoidCount === 0) continue;
    const text = readBounded(doc.abs, MAX_DOCUMENT_BYTES);
    if (!text) continue;
    const { lines, markers } = readDocument(text.text, language);
    if (markers.off) continue;
    performed++;

    const hits = new Map(); // entry -> line numbers
    for (const l of lines) {
      if (!/\p{L}/u.test(l.text) || suppressesCode(l.raw, 'GLS001')) continue;
      for (const hit of matcher.hits(l.text, markers.allow)) {
        if (!hits.has(hit)) hits.set(hit, []);
        hits.get(hit).push(l.line);
      }
    }
    // One finding per document and Avoid term, in glossary order.
    const ordered = [...hits].sort((a, b) => a[0].line - b[0].line || (a[0].term < b[0].term ? -1 : 1));
    if (ordered.length > 0) failed++;
    for (const [entry, found] of ordered) {
      const n = found.length;
      push('GLS001',
        `${doc.rel}: "${entry.term}" is on the glossary's avoid list; use "${entry.use}" (${glossary.rel}:${entry.line}). Found on ${n} line${n === 1 ? '' : 's'}: ${lineList(found)}`,
        `${doc.rel}:${found[0]}`,
        { kind: 'fix', text: `Replace "${entry.term}" with "${entry.use}", or add <!-- docguard:glossary allow ${entry.term} — the word means something else here --> when it does` });
    }
  }

  return {
    ...resultFromFindings(findings, { passed: performed - failed, total: performed }),
    ...(unexamined.length ? { unexaminedDocuments: unexamined } : {}),
    ...glossaryContract(projectDir, config, performed, findings.length > 0),
  };
}
