/**
 * @req docguard.mcp-project-confinement#FR-001
 * @req docguard.mcp-project-confinement#FR-002
 * @req docguard.mcp-project-confinement#FR-003
 * @req docguard.mcp-project-confinement#FR-004
 * @req docguard.mcp-project-confinement#FR-005
 * @req docguard.mcp-project-confinement#FR-006
 * @req docguard.mcp-project-confinement#FR-007
 * @req docguard.mcp-project-confinement#SC-001
 * @req docguard.mcp-project-confinement#SC-002
 * @req docguard.mcp-project-confinement#SC-003
 * A tool call's projectDir must stay inside the directories the MCP server
 * was started to serve. Every fixture is a temp tree; the server is the real
 * CLI over stdio and HTTP.
 */
import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isWithinRoot } from '../cli/commands/mcp.mjs';
import { notesSince } from './fixtures/changelog-notes.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(REPO, 'cli', 'docguard.mjs');
const SECRET = 'OUTSIDE-SECRET-7f3a';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

/** parent/{outside.md, app/{…, pkg/, link-out → parent, link-in → pkg}, app-other/} */
function tree() {
  const parent = mkdtempSync(join(tmpdir(), 'docguard-confine-'));
  dirs.push(parent);
  const app = join(parent, 'app');
  const write = (rel, text) => { mkdirSync(join(parent, rel, '..'), { recursive: true }); writeFileSync(join(parent, rel), text); };
  write('outside.md', `# Outside\n\n${SECRET}\n`);
  write('app-other/outside.md', `# Other\n\n${SECRET}\n`);
  write('app/.docguard.json', JSON.stringify({ projectName: 'app', profile: 'starter' }));
  write('app/README.md', '# App\n\nAPP-LINE\n');
  write('app/notes.txt', 'a file, not a directory\n');
  write('app/pkg/README.md', '# Pkg\n\nPKG-LINE\n');
  write('app/..hidden/README.md', '# Dots\n\nDOTS-LINE\n');
  symlinkSync(parent, join(app, 'link-out'), 'dir');
  symlinkSync(join(app, 'pkg'), join(app, 'link-in'), 'dir');
  return { parent, app };
}

const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });

/** Run `docguard mcp` over stdio with the given argv and requests; responses by id. */
function stdio(cwd, argv, messages) {
  const r = spawnSync(process.execPath, [CLI, 'mcp', ...argv], {
    cwd, input: `${messages.map((m) => JSON.stringify(m)).join('\n')}\n`, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' },
  });
  const byId = new Map(r.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((m) => [m.id, m]));
  return { byId, stderr: r.stderr, status: r.status };
}
const text = (m) => m.result.content[0].text;

const readOutside = (projectDir) => call(1, 'docguard_read_section', { doc: 'outside.md', line: 3, projectDir });

describe('reproduction: a doc tool reads a file outside the served project (SC-001)', () => {
  it('stdio refuses the parent directory and returns none of its text', () => {
    const { parent, app } = tree();
    const { byId } = stdio(app, [], [readOutside(parent)]);
    const res = byId.get(1).result;
    assert.equal(res.isError, true, `expected a refusal, got: ${text(byId.get(1))}`);
    assert.doesNotMatch(text(byId.get(1)), new RegExp(SECRET));
    assert.match(text(byId.get(1)), /outside the directories this server serves/);
    assert.ok(text(byId.get(1)).includes(realpathSync.native(app)), 'the refusal names the served root');
    assert.match(text(byId.get(1)), /--root <dir>/);
  });

  it('HTTP with its defaults refuses the same call (FR-003)', async () => {
    const { parent, app } = tree();
    const proc = spawn(process.execPath, [CLI, 'mcp', '--transport', 'http', '--port', '0', '--dir', app], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const base = await new Promise((ok, fail) => {
        let buf = '';
        const t = setTimeout(() => fail(new Error(`server did not start: ${buf}`)), 15000);
        proc.stderr.on('data', (c) => {
          buf += c;
          const m = buf.match(/http:\/\/127\.0\.0\.1:(\d+)(\/\S*)/);
          if (m) { clearTimeout(t); ok(`http://127.0.0.1:${m[1]}${m[2]}`); }
        });
        proc.on('exit', (code) => fail(new Error(`server exited (${code}): ${buf}`)));
      });
      const post = async (msg) => (await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(msg) })).json();
      const refused = await post(readOutside(parent));
      assert.equal(refused.result.isError, true);
      assert.doesNotMatch(refused.result.content[0].text, new RegExp(SECRET));
      const inside = await post(call(2, 'docguard_read_section', { doc: 'README.md', line: 3, projectDir: join(app, 'pkg') }));
      assert.equal(inside.result.isError, undefined);
      assert.match(inside.result.content[0].text, /PKG-LINE/);
    } finally { proc.kill(); }
  });
});

