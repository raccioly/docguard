/**
 * Closed-class word lists for the four prose metrics of Doc-Quality, per language
 * (spec 104 FR-017, task T033): negation (DQ007), conditional (DQ008), ambiguous
 * pronouns (DQ002) and compound sentences (DQ003).
 *
 * The Portuguese (`pt`, which covers pt-BR and pt-PT) and Spanish (`es`, every
 * es-*) lists were reviewed by a native speaker on 2026-11-17 (T033) and are
 * applied exactly as approved: no word was added or dropped. The English lists
 * stay in `doc-quality.mjs` as the regexes they have always been, so the English
 * path is byte-identical; nothing here routes English.
 *
 * Matching rules (see `proseMatchers`):
 *   - a word is whole: not preceded or followed by a Unicode letter, digit or
 *     combining mark (JS `\b` does not work for accented letters);
 *   - case-insensitive, and accent-optional: a list word written with an accent
 *     also matches the text without it (`nao` matches `não`), but text carrying
 *     an accent must match the list exactly, so `é` is never the conjunction
 *     `e` and `sí` ("yes") is never `si` ("if");
 *   - `él` (Spanish pronoun) matches only with the accent, because `el` is the
 *     article;
 *   - a phrase matches across whitespace: "a menos que" matches "a  menos\nque";
 *   - Portuguese `se` counts only as the first word of a sentence or right after
 *     a comma, and never after a hyphen (`configura-se`), because elsewhere it
 *     is the reflexive pronoun.
 *
 * Left out on purpose, with the reviewer's reasons: "sem" and "sin" (English does
 * not count "without"); "enquanto" and "mientras" (mostly temporal); the
 * articles and clitics o, a, os, as, lhe, lo, la, los, las, le, les; `el`
 * without the accent; `sí` with the accent.
 *
 * Zero dependencies.
 *
 * @implements docguard.document-languages#FR-017
 */

/** The languages with reviewed lists. Any other non-English language is skipped. */
export const PROSE_WORD_LANGUAGES = Object.freeze(['pt', 'es']);

/** The reviewed lists, exactly as approved on 2026-11-17. */
export const PROSE_WORDS = Object.freeze({
  pt: Object.freeze({
    negation: ['não', 'nunca', 'jamais', 'nenhum', 'nenhuma', 'nenhuns', 'nenhumas', 'nem', 'ninguém', 'nada', 'tampouco'],
    // "se" is handled by `ptSe` (sentence start or after a comma), never as a plain word.
    conditional: ['caso', 'quando', 'sempre que', 'a menos que', 'a não ser que', 'salvo se', 'exceto se', 'contanto que', 'desde que', 'somente se', 'apenas se', 'só se', 'até que', 'caso contrário', 'senão'],
    pronouns: ['isso', 'isto', 'aquilo', 'ele', 'ela', 'eles', 'elas', 'este', 'esta', 'estes', 'estas', 'esse', 'essa', 'esses', 'essas', 'seu', 'sua', 'seus', 'suas', 'dele', 'dela', 'deles', 'delas'],
    compoundPhrases: ['e também', 'e depois', 'e então', 'assim como', 'bem como', 'além de', 'além disso', 'adicionalmente', 'ademais', 'outrossim'],
    conjunctions: ['e'],
    sePattern: true,
  }),
  es: Object.freeze({
    negation: ['no', 'nunca', 'jamás', 'ningún', 'ninguno', 'ninguna', 'ningunos', 'ningunas', 'ni', 'nadie', 'nada', 'tampoco'],
    // "si" matches only without the accent ("sí" is "yes"); `matchers` keeps that exact.
    conditional: ['si', 'cuando', 'siempre que', 'a menos que', 'salvo que', 'excepto si', 'en caso de', 'en caso de que', 'con tal de que', 'solo si', 'sólo si', 'hasta que', 'de lo contrario', 'si no'],
    // "él" matches only with the accent ("el" is the article).
    pronouns: ['esto', 'eso', 'aquello', 'él', 'ella', 'ellos', 'ellas', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'su', 'sus'],
    compoundPhrases: ['y también', 'y luego', 'y después', 'así como', 'además de', 'además', 'adicionalmente', 'asimismo', 'a su vez'],
    conjunctions: ['y', 'e'],
    sePattern: false,
  }),
});

// The accent-optional rule, entry by entry: these list words must carry the accent in the text.
const EXACT_ONLY = new Set(['él']);

const NOT_WORD_BEFORE = '(?<![\\p{L}\\p{N}\\p{M}])';
const NOT_WORD_AFTER = '(?![\\p{L}\\p{N}\\p{M}])';
const MARKS = /\p{M}/gu;

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One list word as a pattern: each accented letter also accepts its bare form; spaces are any whitespace. */
function entryPattern(entry) {
  const nfc = entry.normalize('NFC');
  if (EXACT_ONLY.has(nfc)) return escapeRegex(nfc);
  return [...nfc].map(ch => {
    if (/\s/u.test(ch)) return '\\s+';
    const bare = ch.normalize('NFD').replace(MARKS, '');
    return bare !== ch ? `(?:${escapeRegex(ch)}|${escapeRegex(bare)})` : escapeRegex(ch);
  }).join('');
}

function whole(entries, flags) {
  const alternatives = entries.map(entryPattern).join('|');
  return new RegExp(`${NOT_WORD_BEFORE}(?:${alternatives})${NOT_WORD_AFTER}`, flags);
}

// Portuguese "se": the first word of the sentence (a quote or bracket may precede it) or right after a comma.
// A hyphen in front never counts, so `configura-se` and `-se` do not.
const PT_SE = new RegExp(`(?:^[^\\p{L}\\p{N}\\p{M}-]*|,\\s*)se${NOT_WORD_AFTER}`, 'iu');

/** @type {Map<string, object>} */
const cache = new Map();

/**
 * The matchers of a language, or null when its lists have not been reviewed.
 * Each takes the text of a sentence (negation, conditional, compound) or of the
 * whole prose (pronouns, which counts every occurrence).
 * @param {string} language primary language subtag, `pt` or `es`
 */
export function proseMatchers(language) {
  const lists = PROSE_WORDS[language];
  if (!lists) return null;
  if (cache.has(language)) return cache.get(language);
  const negation = whole(lists.negation, 'iu');
  const conditional = whole(lists.conditional, 'iu');
  const pronouns = whole(lists.pronouns, 'giu');
  const compoundPhrase = whole(lists.compoundPhrases, 'iu');
  const conjunction = whole(lists.conjunctions, 'giu');
  const matchers = {
    negation: sentence => negation.test(sentence.normalize('NFC')),
    conditional: sentence => {
      const s = sentence.normalize('NFC');
      return conditional.test(s) || (lists.sePattern && PT_SE.test(s));
    },
    pronounCount: text => (text.normalize('NFC').match(pronouns) || []).length,
    compound: sentence => {
      const s = sentence.normalize('NFC');
      if (compoundPhrase.test(s)) return true;
      return (s.match(conjunction) || []).length >= 2;
    },
  };
  cache.set(language, matchers);
  return matchers;
}
