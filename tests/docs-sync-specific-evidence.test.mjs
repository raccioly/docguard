/**
 * Docs-Sync counts only visible, specific names
 * (specs/078-docs-sync-specific-evidence): text in an HTML comment documents
 * nothing, a Next.js route handler is named by its URL path, and a name that
 * several checked files share is qualified by its directory.
 *
 * @req docguard.docs-sync-specific-evidence#FR-001
 * @req docguard.docs-sync-specific-evidence#FR-002
 * @req docguard.docs-sync-specific-evidence#FR-003
 * @req docguard.docs-sync-specific-evidence#FR-004
 * @req docguard.docs-sync-specific-evidence#FR-005
 * @req docguard.docs-sync-specific-evidence#FR-006
 * @req docguard.docs-sync-specific-evidence#FR-007
 * @req docguard.docs-sync-specific-evidence#FR-008
 * @req docguard.docs-sync-specific-evidence#SC-001
 * @req docguard.docs-sync-specific-evidence#SC-002
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { visibleMarkdown } from '../cli/shared-html-comments.mjs';
import { createUrlPathMatcher, namesDirectory, namesToken, treePaths } from '../cli/scanners/doc-references.mjs';
import { appRouterPath } from '../cli/scanners/routes.mjs';
import { validateDocsSync } from '../cli/validators/docs-sync.mjs';
import { listTrackedFiles } from '../cli/shared-git.mjs';
import { CODES } from '../cli/findings.mjs';
import { PROJECTS, materialize } from './fixtures/generated-docs-projects.mjs';

const CLI = resolve('cli/docguard.mjs');
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

function makeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-dsy-specific-'));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

/** DSY findings as `CODE location`, for code files plus `docs-canonical/<name>` documents. */
function dsy(code, docs, config = {}) {
  const files = { ...code };
  for (const [name, text] of Object.entries(docs)) files[`docs-canonical/${name}`] = text;
  return validateDocsSync(makeDir(files), config).findings.map(f => `${f.code} ${f.location}`).sort();
}

describe('visibleMarkdown — a document as a reader sees it (FR-001)', () => {
  it('drops single-line and multi-line comments and keeps the text around them', () => {
    assert.equal(visibleMarkdown('a <!-- users --> b'), 'a  b');
    assert.equal(visibleMarkdown('a <!-- one\ntwo users\nthree --> b\nc'), 'a \n\n b\nc');
  });

  it('a comment that never closes hides the rest of the document', () => {
    assert.equal(visibleMarkdown('a\n<!-- open\nusers\nmore'), 'a\n\n\n');
  });

  it('a <!-- inside a code span is text', () => {
    assert.equal(visibleMarkdown('quote `<!--` users\nnext'), 'quote `<!--` users\nnext');
  });

  it('a fenced code block is text, comments in it included, and does not open a comment', () => {
    const doc = '```html\n<!-- users -->\n<!-- open\n```\nafter users';
    assert.equal(visibleMarkdown(doc), doc);
    assert.equal(visibleMarkdown('~~~~\n<!--\n~~~\nstill fenced\n~~~~\nusers'), '~~~~\n<!--\n~~~\nstill fenced\n~~~~\nusers');
  });
});

describe('appRouterPath — the URL a Next.js App Router directory serves (FR-003)', () => {
  it('drops route groups and renders dynamic segments as the route scanner does', () => {
    assert.equal(appRouterPath('api/users'), '/api/users');
    assert.equal(appRouterPath('api/(admin)/users/[id]'), '/api/users/:id');
    assert.equal(appRouterPath('api/auth/[...nextauth]'), '/api/auth/:nextauth*');
    assert.equal(appRouterPath('api/shop/[[...filters]]'), '/api/shop/:filters*');
    assert.equal(appRouterPath('api\\deals\\[dealId]'), '/api/deals/:dealId');
  });
});

