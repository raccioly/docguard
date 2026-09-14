/** @req specs/009-language-repository-coverage/spec.md#SC-002 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { grepEnvUsage, extractWorkerEnvBindings } from '../cli/shared-source.mjs';
import { astTierAvailable } from '../cli/scanners/js-ast.mjs';
import { detectProjectProfile } from '../cli/scanners/project-type.mjs';
import { validateEnvironment } from '../cli/validators/environment.mjs';
import { validateArchitecture } from '../cli/validators/architecture.mjs';

function fixture(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-worker-capability-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, source] of Object.entries(files)) safeWrite(join(dir, path), source);
  return dir;
}

for (const manifest of ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc']) {
  it('detects typed Worker bindings with ' + manifest, t => {
    const dir = fixture(t, {
      [manifest]: manifest.endsWith('toml') ? 'name = "edge-service"' : '{ "name": "edge-service" }',
      'src/worker.ts': 'export function read(env: Env) { return [env.API_TOKEN, env["CACHE"], env?.DB, env?.["QUEUE"], env.lowerBinding]; }',
    });
    assert.deepEqual([...grepEnvUsage(dir)].sort(), ['API_TOKEN', 'CACHE', 'DB', 'QUEUE', 'lowerBinding'].sort());
    const profile = detectProjectProfile(dir);
    assert.equal(profile.kind, 'service');
    assert.deepEqual(profile.frameworks, ['Cloudflare Workers']);
  });
}

it('recognizes a typed fetch request and env signature without Wrangler', t => {
  const dir = fixture(t, {
    'src/worker.ts': 'export default { async fetch(request: Request, env: Env): Promise<Response> { return new Response(env.API_TOKEN); } };',
    'src/unrelated.ts': 'function read(env: Env) { return env.NOT_A_BINDING; }',
  });
  assert.deepEqual([...grepEnvUsage(dir)], ['API_TOKEN']);
});

it('recognizes a block arrow fetch handler and ignores arbitrary object env properties', t => {
  const dir = fixture(t, {
    'src/worker.ts': 'export default { fetch: (req: Request, env: Env) => { const value = env.API_TOKEN; return [object.env.FAKE, object?.env.OTHER, env.CACHE]; } };',
  });
  assert.deepEqual([...grepEnvUsage(dir)].sort(), ['API_TOKEN', 'CACHE']);
});

/** @req docguard.language-repository-coverage#FR-006 */
it('recognizes imported Worker env with aliases and lexical shadowing', () => {
  const code = [
    'import { env as bindings } from "cloudflare:workers";',
    'const runtime = bindings;',
    'function read() { return runtime.API_TOKEN; }',
    'function shadow(runtime) { return runtime.NOT_A_BINDING; }',
  ].join('\n');
  assert.deepEqual([...extractWorkerEnvBindings(code, 'worker.ts')], ['API_TOKEN']);
  const control = 'import { env as bindings } from "ordinary-config"; export const value = bindings.NOT_A_BINDING;';
  assert.deepEqual([...extractWorkerEnvBindings(control, 'worker.ts')], []);
});

/** @req docguard.language-repository-coverage#FR-006 */
it('recognizes this.env only on imported Cloudflare entrypoint classes', () => {
  const code = [
    'import { WorkerEntrypoint as Entry, DurableObject } from "cloudflare:workers";',
    'export default class extends Entry { fetch() { const bindings = this.env; return bindings.API_TOKEN; } }',
    'export class Durable extends DurableObject { read() { return this.env.STATE_BUCKET; } }',
    'class Ordinary extends Base { read() { return this.env.NOT_A_BINDING; } }',
  ].join('\n');
  assert.deepEqual([...extractWorkerEnvBindings(code, 'worker.ts')].sort(), ['API_TOKEN', 'STATE_BUCKET']);
});

