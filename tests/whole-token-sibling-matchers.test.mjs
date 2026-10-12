/**
 * Whole-token matching in the nudge hook, Docs-Sync and Diff-Suspicion
 * (specs/077-whole-token-sibling-matchers): a name inside a longer name is not
 * a reference, and every real way of naming the file still is.
 *
 * @req docguard.whole-token-sibling-matchers#FR-001
 * @req docguard.whole-token-sibling-matchers#FR-002
 * @req docguard.whole-token-sibling-matchers#FR-003
 * @req docguard.whole-token-sibling-matchers#FR-004
 * @req docguard.whole-token-sibling-matchers#FR-005
 * @req docguard.whole-token-sibling-matchers#FR-006
 * @req docguard.whole-token-sibling-matchers#SC-001
 * @req docguard.whole-token-sibling-matchers#SC-002
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, delimiter, extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AGENT_FILES, namesModule, namesToken } from '../cli/scanners/doc-references.mjs';
import { listCanonicalDocs } from '../cli/shared-ignore.mjs';
import { listTrackedFiles } from '../cli/shared-git.mjs';
import { validateDocsSync } from '../cli/validators/docs-sync.mjs';
import { validateDiffSuspicion } from '../cli/validators/diff-suspicion.mjs';
import { CODES } from '../cli/findings.mjs';
import { fixtureGit } from './helpers/git.mjs';
import { PROJECTS, materialize } from './fixtures/generated-docs-projects.mjs';

const CLI = resolve('cli/docguard.mjs');
const CONFIG = JSON.stringify({ projectName: 't', profile: 'starter', version: '0.5' });
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

function makeDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-sibling-'));
  temps.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

describe('namesModule — a module name matches only as a whole word (FR-002)', () => {
  it('rejects a module name inside a longer name', () => {
    for (const text of ['users', 'the user-service', 'superuser', 'user_id', 'userRoutes', 'user2',
      'user$', '$user', 'user+x', '@user', 'a-user']) {
      assert.equal(namesModule(text, 'user'), false, text);
    }
  });

  it('accepts every way a document names the module', () => {
    for (const text of ['user', 'src/routes/user.js', './src/routes/user.js', 'see user.js', '`user`',
      'call user.getById()', 'app.routes.user', 'GET /user/:id', '**user**', '| user |', 'the user route',
      'see user.', '(user)', '参见user文件', 'first line\nuser\nlast line']) {
      assert.equal(namesModule(text, 'user'), true, text);
    }
  });

  it('a period is an edge for a module name but continues a file name', () => {
    assert.equal(namesModule('jobLease.beginShutdown()', 'jobLease'), true);
    assert.equal(namesToken('jobLease.beginShutdown()', 'jobLease'), false);
  });

  it('escapes the module name', () => {
    assert.equal(namesModule('routes/users.$id.tsx', 'users.$id'), true);
    assert.equal(namesModule('routes/xusers.$id.tsx', 'users.$id'), false);
    assert.equal(namesModule('routes/blog/+server.ts', '+server'), true);
    assert.equal(namesModule('routes/blog/a+server.ts', '+server'), false);
  });
});

describe('nudge hook — only documents that name the edited file (FR-001, US1)', () => {
  // ARCHITECTURE.md and AGENTS.md name each file only inside a longer name.
  const LONGER = {
    '.docguard.json': CONFIG,
    'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nThe gateway is `src/hub.mjs`; compiler options live in tsconfig.json.\n',
    'AGENTS.md': '# Agents\n\nRun impact.test.mjs after edits.\n',
    'src/b.mjs': 'export const b = 1;\n',
    'src/config.js': 'export const config = {};\n',
    'src/test.mjs': 'export const t = 1;\n',
  };
  // The neighbouring valid case: GUIDE.md really names each file.
  const NAMED = {
    ...LONGER,
    'docs-canonical/GUIDE.md': '# Guide\n\nsrc/b.mjs exports b. Settings come from `config.js`; see [test.mjs](src/test.mjs).\n',
  };

  const nudge = (dir, file) => spawnSync('node', [CLI, 'nudge-hook', '--dir', dir], {
    encoding: 'utf-8',
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: join(dir, file) } }),
  });

  for (const file of ['src/b.mjs', 'src/config.js', 'src/test.mjs']) {
    it(`editing ${file} is silent when documents name it only inside a longer name`, () => {
      const r = nudge(makeDir(LONGER), file);
      assert.equal(r.status, 0);
      assert.equal(r.stdout.trim(), '', `expected no nudge; got ${r.stdout}`);
    });

    it(`editing ${file} nudges toward impact and lists only the document that names it`, () => {
      const r = nudge(makeDir(NAMED), file);
      const out = JSON.parse(r.stdout);
      assert.match(out.reason, /docguard impact/);
      assert.match(out.reason, /^DocGuard: GUIDE\.md references `/);
    });
  }
});

describe('Docs-Sync — a route or service is documented only by its whole name (FR-003, US2)', () => {
  const CODE = {
    'src/routes/user.js': 'export const getUser = () => {};\n',
    'src/services/auth.js': 'export const login = () => {};\n',
    'src/app/api/chat/route.ts': 'export async function GET() {}\n',
  };
  const dsy = docs => {
    const dir = makeDir({ ...CODE, ...Object.fromEntries(Object.entries(docs).map(([k, v]) => [`docs-canonical/${k}`, v])) });
    return validateDocsSync(dir, {}).findings.map(f => `${f.code} ${f.location}`).sort();
  };

  it('a name inside a longer identifier or file name does not document the file', () => {
    assert.deepEqual(dsy({
      'API.md': '# API\n\nusers, user-service, superuser, user_id and userRoutes are handled by API routes.\n',
      'SERVICES.md': '# Services\n\nauthentication goes through oauth.\n',
    }), [
      'DSY001 src/app/api/chat/route.ts',
      'DSY001 src/routes/user.js',
      'DSY002 src/services/auth.js',
    ]);
  });

  it('every whole-word form of the name documents the file', () => {
    for (const form of ['src/routes/user.js', './src/routes/user.js', 'user.js', '`user`', 'user.getById',
      'app.routes.user', '/user/:id', '**user**', '| user |', 'the user route']) {
      assert.deepEqual(dsy({
        'API.md': `# API\n\n${form}\n`,
        'SERVICES.md': '# Services\n\nThe `auth` service signs users in.\n',
        'NEXT.md': '# Next\n\nChat is served by src/app/api/chat/route.ts.\n',
      }), [], form);
    }
  });

  it('after a blank init, DSY001 asks for each Next.js route handler; --plan --write names them (FR-006)', () => {
    const dir = materialize(PROJECTS['next-ts'].files, { prefix: 'docguard-sibling-next-' });
    temps.push(dir);
    // Without `specify` on PATH, init behaves the same on every machine.
    const PATH = (process.env.PATH || '').split(delimiter)
      .filter(d => d && !['specify', 'specify.exe', 'specify.cmd'].some(bin => existsSync(join(d, bin)))).join(delimiter);
    const run = args => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf-8', env: { ...process.env, PATH, NO_COLOR: '1' } });
    const dsy = () => JSON.parse(run(['guard', '--format', 'json']).stdout).findings
      .filter(f => f.code.startsWith('DSY00')).map(f => `${f.code} ${f.location}`).sort();
    assert.equal(run(['init', '--skip-prompts']).status, 0);
    assert.deepEqual(dsy(), [
      'DSY001 src/app/api/health/route.ts',
      'DSY001 src/app/api/users/[id]/route.ts',
      'DSY001 src/app/api/users/route.ts',
    ]);
    assert.equal(run(['generate', '--plan', '--write']).status, 0);
    assert.deepEqual(dsy(), []);
  });
});

describe('Diff-Suspicion — a path reference is the whole path (FR-004, US3)', () => {
  const dir = makeDir({
    'src/a.mjs': 'export function legacyHandshake() {}\nexport function computeLedger() {}\n',
    'docs-canonical/OTHER.md': '# Other\n\n`othersrc/a.mjs` calls legacyHandshake, then computeLedger.\n',
    'docs-canonical/PATH.md': '# Path\n\nsrc/a.mjs calls legacyHandshake, then computeLedger.\n',
    'docs-canonical/TICKED.md': '# Ticked\n\n`src/a.mjs` calls legacyHandshake, then computeLedger.\n',
    'docs-canonical/NESTED.md': '# Nested\n\nlib/src/a.mjs calls legacyHandshake, then computeLedger.\n',
    'docs-canonical/LINE.md': '# Line\n\nsrc/a.mjs:12 calls legacyHandshake, then computeLedger.\n',
    'docs-canonical/MODULE.md': '# Module\n\nThe `a` module calls legacyHandshake, then computeLedger.\n',
  });
  fixtureGit(dir, ['init', '-q', '-b', 'main']);
  const commit = msg => {
    fixtureGit(dir, ['add', '-A']);
    fixtureGit(dir, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg]);
  };
  commit('initial');
  writeFileSync(join(dir, 'src/a.mjs'), 'export function handshake() {}\n');
  commit('drop the legacy handshake and the ledger');

  const kinds = () => Object.fromEntries(validateDiffSuspicion(dir, { changedSinceRef: 'HEAD~1' }).findings
    .filter(f => f.code === 'DSP001')
    .map(f => [f.location.replace('docs-canonical/', ''), f.message.match(/\((\w+) ref\)/)[1]]));

  it('a document that names only a longer path is not paired with the file', () => {
    assert.equal(kinds()['OTHER.md'], undefined);
  });

  it('the whole path, in any wrapper or after a directory, is a path reference; the backticked module is a module reference', () => {
    assert.deepEqual(kinds(), { 'PATH.md': 'path', 'TICKED.md': 'path', 'NESTED.md': 'path', 'LINE.md': 'path', 'MODULE.md': 'module' });
  });
});

describe('this repository (SC-002)', () => {
  const root = resolve('.');
  const code = (listTrackedFiles(root) || []).filter(f => /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift)$/.test(f));
  const canonical = listCanonicalDocs(root).map(d => readFileSync(d.abs, 'utf8'));
  const agents = AGENT_FILES.filter(f => existsSync(resolve(f))).map(f => readFileSync(resolve(f), 'utf8'));
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Independent, narrower oracles: the name between the delimiters prose and
  // Markdown use most. Whatever they find must still match.
  it('every file a document names by its basename still nudges', () => {
    let named = 0;
    const lost = [];
    for (const file of code) {
      const base = basename(file);
      const oracle = new RegExp(`(?:^|[\\s\x60(\\[/*|])${esc(base)}(?=$|[\\s\x60)\\]:#,*|]|\\.(?:\\s|$))`, 'm');
      for (const doc of [...canonical, ...agents]) {
        if (!doc.includes(base) || !oracle.test(doc)) continue;
        named++;
        if (!namesToken(doc, base)) lost.push(file);
      }
    }
    assert.ok(named >= 100, `the oracle should find this repository's basename mentions; found ${named}`);
    assert.deepEqual(lost, []);
  });

  it('every module name a canonical document writes as a word, a path segment or module.member still documents the file', () => {
    const content = canonical.join('\n');
    let named = 0;
    const lost = [];
    for (const file of code) {
      const stem = basename(file, extname(file));
      const oracle = new RegExp(`(?:^|[\\s\x60(\\[/.])${esc(stem)}(?=$|[\\s\x60)\\]:#,.(])`, 'm');
      if (!content.includes(stem) || !oracle.test(content)) continue;
      named++;
      if (!namesModule(content, stem)) lost.push(file);
    }
    assert.ok(named >= 100, `the oracle should find this repository's module mentions; found ${named}`);
    assert.deepEqual(lost, []);
  });
});

describe('documented (FR-005)', () => {
  it('DSY001 and DSY002 help says the name must appear as a whole name', () => {
    for (const code of ['DSY001', 'DSY002']) {
      assert.match(CODES[code].help, /as a whole name/, code);
      assert.match(CODES[code].help, /`users` or `user-service` does not document `user`/, code);
    }
  });

  it('explain docsSync states the whole-name rule', () => {
    const r = spawnSync('node', [CLI, 'explain', 'docsSync'], { encoding: 'utf-8' });
    assert.match(r.stdout, /as a whole name/);
  });

  it('the agent reference says the code nudge needs a whole file name', () => {
    assert.match(readFileSync(resolve('docs/reference/agents.md'), 'utf8'),
      /names it as a whole file name: `config\.js` is not\s+named by `tsconfig\.json`/);
  });
});