describe('createUrlPathMatcher — a document names a URL path (FR-003)', () => {
  const names = (text, path) => createUrlPathMatcher(text)(path);

  it('accepts the path as a URL, in any parameter syntax, after a method, host or base path', () => {
    for (const text of ['/api/users/{id}', 'GET /api/users/:id', '`/api/users/[userId]`', 'https://example.com/api/users/<id>',
      'http://localhost:3000/api/users/:id?expand=1', '/v1/api/users/{id}#get', '| `DELETE` | `/api/users/:userId` |',
      '[/api/users/{id}](#users)', 'call /api/users/:id.', 'api/users/{id}']) {
      assert.ok(names(text, '/api/users/:id'), text);
    }
  });

  it('accepts the path inside the handler file or directory path, route groups dropped', () => {
    for (const text of ['src/app/api/users/[id]/route.ts', '`app/api/users/[id]/`', 'apps/web/src/app/api/(admin)/users/[id]/route.js']) {
      assert.ok(names(text, '/api/users/:id'), text);
    }
  });

  it('the path must end there, in both directions', () => {
    assert.ok(!names('/api/users/{id}', '/api/users'));
    assert.ok(!names('/api/users', '/api/users/:id'));
    assert.ok(!names('src/app/api/users/[id]/route.ts', '/api/users'));
    assert.ok(!names('/api/users-admin and /api/userss', '/api/users'));
    assert.ok(!names('/api/users/route-helpers.ts', '/api/users'));
    assert.ok(!names('/admin/users', '/api/users'));
    assert.ok(names('/api/users/', '/api/users'));
  });

  it('a trailing wildcard names the routes under a prefix below /api, never /api itself', () => {
    assert.ok(names('`/api/deals/*`', '/api/deals/:dealId/notes'));
    assert.ok(names('Deals["/api/deals/**"]', '/api/deals'));
    assert.ok(names('/api/deals/[dealId]/*', '/api/deals/:dealId/notes'));
    assert.ok(!names('`/api/*`', '/api/deals/:dealId/notes'));
    assert.ok(!names('`/api/**`', '/api/deals'));
    assert.ok(!names('`src/app/api/*/route.ts`', '/api/deals'));
    assert.ok(!names('`/api/deals/*`', '/api/dealsx/notes'));
    assert.ok(!names('`/api/deals/*/notes`', '/api/deals/:dealId/notes'));
  });

  it('never names a path from the word route or a bare directory name', () => {
    assert.ok(!names('Every API route lives in route.ts; users and the users route are documented.', '/api/users'));
  });
});

describe('namesDirectory — a directory as a module path (FR-005)', () => {
  it('accepts the directory with its parent, by / or ., ending there', () => {
    for (const text of ['services/auth', '`src/services/auth/`', 'from app.services.auth import x', 'see services/auth.']) {
      assert.ok(namesDirectory(text, ['services', 'auth']), text);
    }
  });

  it('rejects a path that continues into a file or a deeper directory, or a longer name', () => {
    for (const text of ['services/auth/OktaAuthService.ts', 'services/auth.ts', 'services/authz', 'myservices/auth', 'services.auth.types']) {
      assert.ok(!namesDirectory(text, ['services', 'auth']), text);
    }
  });
});

describe('treePaths — the paths a drawn file tree lists (FR-008)', () => {
  it('joins each entry to the entries above it and to the directory line above the tree', () => {
    const tree = '```\nsrc/app/api/           # API routes\n├── users/\n│   ├── route.ts      # GET, POST\n│   └── [id]/route.ts\n│\n└── deals/\n    └── route.ts\n```';
    assert.deepEqual(treePaths(tree), [
      'src/app/api/users', 'src/app/api/users/route.ts', 'src/app/api/users/[id]/route.ts',
      'src/app/api/deals', 'src/app/api/deals/route.ts',
    ]);
  });

  it('reads ASCII trees, and a tree with no directory line starts at its first entry', () => {
    assert.deepEqual(treePaths('services/\n|-- auth/\n|   `-- index.ts\n`-- billing.ts'),
      ['services/auth', 'services/auth/index.ts', 'services/billing.ts']);
    assert.deepEqual(treePaths('```\n├── src/\n│   └── index.ts\n```'), ['src', 'src/index.ts']);
  });

  it('prose ends a tree', () => {
    assert.deepEqual(treePaths('api/\n├── users/\nSee above.\n├── route.ts'), ['api/users', 'route.ts']);
  });
});