/** @req docguard.language-repository-coverage#FR-006 */
it('recognizes Pages context.env only in directly exported onRequest handlers', () => {
  const code = [
    'export async function onRequest(context) { const bindings = context.env; return bindings.API_TOKEN; }',
    'export const onRequestGet: PagesFunction<Env> = async ({ env }) => env.CACHE;',
    'export const onRequestPost = async (context) => { const { env: runtime } = context; return runtime.DB; };',
    'function helper(context) { return context.env.NOT_A_BINDING; }',
    'export function ordinary(context) { return context.env.STILL_NOT_A_BINDING; }',
  ].join('\n');
  assert.deepEqual([...extractWorkerEnvBindings(code, 'pages.ts')].sort(), ['API_TOKEN', 'CACHE', 'DB']);
});

it('aggregates official Worker and Pages forms into environment usage', t => {
  const dir = fixture(t, {
    'wrangler.toml': 'name = "edge-service"',
    'src/worker.js': [
      'import { env as globalEnv, WorkerEntrypoint } from "cloudflare:workers";',
      'export default { fetch(request, env) { return env.HANDLER_TOKEN; }, queue(batch, env) { return env.QUEUE; } };',
      'export class Rpc extends WorkerEntrypoint { read() { return this.env.RPC_TOKEN; } }',
      'export const globalValue = globalEnv.GLOBAL_TOKEN;',
    ].join('\n'),
    'functions/index.js': 'export function onRequest(context) { return context.env.PAGES_TOKEN; }',
  });
  assert.deepEqual([...grepEnvUsage(dir)].sort(), ['GLOBAL_TOKEN', 'HANDLER_TOKEN', 'PAGES_TOKEN', 'QUEUE', 'RPC_TOKEN']);
});

/** @req docguard.language-repository-coverage#FR-007 */
it('does not trust lookalike imports, classes, handlers, or dynamic property names', () => {
  const code = [
    'import { env as config } from "local-config";',
    'class WorkerEntrypoint {}',
    'class Local extends WorkerEntrypoint { read() { return this.env.CLASS_FAKE; } }',
    'function onRequest(context) { return context.env.PAGES_FAKE; }',
    'const key = "SECRET";',
    'export default { fetch(req: Request, env: Env) { return env[key]; } };',
  ].join('\n');
  assert.deepEqual([...extractWorkerEnvBindings(code, 'worker.ts')], []);
});

/** @req docguard.language-repository-coverage#FR-008 */
it('marks AST-only Worker forms unsupported in the lexical fallback', () => {
  for (const [code, expected] of [
    ['import { env } from "cloudflare:workers"; consume(env.API_TOKEN);', 'worker-imported-env-needs-ast'],
    ['export function onRequest(context) { return context.env.API_TOKEN; }', 'pages-context-needs-ast'],
    ['class Entry extends WorkerEntrypoint { read() { return this.env.API_TOKEN; } }', 'worker-class-env-needs-ast'],
  ]) {
    const result = extractWorkerEnvBindings(code, 'worker.ts', false, null);
    assert.deepEqual([...result], []);
    assert.ok(result.limitations.includes(expected));
  }
});

it('keeps comments, strings, untyped scopes and shadowed env out of bindings', t => {
  const dir = fixture(t, {
    'wrangler.toml': 'name = "edge-service"',
    'src/worker.ts': [
      'function outer(env: Env) {',
      ' const emoji = "😀";',
      ' const text = "env.STRING_ONLY"; // env.COMMENT_ONLY',
      ' function inner(env) { return env.SHADOWED; }',
      ' list.map(env => env.ARROW_SHADOW);',
      ' list.map((env) => { return env.BLOCK_SHADOW; });',
      ' function destructured({env}) { return env.PARAM_SHADOW; }',
      ' { const {env} = object; consume(env.DESTRUCTURED_SHADOW); }',
      ' { const env = object; consume(env.LOCAL_ONLY); }',
      ' return env.REAL_BINDING;',
      '}',
      'function plain(env) { return env.UNTYPED; }',
      'function other(env: Settings) { return env.ORDINARY_OBJECT; }',
      'const object = { env: { OBJECT_ONLY: true } }; object.env.OBJECT_ONLY;',
    ].join('\n'),
  });
  assert.deepEqual([...grepEnvUsage(dir)], ['REAL_BINDING']);
});