describe('every escape is refused the same way, before any file is read (FR-001, FR-002, FR-003)', () => {
  it('parent, .., symlink out, prefix sibling and missing outside paths get one message', () => {
    const { parent, app } = tree();
    const attempts = ['../', 'pkg/../..', join(app, 'link-out'), 'link-out', join(parent, 'app-other'), '../app-other', join(parent, 'nope'), 'link-out/nope', '../nope'];
    const { byId } = stdio(app, [], attempts.map((p, i) => call(i + 1, 'docguard_read_section', { doc: 'outside.md', line: 3, projectDir: p })));
    const messages = attempts.map((p, i) => {
      const m = byId.get(i + 1);
      assert.equal(m.result.isError, true, `${p} must be refused: ${text(m)}`);
      assert.doesNotMatch(text(m), new RegExp(SECRET), p);
      return text(m);
    });
    assert.equal(new Set(messages).size, 1, `a missing outside path must be indistinguishable from an existing one:\n${messages.join('\n')}`);
  });

  it('every tool that takes projectDir is confined, not only the doc tools', () => {
    const { parent, app } = tree();
    const tools = {
      docguard_guard: {}, docguard_score: {}, docguard_verify_evidence: {}, docguard_verify_claims: {}, docguard_report: {}, docguard_diagnose: {},
      docguard_docs_for_path: { path: 'outside.md' }, docguard_doc_structure: { doc: 'outside.md' },
      docguard_read_section: { doc: 'outside.md', line: 1 }, docguard_task_context: { task: 'read outside.md' },
    };
    const names = Object.keys(tools);
    const { byId } = stdio(app, [], names.map((n, i) => call(i + 1, n, { ...tools[n], projectDir: parent })));
    names.forEach((n, i) => {
      assert.equal(byId.get(i + 1).result.isError, true, `${n} must refuse`);
      assert.match(text(byId.get(i + 1)), /outside the directories this server serves/, n);
    });
  });
});

describe('calls inside the served project keep working (FR-004, SC-003)', () => {
  it('no projectDir, relative, absolute, symlink-in and cased spellings run', () => {
    const { parent, app } = tree();
    const cased = join(parent, 'APP', 'PKG');
    const caseInsensitive = existsSync(cased);
    const inside = ['pkg', './pkg', join(app, 'pkg'), 'link-in', join(app, 'link-in'), realpathSync.native(join(app, 'pkg')), '..hidden', ...(caseInsensitive ? [cased] : [])];
    const { byId } = stdio(app, [], [
      call(1, 'docguard_read_section', { doc: 'README.md', line: 3 }),
      ...inside.map((p, i) => call(10 + i, 'docguard_read_section', { doc: 'README.md', line: 3, projectDir: p })),
    ]);
    assert.match(text(byId.get(1)), /APP-LINE/, 'no projectDir serves the served directory');
    inside.forEach((p, i) => {
      const m = byId.get(10 + i);
      assert.equal(m.result.isError, undefined, `${p}: ${text(m)}`);
      assert.match(text(m), p === '..hidden' ? /DOTS-LINE/ : /PKG-LINE/, p);
    });
  });

  it('the same project gives the same answer however it is named (SC-003)', () => {
    const { parent, app } = tree();
    const spellings = [undefined, '.', app, realpathSync.native(app), join(app, 'pkg', '..'), join('..', 'app')];
    if (existsSync(join(parent, 'APP'))) spellings.push(join(parent, 'APP'));
    const reqs = [];
    spellings.forEach((p, i) => {
      const args = p === undefined ? {} : { projectDir: p };
      reqs.push(call(100 + i, 'docguard_doc_structure', { doc: 'README.md', ...args }));
      reqs.push(call(200 + i, 'docguard_score', args));
    });
    const { byId } = stdio(app, [], reqs);
    for (const base of [100, 200]) {
      const answers = spellings.map((_, i) => text(byId.get(base + i)));
      answers.forEach((a, i) => assert.equal(byId.get(base + i).result.isError, undefined, `${spellings[i]}: ${a}`));
      assert.equal(new Set(answers).size, 1, `tool ${base}: every spelling must answer identically`);
    }
  });

  it('relative projectDir resolves against the served directory, not the process directory', () => {
    const { parent, app } = tree();
    const { byId } = stdio(parent, ['--dir', app], [call(1, 'docguard_read_section', { doc: 'README.md', line: 3, projectDir: 'pkg' })]);
    assert.equal(byId.get(1).result.isError, undefined, text(byId.get(1)));
    assert.match(text(byId.get(1)), /PKG-LINE/);
  });

  it('a missing inside directory keeps "does not exist"; a file is not a directory', () => {
    const { app } = tree();
    const { byId } = stdio(app, [], [
      call(1, 'docguard_score', { projectDir: 'missing' }),
      call(2, 'docguard_score', { projectDir: 'notes.txt' }),
    ]);
    assert.equal(byId.get(1).result.isError, true);
    assert.match(text(byId.get(1)), /projectDir does not exist: .*missing/);
    assert.equal(byId.get(2).result.isError, true);
    assert.match(text(byId.get(2)), /projectDir is not a directory: .*notes\.txt/);
  });
});

