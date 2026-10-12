/**
 * @implements docguard.go-spring-rails-routes#FR-006
 * A route whose path or prefix cannot be resolved to literal text or a resolvable constant MUST be omitted, never reported at a guessed path.
 */
import test from 'node:test';
import assert from 'node:assert';
import { lexCLike } from '../cli/scanners/route-lexing.mjs';

test('Kotlin template with escaped backslash is recognized as unresolvable', () => {
  // \\$var means a single literal backslash followed by the template $var.
  // This must be treated as unresolvable (value = null), so no guessed path is emitted.
  const code = `"\\\\$var"`; // two backslashes in the source string literal
  const lexed = lexCLike(code, { templates: true });
  assert.equal(lexed.lits.get(0).value, null, 'Expected template to yield null value');
});