describe('Docs-Sync — hidden text does not document a file (FR-001, FR-002, US1)', () => {
  const CODE = { 'src/routes/users.js': 'export const list = () => [];\n' };

  it('a name only inside comments does not document the file', () => {
    assert.deepEqual(dsy(CODE, {
      'DATA-MODEL.md': '# Data\n\n| <!-- e.g. User --> | <!-- e.g. users table --> | <!-- e.g. Registered users --> |\n',
      'SECURITY.md': '# Security\n\n<!--\nHow users/services authenticate\n-->\n',
    }), ['DSY001 src/routes/users.js']);
  });

  it('visible text next to a comment, a quoted <!-- and a fenced comment still document it', () => {
    for (const text of ['The users routes <!-- note -->.', 'Quote `<!--` then users.', '```html\n<!-- users -->\n```\n',
      '```\n<!-- never closed\n```\nusers']) {
      assert.deepEqual(dsy(CODE, { 'API.md': `# API\n\n${text}\n` }), [], text);
    }
  });

  it('a docguard:section covers declaration documents the file it lists', () => {
    for (const covers of ['src/routes/users.js', 'src/routes/users.js#list', 'src/app.js, src/routes/users.js#list']) {
      assert.deepEqual(dsy(CODE, {
        'API.md': `# API\n\n<!-- docguard:section id=listing source=human covers="${covers}" -->\nListing is paginated.\n<!-- /docguard:section -->\n`,
      }), [], covers);
    }
    assert.deepEqual(dsy(CODE, {
      'API.md': '# API\n\n<!-- docguard:section id=listing source=human covers="src/routes/users.json" -->\nListing.\n<!-- /docguard:section -->\n',
    }), ['DSY001 src/routes/users.js']);
  });
});

describe('Docs-Sync — a Next.js route handler is documented by its URL path (FR-003, US2)', () => {
  const CODE = {
    'src/app/api/users/route.ts': 'export async function GET() {}\n',
    'src/app/api/users/[id]/route.ts': 'export async function GET() {}\n',
    'src/app/api/(admin)/audit/route.ts': 'export async function GET() {}\n',
    'src/app/api/deals/[dealId]/notes/route.ts': 'export async function GET() {}\n',
  };
  const ALL = [
    'DSY001 src/app/api/(admin)/audit/route.ts',
    'DSY001 src/app/api/deals/[dealId]/notes/route.ts',
    'DSY001 src/app/api/users/[id]/route.ts',
    'DSY001 src/app/api/users/route.ts',
  ];

  it('the word route, route.ts, users or the users route documents no handler', () => {
    assert.deepEqual(dsy(CODE, { 'API.md': '# API\n\nEvery API route is a route.ts file. The users route lists users.\n' }), ALL);
  });

  it('a URL path or file path documents exactly its own handler', () => {
    assert.deepEqual(dsy(CODE, { 'API.md': '# API\n\n`GET /api/users/:id` returns one user.\n' }),
      ALL.filter(f => !f.includes('users/[id]')));
    assert.deepEqual(dsy(CODE, { 'API.md': '# API\n\nSee src/app/api/users/[id]/route.ts.\n' }),
      ALL.filter(f => !f.includes('users/[id]')));
    assert.deepEqual(dsy(CODE, { 'API.md': '# API\n\n`/api/users` lists users.\n' }),
      ALL.filter(f => f !== 'DSY001 src/app/api/users/route.ts'));
  });

  it('a route group handler is documented by its URL or by its file path', () => {
    for (const text of ['`/api/audit`', 'src/app/api/(admin)/audit/route.ts']) {
      assert.deepEqual(dsy(CODE, { 'API.md': `# API\n\n${text}\n` }), ALL.filter(f => !f.includes('audit')), text);
    }
  });

  it('a wildcard below /api documents the routes under it; /api/* documents none', () => {
    assert.deepEqual(dsy(CODE, { 'API.md': '# API\n\n`/api/deals/*` manages deals.\n' }), ALL.filter(f => !f.includes('deals')));
    assert.deepEqual(dsy(CODE, { 'API.md': '# API\n\nAll of `/api/*` needs a session; handlers are `src/app/api/*/route.ts`.\n' }), ALL);
  });

  it('a drawn file tree documents the handlers and directories it lists, under the right directory', () => {
    const tree = '# API\n\n```\nsrc/app/api/\n├── users/\n│   └── [id]/route.ts   # GET\n└── auth/\n    └── register/route.ts\n```\n';
    assert.deepEqual(dsy({ ...CODE, 'src/app/api/oauth/register/route.ts': 'export async function POST() {}\n' }, { 'API.md': tree }), [
      'DSY001 src/app/api/(admin)/audit/route.ts',
      'DSY001 src/app/api/deals/[dealId]/notes/route.ts',
      'DSY001 src/app/api/oauth/register/route.ts',
    ]);
  });

  it('every handler documented together leaves no finding', () => {
    assert.deepEqual(dsy(CODE, {
      'API.md': '# API\n\n| `GET` | `/api/users` |\n| `GET` | `/api/users/{id}` |\n| `GET` | `/api/audit` |\n\nNotes: `/api/deals/:dealId/notes`.\n',
    }), []);
  });

  it('the suggestion names the URL path; the message is unchanged', () => {
    const dir = makeDir({ ...CODE, 'docs-canonical/API.md': '# API\n\nNothing yet.\n' });
    const finding = validateDocsSync(dir, {}).findings.find(f => f.location === 'src/app/api/users/[id]/route.ts');
    assert.equal(finding.message, 'route src/app/api/users/[id]/route.ts not referenced in any canonical doc');
    assert.equal(finding.severity, 'warn');
    assert.match(finding.suggestion.text, /`\/api\/users\/:id`/);
  });
});

