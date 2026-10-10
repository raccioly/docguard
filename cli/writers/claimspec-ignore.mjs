/**
 * claimspec v1 `ignore` export — only what survives exactly
 * (specs/057-ignore-reasons FR-008; raccioly/docguard#420).
 *
 * claimspec's `ignore` is "reviewable scoping": every entry carries a reason,
 * because an auditor reads it. The bar (websec-validator#157, #420): export an
 * entry only when its reason, its expiry and its scope all survive; otherwise
 * omit it and COUNT it, so the document is never mistaken for the whole policy.
 *
 * Exported: `.docguardignore` entries with a reason of 8–2000 code points, a
 * readable (or no) expiry, and a pattern gitignore syntax can state with the
 * same scope. Expired entries are exported WITH `expires` — the schema has the
 * field so a consumer can warn, and dropping them would hide a lapsed entry.
 *
 * Never exported (no claimspec kind fits exactly): `.docguard.json` arrays (no
 * reason can be written there), validator-scoped arrays (as `path` they would
 * widen to every tool), inline pragmas (scoped to a code and a line), N/A
 * markers (scoped to a validator or a section), baseline fingerprints (claimspec
 * `baseline`, deferred in #420). Nothing is padded, truncated or invented.
 *
 * @implements docguard.ignore-reasons#FR-008
 */

export const CLAIMSPEC_IGNORE_SCHEMA_VERSION = 1;
export const REASON_MIN = 8;      // `reason` minLength in claimspec ignore
export const REASON_MAX = 2000;   // `reason` maxLength
export const PATTERN_MAX = 512;   // `pattern` maxLength

/**
 * Characters DocGuard's ignore matcher (`globToRegex` in shared-ignore.mjs)
 * passes into a regular expression, or uses as its own placeholder (`§`).
 * gitignore reads every one of them differently.
 */
const REGEX_CHARS = /[?[\]()+^$|{}\\§]/;

/**
 * The gitignore-syntax pattern whose scope equals DocGuard's scope for
 * `pattern`, or `{ pattern: null, why }` when there is none.
 *
 * DocGuard matches a pattern at a path-segment boundary at ANY depth and
 * strips a trailing `/` (so `dir/` also matches a file named `dir`). gitignore
 * anchors a pattern that contains a slash to the root and reads a trailing `/`
 * as "directories only". So: drop the trailing `/`, and prefix `**\/` when the
 * pattern contains a slash.
 */
export function claimspecPathPattern(pattern) {
  const p = String(pattern ?? '').replace(/\/+$/, '');
  if (!p) return { pattern: null, why: 'the pattern is empty' };
  if (p.startsWith('!')) return { pattern: null, why: 'a leading `!` negates a gitignore pattern but is a literal character to DocGuard' };
  if (p.startsWith('/')) return { pattern: null, why: 'a leading `/` anchors a gitignore pattern to the root, while DocGuard matches it nowhere' };
  const special = p.match(REGEX_CHARS);
  if (special) return { pattern: null, why: `DocGuard reads \`${special[0]}\` as a regular expression character, so no gitignore pattern has the same scope` };
  const segments = p.split('/');
  const badGlobstar = segments.some((seg, i) => seg.includes('**') && !(seg === '**' && i > 0 && i === segments.length - 1));
  if (badGlobstar) {
    return { pattern: null, why: '`**` other than a final `/**` matches differently: DocGuard\'s `**/x` misses a root-level `x`, and its `a/**/b` misses `a/b`' };
  }
  const out = p.includes('/') ? `**/${p}` : p;
  if ([...out].length > PATTERN_MAX) return { pattern: null, why: `the pattern is longer than ${PATTERN_MAX} characters (claimspec maximum)` };
  return { pattern: out, why: null };
}

/** `2026-12-31` → `2027-01-01T00:00:00Z`: the first instant the entry no longer applies. */
export function expiryInstant(day) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().replace('.000Z', 'Z');
}