it('preserves true missing environment documentation findings for Worker bindings', t => {
  const dir = fixture(t, {
    'src/worker.ts': 'export default { fetch(req: Request, env: Env) { return [env.DOCUMENTED_TOKEN, env.MISSING_TOKEN]; } };',
    'docs-canonical/ENVIRONMENT.md': '## Setup Steps\nInstall runtime.\n## Environment Variables\n| Variable | Purpose |\n| --- | --- |\n| DOCUMENTED_TOKEN | Access |\n',
  });
  const result = validateEnvironment(dir, {});
  assert.ok(result.warnings.some(w => w.includes('MISSING_TOKEN')));
  assert.ok(!result.warnings.some(w => w.includes('DOCUMENTED_TOKEN')));
});

it('keeps source scoping and legacy env extraction intact', t => {
  const dir = fixture(t, {
    'wrangler.jsonc': '// static configuration\n{}',
    'src/main.ts': 'function use(env: Env) { return env.REAL_BINDING; } const node = process.env.NODE_TOKEN; const vite = import.meta.env.VITE_URL;',
    'src/settings.py': 'import os\nvalue = os.getenv("PYTHON_TOKEN")',
    'src/ignored.ts': 'function use(env: Env) { return env.IGNORED_BINDING; }',
    'tests/example.ts': 'export default { fetch(req: Request, env: Env) { return env.FIXTURE_BINDING; } };',
  });
  assert.deepEqual([...grepEnvUsage(dir, { ignore: ['src/ignored.ts'] })].sort(), ['NODE_TOKEN', 'PYTHON_TOKEN', 'REAL_BINDING', 'VITE_URL']);
  assert.deepEqual([...grepEnvUsage(dir, { changedFiles: ['src/settings.py'] })], ['PYTHON_TOKEN']);
});

it('keeps sibling workspace Worker evidence local to its package', t => {
  const dir = fixture(t, {
    'package.json': '{"workspaces":["packages/*"]}',
    'packages/edge/package.json': '{}',
    'packages/edge/wrangler.json': '{}',
    'packages/edge/src/main.ts': 'function read(env: Env) { return env.REAL_BINDING; }',
    'packages/library/package.json': '{}',
    'packages/library/src/main.ts': 'function read(env: Env) { return env.UNRELATED; }',
  });
  assert.deepEqual([...grepEnvUsage(dir)], ['REAL_BINDING']);
});

it('does not classify fixture Wrangler files as the project runtime', t => {
  const dir = fixture(t, { 'package.json': '{}', 'tests/sample/wrangler.toml': 'name = "sample"' });
  assert.equal(detectProjectProfile(dir).kind, 'library');
});

it('retains supported Python edges while dynamic imports keep applicability partial', t => {
  const dir = fixture(t, {
    'pyproject.toml': '[project]\nname = "service"',
    'src/service/__init__.py': '',
    'src/service/routes.py': 'from . import storage\nfrom service import models\nimport importlib\nimportlib.import_module(module_name)',
    'src/service/storage.py': 'from . import routes',
    'src/service/models.py': 'class Model: pass',
  });
  const result = validateArchitecture(dir, {});
  assert.equal(result.applicability.status, 'partial');
  assert.match(result.applicability.reason, /dynamic Python import/);
  assert.ok(result.findings.some(f => f.code === 'ARC002'));
  assert.equal(result.total, 1);
  assert.equal(result.passed, 0);
});

it('retains real JS cycle findings alongside supported Python imports', t => {
  const dir = fixture(t, {
    'src/a.js': 'import "./b.js";', 'src/b.js': 'import "./a.js";', 'src/app.py': 'import os',
  });
  const result = validateArchitecture(dir, {});
  assert.equal(result.applicability.status, 'checked');
  assert.ok(result.findings.some(f => f.code === 'ARC002'));
});

