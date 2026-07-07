/**
 * Shared IR primitives — zero-dependency TF-IDF + cosine similarity.
 *
 * Backs IR-based traceability link recovery (feat 5): when a requirement has no
 * exact `@req <ID>` annotation, rank candidate test/code artifacts by textual
 * similarity (Vector Space Model, the canonical IR traceability technique —
 * "basic linear algebra, no external services"). A requirement with NO
 * candidate above threshold is a strong "unimplemented / untested" signal.
 *
 * Pure functions over token arrays; the caller tokenizes (we reuse the
 * identifier-aware tokenizer from shared-diff so `getUserById` in code matches
 * "get user by id" in a requirement).
 */

/** term → count for one document's tokens. */
export function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/**
 * Inverse document frequency across a corpus of token arrays.
 * idf(t) = ln(N / (1 + df(t))) + 1  — smoothed so a term in every doc still
 * carries a small positive weight (avoids all-zero vectors on tiny corpora).
 */
export function buildIdf(corpusTokenArrays) {
  const N = corpusTokenArrays.length || 1;
  const df = new Map();
  for (const tokens of corpusTokenArrays) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log(N / (1 + d)) + 1);
  return idf;
}

/** TF-IDF vector (Map term→weight) for a document, given a prebuilt idf. */
export function tfidfVector(tokens, idf) {
  const tf = termFreq(tokens);
  const vec = new Map();
  const len = tokens.length || 1;
  for (const [t, count] of tf) {
    const w = idf.get(t);
    if (w === undefined) continue; // term not in corpus idf → skip
    vec.set(t, (count / len) * w); // normalized TF × IDF
  }
  return vec;
}

/** Cosine similarity of two sparse Map vectors. 0 when either is empty. */
export function cosineSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  // iterate the smaller for the dot product
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) {
    const w2 = large.get(t);
    if (w2 !== undefined) dot += w * w2;
  }
  if (dot === 0) return 0;
  let na = 0; for (const w of a.values()) na += w * w;
  let nb = 0; for (const w of b.values()) nb += w * w;
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Rank candidate documents against a query by cosine similarity.
 * @param queryTokens tokens of the requirement text
 * @param candidates  [{ id, tokens }]
 * @returns [{ id, score }] sorted desc, scores in [0,1]
 */
export function rankBySimilarity(queryTokens, candidates) {
  const corpus = [queryTokens, ...candidates.map(c => c.tokens)];
  const idf = buildIdf(corpus);
  const qv = tfidfVector(queryTokens, idf);
  return candidates
    .map(c => ({ id: c.id, score: cosineSimilarity(qv, tfidfVector(c.tokens, idf)) }))
    .sort((x, y) => y.score - x.score);
}