const NOT_REPRESENTABLE = [
  ['config', e => e.kind === 'path' && e.source.file === '.docguard.json' && e.scope === 'all-validators',
    n => `${n} .docguard.json ignore pattern${n === 1 ? '' : 's'}`, '.docguard.json arrays cannot carry a reason'],
  ['validator-scoped', e => e.kind === 'path' && e.source.file === '.docguard.json' && e.scope !== 'all-validators',
    n => `${n} validator-scoped pattern${n === 1 ? '' : 's'}`, 'as a `path` entry it would apply to every tool, not one validator'],
  ['inline', e => e.kind === 'code',
    n => `${n} inline pragma${n === 1 ? '' : 's'}`, 'scoped to finding codes on one line; claimspec has no such kind'],
  ['validator-marker', e => e.kind === 'validator',
    n => `${n} validator N/A marker${n === 1 ? '' : 's'}`, 'scoped to one DocGuard validator'],
  ['section-marker', e => e.kind === 'section',
    n => `${n} section N/A marker${n === 1 ? '' : 's'}`, 'scoped to one document section'],
  ['baseline', e => e.kind === 'fingerprint',
    n => `${n} baseline fingerprint${n === 1 ? '' : 's'}`, 'claimspec `baseline` is deferred until its fingerprint preimage is specified (#420)'],
];

/**
 * Build the claimspec `ignore` document from the suppression model
 * (`collectSuppressions`), plus a report of everything left out.
 *
 * @returns {{ document: {schemaVersion: 1, entries: object[]},
 *   report: { exported: number, candidates: number, omitted: object[], rewritten: object[],
 *     notRepresentable: object[], complete: boolean } }}
 */
export function toClaimspecIgnore(model) {
  const entries = [];
  const omitted = [];
  const rewritten = [];
  const buckets = new Map();
  let candidates = 0;
  for (const e of model?.entries || []) {
    if (e.kind === 'path' && e.source?.file === '.docguardignore') {
      candidates++;
      const at = `.docguardignore:${e.source.line}`;
      const pattern = e.pattern ?? '(no pattern)';
      const skip = why => omitted.push({ at, pattern, why });
      if (e.state === 'invalid') {
        skip(e.problem === 'no-pattern' ? 'the line has no pattern' : 'its expiry is not a calendar date, so its lifetime is unknown');
        continue;
      }
      const length = e.reason ? [...e.reason].length : 0;
      if (!e.reason) { skip('no reason to record'); continue; }
      if (length < REASON_MIN) { skip(`the reason is shorter than ${REASON_MIN} characters (claimspec minimum)`); continue; }
      if (length > REASON_MAX) { skip(`the reason is longer than ${REASON_MAX} characters (claimspec maximum); truncating would change it`); continue; }
      const mapped = claimspecPathPattern(e.pattern);
      if (!mapped.pattern) { skip(mapped.why); continue; }
      const entry = { kind: 'path', pattern: mapped.pattern, reason: e.reason };
      if (e.expires) entry.expires = expiryInstant(e.expires);
      if (mapped.pattern !== e.pattern) rewritten.push({ at, from: e.pattern, to: mapped.pattern });
      entries.push(entry);
      continue;
    }
    const bucket = NOT_REPRESENTABLE.find(([, test]) => test(e));
    const id = bucket ? bucket[0] : 'other';
    buckets.set(id, (buckets.get(id) || 0) + 1);
  }
  const notRepresentable = NOT_REPRESENTABLE
    .filter(([id]) => buckets.has(id))
    .map(([id, , label, why]) => ({ category: id, count: buckets.get(id), label: label(buckets.get(id)), why }));
  if (buckets.has('other')) notRepresentable.push({ category: 'other', count: buckets.get('other'), label: `${buckets.get('other')} other`, why: 'no claimspec kind' });
  return {
    document: { schemaVersion: CLAIMSPEC_IGNORE_SCHEMA_VERSION, entries },
    report: {
      exported: entries.length,
      candidates,
      omitted,
      rewritten,
      notRepresentable,
      complete: omitted.length === 0 && notRepresentable.length === 0,
    },
  };
}