it('ignores fixture Python for capability and checks a mapped architecture document', t => {
  const dir = fixture(t, {
    'src/services/main.js': 'import "../routes/index.js";',
    'src/routes/index.js': 'export const route = true;',
    'tests/fixture.py': 'import missing',
    'handbook/components.md': '## Layer Boundaries\n| Layer | Can Import | Cannot Import |\n|---|---|---|\n| services | utils | routes |\n| routes | services | utils |\n',
  });
  const result = validateArchitecture(dir, { docs: { roles: { architecture: 'handbook/components.md' } } });
  assert.equal(result.applicability.status, 'checked');
  assert.ok(result.findings.some(f => f.code === 'ARC003'));
});

it('reports empty architecture input as not applicable without passes', t => {
  const dir = fixture(t, {});
  const result = validateArchitecture(dir, {});
  assert.equal(result.applicability.status, 'not-applicable');
  assert.equal(result.total, 0);
});


const workerScopeCases = [
  ['control-flow bodies retain the enclosing Worker binding',
    'if (env) { consume(env.REAL_TOKEN); } while (env) { consume(env.REAL_TOKEN); break; } function unrelated(env) { return env.NOT_BINDING; }'],
  ['destructuring property aliases do not bind their key',
    'const {env: settings} = options; consume(env.REAL_TOKEN); { const {env} = options; consume(env.NOT_BINDING); }'],
  ['loop-scoped env ends at the loop boundary',
    'for (const env of items) { consume(env.NOT_BINDING); } consume(env.REAL_TOKEN);'],
  ['conditional var declarations shadow throughout their own function',
    'function inner() { consume(env.NOT_BINDING); if (flag) { var env = local; } return env.NOT_BINDING; } consume(env.REAL_TOKEN);'],
  ['regex literals are not binding reads and division remains code',
    'const pattern = /env.NOT_BINDING/; const escaped = /[a-z]env\\.NOT_BINDING/; consume(10 / env.REAL_TOKEN / 2);'],
];
for (const [label, body] of workerScopeCases) {
  const code = 'export default { fetch(req: Request, env: Env) { ' + body + ' } };';
  for (const [mode, parser] of [['AST', undefined], ['missing parser', null], ['failed parser', () => { throw new SyntaxError('Unsupported syntax'); }]]) {
    it(label + ' (' + mode + ')', () => {
      assert.deepEqual([...extractWorkerEnvBindings(code, 'worker.ts', false, parser)], ['REAL_TOKEN']);
    });
  }
  it('keeps a genuine undocumented binding warning with ' + label, t => {
    const dir = fixture(t, {
      'src/worker.ts': code,
      'docs-canonical/ENVIRONMENT.md': '## Setup Steps\nInstall runtime.\n## Environment Variables\nNo variables documented yet.\n',
    });
    const findings = validateEnvironment(dir, {}).warnings;
    assert.ok(findings.some(w => w.includes('REAL_TOKEN')));
    assert.ok(!findings.some(w => w.includes('NOT_BINDING')));
  });
}

it('uses AST scopes for expression arrows, template substitutions and catch bindings', { skip: !astTierAvailable() }, () => {
  const template = String.fromCharCode(96) + 'value: $' + '{env.TEMPLATE_TOKEN}' + String.fromCharCode(96);
  const code = 'export const fetch = (req: Request, env: Env) => [env.REAL_TOKEN, (() => { try { throw 1; } catch (env) { consume(env.NOT_BINDING); } return ' + template + '; })()];';
  assert.deepEqual([...extractWorkerEnvBindings(code)].sort(), ['REAL_TOKEN', 'TEMPLATE_TOKEN']);
});

it('distinguishes nested destructured aliases from nested local bindings', { skip: !astTierAvailable() }, () => {
  const code = 'function handler(env: Env) { const {options: {env: settings}} = input; consume(env.REAL_TOKEN); function inner({options: {env}}) { return env.NOT_BINDING; } }';
  assert.deepEqual([...extractWorkerEnvBindings(code, 'worker.ts', true)], ['REAL_TOKEN']);
});
