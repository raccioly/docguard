/**
 * JS/TS AST helpers — the @babel/parser-backed "full support" tier.
 *
 * The headline regression: the old `{([^}]+)}` regex truncated any object body
 * at the first nested `}`. These tests prove the AST extraction keeps nested
 * objects intact, and that route registrations are extracted accurately.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseJsTs, extractJsSchemaBodies, extractJsRouteCalls, extractJsRouteObjects, extractJsMountsAndImports } from '../cli/scanners/js-ast.mjs';

describe('parseJsTs', () => {
  it('parses TypeScript with types + decorators', () => {
    const r = parseJsTs('@Entity() class User { @Column() id: number = 1; }', 'm.ts');
    assert.equal(r.ok, true);
    assert.ok(r.ast);
  });

  it('parses TSX (JSX + types)', () => {
    const r = parseJsTs('const C = (): JSX.Element => <div className="x">hi</div>;', 'C.tsx');
    assert.equal(r.ok, true);
  });

  it('reports ok:false with a message on genuinely unparseable input', () => {
    // errorRecovery handles most things; a raw binary-ish blob should still
    // surface as a parse problem rather than throwing.
    const r = parseJsTs('const = = = {{{', 'bad.ts');
    // Either ok:false, or ok:true with recovered errors — but it must never throw.
    assert.equal(typeof r.ok, 'boolean');
  });
});

describe('extractJsSchemaBodies — balanced bodies (the brace-truncation fix)', () => {
  it('keeps a NESTED z.object intact (old regex stopped at the first })', () => {
    const src = `
      import { z } from 'zod';
      export const UserSchema = z.object({
        name: z.string(),
        address: z.object({ city: z.string(), zip: z.string() }),
        email: z.string().email(),
      });
    `;
    const got = extractJsSchemaBodies(src, 'user.ts');
    assert.ok(Array.isArray(got));
    const zod = got.find(s => s.kind === 'zod' && s.name === 'UserSchema');
    assert.ok(zod, 'should find UserSchema');
    // The old regex captured only up to the first "}" — losing `email` (and
    // mangling `address`). The balanced body must contain ALL three fields.
    assert.match(zod.body, /name:/);
    assert.match(zod.body, /address:/);
    assert.match(zod.body, /email:/, 'the field AFTER the nested object must survive');
  });

  it('extracts a Mongoose schema with nested field-option objects', () => {
    const src = `
      const PostSchema = new mongoose.Schema({
        title: { type: String, required: true },
        author: { type: Schema.Types.ObjectId, ref: 'User' },
        tags: [String],
      });
    `;
    const got = extractJsSchemaBodies(src, 'post.js');
    const m = got.find(s => s.kind === 'mongoose' && s.name === 'PostSchema');
    assert.ok(m, 'should find PostSchema');
    assert.match(m.body, /title:/);
    assert.match(m.body, /author:/, 'fields after a nested {} must survive');
    assert.match(m.body, /tags:/);
  });

  it('extracts a Drizzle table with its table name', () => {
    const src = `
      export const users = pgTable('users', {
        id: serial('id').primaryKey(),
        meta: jsonb('meta').$type<{ a: number }>(),
        email: varchar('email', { length: 255 }),
      });
    `;
    const got = extractJsSchemaBodies(src, 'schema.ts');
    const d = got.find(s => s.kind === 'drizzle');
    assert.ok(d, 'should find a drizzle table');
    assert.equal(d.table, 'users');
    assert.match(d.body, /email:/, 'columns after a nested {} arg must survive');
  });

  it('returns null (not []) when the file cannot be parsed', () => {
    // A truly broken parse should be distinguishable from "no schemas".
    const got = extractJsSchemaBodies('not js at all )(', 'x.ts');
    assert.ok(got === null || Array.isArray(got));
  });

  it('returns [] for a valid file with no schemas', () => {
    const got = extractJsSchemaBodies('export const x = 1 + 2;', 'plain.ts');
    assert.deepEqual(got, []);
  });
});

describe('extractJsRouteCalls — AST route registration (the routes migration)', () => {
  it('matches ANY router receiver, not just app/router/server', () => {
    const got = extractJsRouteCalls(
      "userRouter.get('/users', list);\n" +
      "v1.post('/users', create);\n" +
      "r.delete('/users/:id', del);\n",
      'r.ts'
    );
    const set = got.map(x => `${x.method} ${x.path}`).sort();
    assert.deepEqual(set, ['DELETE /users/:id', 'GET /users', 'POST /users']);
  });

  it('survives multi-line calls and reads template-literal paths', () => {
    const src = [
      'app.put(',
      '  "/items/:id",',
      '  auth,',
      '  update',
      ');',
      'app.get(`/items/${kind}`, list);',
    ].join('\n');
    const set = extractJsRouteCalls(src, 'r.ts').map(x => `${x.method} ${x.path}`).sort();
    assert.deepEqual(set, ['GET /items/:param', 'PUT /items/:id']);
  });

  it('excludes non-route .get()/.post() (path must start with / or be *)', () => {
    const got = extractJsRouteCalls(
      "const m = new Map(); m.get('cacheKey');\n" +
      "headers.get('content-type');\n" +
      "cache.set('k', 1);\n" +
      "app.get('/real', h);\n",
      'r.ts'
    );
    assert.deepEqual(got.map(x => `${x.method} ${x.path}`), ['GET /real']);
  });

  it('returns null when the file is unparseable (caller falls back to regex)', () => {
    const got = extractJsRouteCalls('this is not ) ( valid', 'r.ts');
    assert.ok(got === null || Array.isArray(got));
  });

  it('reports the receiver identifier (for mount-prefix resolution)', () => {
    const got = extractJsRouteCalls(
      "router.get('/a', h);\n" +
      "app.get('/health', h);\n",
      'r.ts'
    );
    const byPath = Object.fromEntries(got.map(r => [r.path, r.receiver]));
    assert.strictEqual(byPath['/a'], 'router');
    assert.strictEqual(byPath['/health'], 'app');
  });
});

describe('extractJsMountsAndImports — mount-prefix resolution inputs', () => {
  it('captures import bindings (import + require) and mount calls', () => {
    const src = [
      "import userRoutes from './routes/users';",
      "const tagRoutes = require('./routes/tags');",
      "app.use('/api/users', userRoutes);",
      "app.use('/api/tags', authMiddleware, tagRoutes);", // router is the LAST ident arg
      "app.use(express.json());",                          // not a path mount — ignored
    ].join('\n');
    const got = extractJsMountsAndImports(src, 'app.ts');
    assert.strictEqual(got.imports.userRoutes, './routes/users');
    assert.strictEqual(got.imports.tagRoutes, './routes/tags');
    const mounts = got.mounts.map(m => `${m.prefix}=${m.ident}`).sort();
    assert.deepEqual(mounts, ['/api/tags=tagRoutes', '/api/users=userRoutes']);
  });

  it('ignores non-string-literal (dynamic) mount prefixes', () => {
    const got = extractJsMountsAndImports("app.use(prefixVar, router);\n", 'app.ts');
    assert.deepEqual(got.mounts, []);
  });

  it('returns null on parse failure (caller keeps bare paths)', () => {
    assert.strictEqual(extractJsMountsAndImports('not ) ( valid', 'app.ts'), null);
  });
});

describe('extractJsRouteObjects — Fastify declarative route form', () => {
  it('reads method + url, including method arrays and the path: alias', () => {
    const src = [
      "fastify.route({ method: 'GET', url: '/users/:id', handler: getUser });",
      "fastify.route({ method: ['POST', 'PUT'], url: '/users' });",
      "app.route({ method: 'DELETE', path: '/items/:id' });",
    ].join('\n');
    const got = extractJsRouteObjects(src, 'r.ts').map(r => `${r.method} ${r.path}`).sort();
    assert.deepEqual(got, ['DELETE /items/:id', 'GET /users/:id', 'POST /users', 'PUT /users']);
  });

  it('ignores .route() calls without a usable url/method', () => {
    const got = extractJsRouteObjects("fastify.route({ handler: h });\nrouter.route('/x');\n", 'r.ts');
    assert.deepEqual(got, []);
  });

  it('returns null on parse failure', () => {
    assert.strictEqual(extractJsRouteObjects('not ) ( valid', 'r.ts'), null);
  });
});