describe('Docs-Sync — a shared or directory name is qualified by its directory (FR-004, FR-005, FR-006, US3)', () => {
  const CODE = {
    'src/services/auth/index.ts': 'export * from "./OktaAuthService";\n',
    'src/services/auth/types.ts': 'export type User = {};\n',
    'src/services/billing/index.ts': 'export {};\n',
    'src/services/billing/types.ts': 'export type Invoice = {};\n',
    'src/routes/index.ts': 'export {};\n',
    'src/services/payments.ts': 'export {};\n',
  };
  const ALL = [
    'DSY001 src/routes/index.ts',
    'DSY002 src/services/auth/index.ts',
    'DSY002 src/services/auth/types.ts',
    'DSY002 src/services/billing/index.ts',
    'DSY002 src/services/billing/types.ts',
  ];
  const PAYMENTS = 'The payments service charges cards.\n';

  it('index, types, the directory name or a sibling path document none of them', () => {
    assert.deepEqual(dsy(CODE, {
      'ARCH.md': `# Arch\n\nThe message index, shared types, auth and billing. See services/auth/OktaAuthService.ts. ${PAYMENTS}`,
    }), ALL);
  });

  it('a unique module name still documents its file by the word (spec 077)', () => {
    assert.ok(!dsy(CODE, { 'ARCH.md': `# Arch\n\n${PAYMENTS}` }).includes('DSY002 src/services/payments.ts'));
    assert.ok(dsy(CODE, { 'ARCH.md': '# Arch\n\nNothing.\n' }).includes('DSY002 src/services/payments.ts'));
  });

  it('a shared name qualified by its directory documents exactly that file', () => {
    for (const text of ['auth/types', '`auth/types.ts`', 'src/services/auth/types.ts', 'from app.services.auth.types import User']) {
      assert.deepEqual(dsy(CODE, { 'ARCH.md': `# Arch\n\n${text}. ${PAYMENTS}` }),
        ALL.filter(f => f !== 'DSY002 src/services/auth/types.ts'), text);
    }
  });

  it('an index file is documented by dir/index or by its directory as a module path', () => {
    for (const text of ['auth/index', 'services/auth', '`src/services/auth/`', 'import app.services.auth']) {
      assert.deepEqual(dsy(CODE, { 'ARCH.md': `# Arch\n\n${text} ${PAYMENTS}` }),
        ALL.filter(f => f !== 'DSY002 src/services/auth/index.ts'), text);
    }
    for (const text of ['src/routes', '`routes/index.ts`']) {
      assert.deepEqual(dsy(CODE, { 'ARCH.md': `# Arch\n\n${text} mounts every router. ${PAYMENTS}` }),
        ALL.filter(f => f !== 'DSY001 src/routes/index.ts'), text);
    }
    assert.deepEqual(dsy(CODE, { 'ARCH.md': `# Arch\n\nThe routes mount every router. ${PAYMENTS}` }), ALL);
  });

  it('a drawn file tree documents an index file by its directory', () => {
    const tree = '```\nsrc/services/\n├── auth/\n│   ├── index.ts\n│   └── types.ts\n└── payments.ts\n```\n';
    assert.deepEqual(dsy(CODE, { 'ARCH.md': `# Arch\n\n${tree}` }),
      ALL.filter(f => !f.includes('services/auth/')));
  });

  it('a lone index file still needs its directory', () => {
    assert.deepEqual(dsy({ 'src/routes/users/index.ts': 'export {};\n' }, { 'A.md': '# A\n\nThe users index.\n' }),
      ['DSY001 src/routes/users/index.ts']);
    assert.deepEqual(dsy({ 'src/routes/users/index.ts': 'export {};\n' }, { 'A.md': '# A\n\nroutes/users mounts it.\n' }), []);
  });

  it('whether a name is shared does not depend on --changed-only scope', () => {
    const findings = dsy(CODE, { 'ARCH.md': `# Arch\n\nShared types. ${PAYMENTS}` }, { changedFiles: ['src/services/auth/types.ts'] });
    assert.deepEqual(findings, ['DSY002 src/services/auth/types.ts']);
  });

  it('the suggestion names the qualified name', () => {
    const dir = makeDir({ ...CODE, 'docs-canonical/ARCH.md': '# Arch\n\nNothing yet.\n' });
    const byLocation = Object.fromEntries(validateDocsSync(dir, {}).findings.map(f => [f.location, f]));
    assert.match(byLocation['src/services/auth/types.ts'].suggestion.text, /`auth\/types`/);
    assert.match(byLocation['src/services/auth/index.ts'].suggestion.text, /`services\/auth`/);
    assert.match(byLocation['src/services/payments.ts'].suggestion.text, /`payments`/);
  });
});

