import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  splitIdentifier, tokenize, parseUnifiedDiff, activityLabeledDiff,
  removedTokens, addedTokens, tokenOverlap,
} from '../cli/shared-diff.mjs';

describe('splitIdentifier', () => {
  it('splits camelCase, snake_case, kebab, dot, and acronyms', () => {
    assert.deepEqual(splitIdentifier('getUserById'), ['get', 'user', 'by', 'id']);
    assert.deepEqual(splitIdentifier('user_id'), ['user', 'id']);
    assert.deepEqual(splitIdentifier('HTTPServer'), ['http', 'server']);
    assert.deepEqual(splitIdentifier('data-model.field'), ['data', 'model', 'field']);
  });
});

describe('tokenize', () => {
  it('keeps whole identifiers AND sub-words, lowercased, deduped', () => {
    const t = tokenize('The getUserById function');
    assert.ok(t.includes('getuserbyid'), 'whole identifier');
    assert.ok(t.includes('user'), 'sub-word');
    assert.ok(!t.includes('the'), 'stopword dropped');
    assert.ok(!t.includes('by'), 'too-short sub-word dropped (<3)');
  });
  it('dedupes', () => {
    const t = tokenize('user user user');
    assert.equal(t.filter(x => x === 'user').length, 1);
  });
});

const SAMPLE_DIFF = `diff --git a/src/auth.ts b/src/auth.ts
index abc..def 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,7 +10,7 @@ export class Auth {
 context before
-  validateToken(token) {
+  verifyToken(token) {
   body unchanged
-  legacyLogin() {}
 tail context
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1,2 +1,3 @@
 intro
+new line
`;

describe('parseUnifiedDiff', () => {
  it('parses a multi-file diff', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    assert.equal(files.length, 2);
    assert.equal(files[0].newPath, 'src/auth.ts');
    assert.equal(files[1].newPath, 'README.md');
    assert.equal(files[0].hunks.length, 1);
  });
  it('captures op-tagged lines', () => {
    const files = parseUnifiedDiff(SAMPLE_DIFF);
    const ops = files[0].hunks[0].lines.map(l => l.op).join('');
    assert.equal(ops, ' -+ - '); // context, del, add, context, del, context
  });
  it('flags added/deleted files via /dev/null', () => {
    const d = `diff --git a/new.ts b/new.ts
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,1 @@
+hello
`;
    assert.equal(parseUnifiedDiff(d)[0].status, 'added');
  });
  it('returns [] for empty input', () => {
    assert.deepEqual(parseUnifiedDiff(''), []);
    assert.deepEqual(parseUnifiedDiff(null), []);
  });
});

describe('activityLabeledDiff', () => {
  it('groups adjacent -/+ into replace, lone - into delete, lone + into add', () => {
    const [auth] = parseUnifiedDiff(SAMPLE_DIFF);
    const acts = activityLabeledDiff(auth);
    // validateToken → verifyToken is a replace; legacyLogin removal is a delete
    assert.equal(acts[0].type, 'replace');
    assert.match(acts[0].del[0], /validateToken/);
    assert.match(acts[0].add[0], /verifyToken/);
    assert.equal(acts[1].type, 'delete');
    assert.match(acts[1].del[0], /legacyLogin/);
  });
});

describe('removedTokens / addedTokens', () => {
  it('collects tokens from - and + lines respectively', () => {
    const [auth] = parseUnifiedDiff(SAMPLE_DIFF);
    const removed = removedTokens(auth);
    const added = addedTokens(auth);
    assert.ok(removed.has('validatetoken'), 'validateToken removed');
    assert.ok(removed.has('legacylogin'), 'legacyLogin removed');
    assert.ok(added.has('verifytoken'), 'verifyToken added');
    assert.ok(!added.has('validatetoken'), 'validateToken is not added');
  });
});

describe('tokenOverlap', () => {
  it('finds shared tokens between a doc and a change set', () => {
    const [auth] = parseUnifiedDiff(SAMPLE_DIFF);
    const removed = removedTokens(auth);
    // a doc still describing validateToken should overlap the removed set
    const docTokens = tokenize('Call validateToken to authenticate the session.');
    const { count, shared } = tokenOverlap(docTokens, removed);
    assert.ok(count >= 1);
    assert.ok(shared.includes('validatetoken'));
  });
  it('no overlap when doc talks about unrelated things', () => {
    const [auth] = parseUnifiedDiff(SAMPLE_DIFF);
    const { count } = tokenOverlap(tokenize('The pricing page shows invoices.'), removedTokens(auth));
    assert.equal(count, 0);
  });
});
