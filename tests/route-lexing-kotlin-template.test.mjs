/**
 * Kotlin string templates in route paths: a path built from a template is
 * unknown and must be omitted, never reported at a guessed path. An escaped
 * `\$` is literal text; an even run of backslashes does not escape it; a raw
 * """…""" string has no escapes at all.
 *
 * Found by Jules (raccioly/docguard#566) for the escaped case; the raw-string
 * case was found reviewing that fix.
 *
 * @req docguard.go-spring-rails-routes#FR-006
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { lexCLike } from '../cli/scanners/route-lexing.mjs';

// `src` is Kotlin source text; the lexer reports the decoded value, or null for a template.
const valueOf = src => lexCLike(src, { templates: true, tripleQuote: true }).lits.get(0).value;

describe('Kotlin string templates in "…" strings', () => {
  it('a plain path is a literal', () => assert.equal(valueOf('"/api/users"'), '/api/users'));
  it('$name and ${…} are templates', () => {
    assert.equal(valueOf('"/api/$version/users"'), null);
    assert.equal(valueOf('"/api/${base}/users"'), null);
  });
  it('an escaped \\$ is literal text', () => assert.equal(valueOf('"/api/\\$version"'), '/api/$version'));
  it('an even run of backslashes does not escape $: "\\\\$v" is a template', () => {
    assert.equal(valueOf('"\\\\$var"'), null);
    assert.equal(valueOf('"\\\\\\\\$var"'), null);
  });
  it('an odd run does: "\\\\\\$v" is a backslash and literal $v', () => assert.equal(valueOf('"\\\\\\$var"'), '\\$var'));
});

describe('Kotlin raw """…""" strings have no escapes', () => {
  it('a plain raw path is a literal', () => assert.equal(valueOf('"""/api/users"""'), '/api/users'));
  it('a backslash before $ does not escape it: """\\$v""" is a template', () => assert.equal(valueOf('"""/api/\\$version"""'), null));
  it('$name in a raw string is a template', () => assert.equal(valueOf('"""/api/$version"""'), null));
});

describe('without the Kotlin templates option', () => {
  it('$ is ordinary text (Java, C#)', () => assert.equal(lexCLike('"/api/$version"', {}).lits.get(0).value, '/api/$version'));
});