describe('--root widens the boundary explicitly (FR-005, SC-002)', () => {
  it('--root <parent> lets the reproduction through, and the startup line names both roots', () => {
    const { parent, app } = tree();
    const { byId, stderr } = stdio(app, ['--root', parent], [readOutside(parent), readOutside(join(parent, 'app-other'))]);
    assert.equal(byId.get(1).result.isError, undefined, text(byId.get(1)));
    assert.match(text(byId.get(1)), new RegExp(SECRET));
    assert.ok(stderr.includes(realpathSync.native(parent)), stderr);
    assert.ok(stderr.includes(realpathSync.native(app)), stderr);
  });

  it('a missing or file --root stops the server at startup', () => {
    const { parent, app } = tree();
    for (const bad of [join(parent, 'nope'), join(app, 'notes.txt')]) {
      const r = spawnSync(process.execPath, [CLI, 'mcp', '--root', bad], { cwd: app, input: '', encoding: 'utf8' });
      assert.equal(r.status, 1, `${bad}: ${r.stderr}`);
      assert.match(r.stderr, /--root/);
      assert.equal(r.stdout, '', 'nothing reaches the transport');
    }
  });
});

describe('tools/list states the boundary (FR-006)', () => {
  it('every projectDir description says it must be inside the served directories', () => {
    const { app } = tree();
    const { byId } = stdio(app, [], [{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
    const withDir = byId.get(1).result.tools.filter((t) => t.inputSchema.properties.projectDir);
    assert.equal(withDir.length, 10);
    for (const t of withDir) {
      assert.match(t.inputSchema.properties.projectDir.description, /inside the directories this server serves/, t.name);
      assert.match(t.inputSchema.properties.projectDir.description, /relative to the served directory/, t.name);
    }
  });
});

describe('isWithinRoot: one containment rule on every platform', () => {
  it('POSIX: the root, descendants and dot-named children are inside; parents, siblings and case variants are not', () => {
    assert.equal(isWithinRoot('/x/app', '/x/app', posix), true);
    assert.equal(isWithinRoot('/x/app', '/x/app/pkg', posix), true);
    assert.equal(isWithinRoot('/x/app', '/x/app/..hidden', posix), true);
    assert.equal(isWithinRoot('/x/app', '/x', posix), false);
    assert.equal(isWithinRoot('/x/app', '/x/app-other', posix), false);
    assert.equal(isWithinRoot('/x/app', '/x/app/../other', posix), false);
    assert.equal(isWithinRoot('/x/app', '/X/app/pkg', posix), false);
    assert.equal(isWithinRoot('/', '/anything', posix), true);
  });

  it('Windows: case-insensitive; another drive or UNC share is outside', () => {
    assert.equal(isWithinRoot('C:\\work\\app', 'C:\\work\\app\\pkg', win32), true);
    assert.equal(isWithinRoot('C:\\work\\app', 'c:\\WORK\\App\\pkg', win32), true);
    assert.equal(isWithinRoot('C:\\work\\app', 'C:\\work\\app-other', win32), false);
    assert.equal(isWithinRoot('C:\\work\\app', 'C:\\work', win32), false);
    assert.equal(isWithinRoot('C:\\work\\app', 'D:\\work\\app', win32), false);
    assert.equal(isWithinRoot('C:\\work\\app', '\\\\server\\share\\app', win32), false);
    assert.equal(isWithinRoot('\\\\server\\share\\app', '\\\\server\\share\\app\\x', win32), true);
  });
});

describe('the docs describe the boundary and --root (FR-007)', () => {
  const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
  it('SECURITY, ai-integration, commands, README, MCPB, Smithery and CHANGELOG name it', () => {
    const security = read('docs-canonical/SECURITY.md');
    assert.match(security, /projectDir/);
    assert.match(security, /--root/);
    assert.doesNotMatch(security, /can cause the server to inspect project directories available to its process/);
    for (const rel of ['docs/ai-integration.md', 'docs/commands.md', 'README.md', 'mcpb/manifest.template.json', 'smithery.yaml']) {
      assert.match(read(rel), /--root/, rel);
    }
    const unreleased = notesSince(read('CHANGELOG.md'), '0.42.1');
    assert.match(unreleased, /projectDir/);
    assert.match(unreleased, /--root/);
  });
});