describe('documented, and DocGuard\'s own init (FR-007)', () => {
  it('DSY001 and DSY002 help and explain docsSync state the rules', () => {
    for (const code of ['DSY001', 'DSY002']) {
      assert.match(CODES[code].help, /HTML comment/, code);
      assert.match(CODES[code].help, /`auth\/types`/, code);
      assert.match(CODES[code].help, /`covers`/, code);
      assert.match(CODES[code].help, /file tree/, code);
    }
    assert.match(CODES.DSY001.help, /URL path/);
    const r = spawnSync(process.execPath, [CLI, 'explain', 'docsSync'], { encoding: 'utf-8' });
    assert.match(r.stdout, /HTML comment/);
    assert.match(r.stdout, /URL path/);
    assert.match(r.stdout, /file tree/);
  });

  // Without `specify` on PATH, init behaves the same on every machine.
  const PATH = (process.env.PATH || '').split(delimiter)
    .filter(d => d && !['specify', 'specify.exe', 'specify.cmd'].some(bin => existsSync(join(d, bin)))).join(delimiter);
  const flow = (project, steps) => {
    const dir = materialize(PROJECTS[project].files, { prefix: `docguard-dsy-${project}-` });
    temps.push(dir);
    for (const args of steps) {
      const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf-8', env: { ...process.env, PATH, NO_COLOR: '1' } });
      assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    }
    const r = spawnSync(process.execPath, [CLI, 'guard', '--format', 'json'], { cwd: dir, encoding: 'utf-8', env: { ...process.env, PATH, NO_COLOR: '1' } });
    return JSON.parse(r.stdout).findings.filter(f => f.code.startsWith('DSY00')).map(f => `${f.code} ${f.location}`).sort();
  };

  it('after a blank init, the Express route is not documented by placeholder comments', { timeout: 120_000 }, () => {
    assert.deepEqual(flow('express-js', [['init', '--skip-prompts']]), ['DSY001 src/routes/users.js']);
  });
  // init then generate --plan --write, and the plan alone, must report no DSY
  // finding on any stack: tests/generated-docs-e2e.test.mjs allows none there.
});

describe('this repository (SC-002)', () => {
  it('every code file a canonical doc names by its path stays documented under its identity', () => {
    // This repository has no route or service directory, so its own guard is
    // unchanged. As an oracle, its CLI sources become services of a scratch
    // project that keeps its canonical docs: shared names (`sync`, `index`)
    // must still be documented wherever a doc names the whole path.
    const root = resolve('.');
    const sources = listTrackedFiles(root).filter(f => /^cli\/.+\.mjs$/.test(f));
    const docs = listTrackedFiles(root).filter(f => /^docs-canonical\/.+\.md$/.test(f));
    const files = Object.fromEntries(docs.map(f => [f, readFileSync(join(root, f), 'utf8')]));
    for (const f of sources) files[`services/${f}`] = '';
    const visible = docs.map(f => visibleMarkdown(files[f])).join('\n');
    const named = sources.filter(f => namesToken(visible, f));
    const flagged = new Set(validateDocsSync(makeDir(files), {}).findings.map(f => f.location.replace(/^services\//, '')));
    assert.ok(named.length >= 100, `the oracle should find this repository's path mentions; found ${named.length}`);
    assert.deepEqual(named.filter(f => flagged.has(f)), []);
  });
});
