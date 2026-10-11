const a = "http://x // @implements x#FR-001";
const b = 'single /* @implements x#FR-001 */';
const c = `template // @implements x#FR-001 ${a + "/* @implements x#FR-001 */"} tail`;
const d = /\/\/ @implements x#FR-001/g;
const e = /[//]@implements x#FR-001/;
const f = a.length / 2 / 1;
export { a, b, c, d, e, f };
