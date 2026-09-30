/**
 * Path-scoped agent rules (specs/033-path-scoped-rules): dead scopes, broken
 * pointers, per-path size and unreadable scopes across five harnesses, and
 * `rules --for`.
 *
 * @req docguard.path-scoped-rules#FR-001
 * @req docguard.path-scoped-rules#FR-002
 * @req docguard.path-scoped-rules#FR-003
 * @req docguard.path-scoped-rules#FR-004
 * @req docguard.path-scoped-rules#FR-005
 * @req docguard.path-scoped-rules#FR-006
 * @req docguard.path-scoped-rules#FR-007
 * @req docguard.path-scoped-rules#FR-008
 * @req docguard.path-scoped-rules#FR-009
 * @req docguard.path-scoped-rules#FR-010
 * @req docguard.path-scoped-rules#SC-001
 * @req docguard.path-scoped-rules#SC-002
 * @req docguard.path-scoped-rules#SC-003
 * @req docguard.path-scoped-rules#SC-004
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { readFrontmatter } from '../cli/scanners/frontmatter.mjs';
import { compileScopePattern, instructionKind, safeProjectPath } from '../cli/scanners/instruction-scopes.mjs';
import { extractInstructionPointers } from '../cli/scanners/instruction-audit.mjs';
import { validatePathScopedRules } from '../cli/validators/path-scoped-rules.mjs';
import { rulesFor } from '../cli/commands/rules.mjs';

const CLI = resolve('cli/docguard.mjs');

function write(dir, path, body) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), body);
}

function project(t, files, { git = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-psr-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) write(dir, path, body);
  if (git) {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
  }
  return dir;
}

const BIG = `${'Keep handlers small and name every exported function. '.repeat(700)}\n`;

/** One rule file per harness, every PSR code seeded, plus live rules. */
const FIVE_HARNESSES = {
  'src/api/users.ts': 'export const users = 1;\n',
  'src/web/app.tsx': 'export const app = 1;\n',
  'src/web/a.tsx': 'export const a = 1;\n',
  'lib/util.py': 'X = 1\n',
  'docs/guide.md': '# Guide\n',
  'AGENTS.md': '# Agents\n\n| Working on | Read |\n|---|---|\n| APIs | `docs/guide.md` |\n| Billing | `docs/missing.md` |\n',
  'src/api/AGENTS.md': '# API\n\nKeep handlers small.\n',
  'CLAUDE.md': '# Claude\n\nFollow AGENTS.md.\n',
  '.claude/rules/api.md': '---\npaths:\n  - "src/api/**"\n---\nAPI rules.\n',
  '.claude/rules/dead.md': '---\npaths: "old/**"\n---\nOld rules.\n',
  '.claude/rules/general.md': 'Always-on rules.\n',
  '.claude/rules/foreign.md': '---\nglobs: "src/**"\n---\nMeant for src.\n',
  '.claude/rules/big.md': `---\npaths: "src/web/**"\n---\n${BIG}`,
  '.cursor/rules/web.mdc': '---\ndescription: Web\nglobs: src/web/**, gone/**\n---\nWeb rules.\n',
  '.cursor/rules/always.mdc': '---\nalwaysApply: true\n---\nAlways.\n',
  '.cursor/rules/broken.mdc': '---\nglobs: **/*\n---\nBroken.\n',
  '.cursor/rules/classes.mdc': '---\nglobs: "src/[ab]*.ts"\n---\nClasses.\n',
  '.cursor/rules/notes.md': 'Cursor ignores this.\n',
  '.github/copilot-instructions.md': 'Repo-wide.\n',
  '.github/instructions/py.instructions.md': '---\napplyTo: "**/*.py"\n---\nPython.\n',
  '.github/instructions/dead.instructions.md': '---\napplyTo: "legacy/**"\n---\nLegacy.\n',
  '.agents/skills/lint/SKILL.md': '---\nname: lint\ndescription: Lint TypeScript\npaths: ["*.ts"]\n---\nRun `scripts/run.sh`, then `scripts/missing.sh`. Read `docs/guide.md` if present. Write the report to `reports/lint.md`.\n',
  '.agents/skills/lint/scripts/run.sh': 'echo lint\n',
  'tests/fixtures/app/AGENTS.md': 'See `nowhere/at-all.md`.\n',
};

const fileOf = f => String(f.location).replace(/:\d+$/, '');
const codes = result => result.findings.map(f => `${f.code}:${f.confidence}:${fileOf(f)}`).sort();

describe('the frontmatter subset reader (FR-001)', () => {
  it('reads scalars, quoted strings, booleans, flow and block lists, and folded descriptions', () => {
    const r = readFrontmatter('---\na: plain\nb: "q, x"\nc: true\nd: [x, "y"]\ne:\n  - one\n  - "two"\nf: long\n  text here\n---\nbody');
    assert.deepEqual(r.data, { a: 'plain', b: 'q, x', c: true, d: ['x', 'y'], e: ['one', 'two'], f: 'long text here' });
    assert.deepEqual(r.issues, []);
    assert.equal(r.bodyStart, 11);
  });

  it('reports what it will not guess: an unquoted *, a nested mapping, an unclosed block', () => {
    assert.match(readFrontmatter('---\nglobs: **/*\n---\n').issues[0].fix, /quote it: "\*\*\/\*"/);
    assert.equal(readFrontmatter('---\nmeta:\n  a: b\n---\n').issues[0].key, 'meta');
    assert.match(readFrontmatter('---\nname: x\n').issues[0].message, /never closes/);
    assert.equal(readFrontmatter('no frontmatter').present, false);
  });
});

describe('scope patterns (FR-002, FR-008)', () => {
  it('uses the shared matcher and refuses what it cannot represent', () => {
    assert.equal(compileScopePattern('src/**').test('src/a/b.ts'), true);
    assert.equal(compileScopePattern('*.md').test('docs/a.md'), false, 'Claude/Copilot: a slashless pattern is root-only');
    assert.equal(compileScopePattern('*.md', 'basename').test('docs/a.md'), true, 'OpenHands: it matches the name at any depth');
    assert.equal(compileScopePattern('src/').test('src/x.ts'), true);
    for (const bad of ['!src/**', 'src/[ab].ts', 'src/{a,{b,c}}.ts', '']) assert.equal(compileScopePattern(bad).ok, false, bad);
  });

  it('classifies each harness location', () => {
    assert.equal(instructionKind('.claude/rules/x/y.md'), 'claude-rule');
    assert.equal(instructionKind('pkg/.cursor/rules/a.mdc'), 'cursor-rule');
    assert.equal(instructionKind('.cursor/rules/a.md'), 'cursor-ignored');
    assert.equal(instructionKind('.github/instructions/a/b.instructions.md'), 'copilot-rule');
    assert.equal(instructionKind('.openhands/microagents/repo.md'), 'openhands-legacy');
    assert.equal(instructionKind('src/api/AGENTS.override.md'), 'agents');
    assert.equal(instructionKind('src/api/README.md'), null);
  });
});

describe('pointers (FR-003 PSR002)', () => {
  it('reads table rows and links; skips fences, comments, URLs, patterns, placeholders and conditionals', () => {
    const got = extractInstructionPointers([
      '| Area | Read `docs/a.md` |',
      '```', '`docs/fenced.md`', '```',
      '<!-- `docs/hidden.md` -->',
      'See [b](docs/b.md#part), [site](https://x.dev/c.md) and [top](#x).',
      'Globs like `src/**/*.ts` and `FEATURE_DIR/spec.md` are not files.',
      'Check if `.specify/extensions.yml` exists.',
    ].join('\n'));
    assert.deepEqual(got.map(p => p.path), ['docs/a.md', 'docs/b.md']);
  });
});

describe('the validator on five harnesses (SC-001)', () => {
  it('fires each code exactly where seeded, and nowhere else', t => {
    const dir = project(t, FIVE_HARNESSES);
    const result = validatePathScopedRules(dir, {});
    assert.deepEqual(codes(result), [
      'PSR001:high:.claude/rules/dead.md',
      'PSR001:high:.github/instructions/dead.instructions.md',
      'PSR001:low:.cursor/rules/web.mdc',
      'PSR002:high:.agents/skills/lint/SKILL.md',
      'PSR002:high:AGENTS.md',
      'PSR003:high:.claude/rules/big.md',
      'PSR004:high:.claude/rules/foreign.md',
      'PSR004:high:.cursor/rules/broken.mdc',
      'PSR004:high:.cursor/rules/notes.md',
    ]);
    assert.ok(result.findings.every(f => f.severity === 'warn'));
    // A pattern valid for Cursor that DocGuard does not evaluate is a
    // coverage gap, not a defect in the rule.
    assert.equal(result.applicability.status, 'partial');
    assert.match(result.applicability.reason, /\.cursor\/rules\/classes\.mdc: scope not checked, "src\/\[ab\]\*\.ts" \(character classes/);
    const msg = code => result.findings.filter(f => f.code === code).map(f => f.message).join('\n');
    assert.match(msg('PSR001'), /"gone\/\*\*" matches no tracked file; the other patterns still do/);
    assert.match(msg('PSR002'), /AGENTS\.md:6 points at docs\/missing\.md/);
    assert.match(msg('PSR002'), /SKILL\.md:\d+ points at scripts\/missing\.sh/);
    assert.match(msg('PSR003'), /Claude Code loads \d+ bytes of instructions for src\/web\/a\.tsx and 1 other paths/);
    assert.doesNotMatch(msg('PSR002'), /reports\/lint\.md/, 'a skill\'s runtime paths are not pointers');
    assert.match(msg('PSR004'), /Claude Code reads `paths:`, not `globs:`, so it ignores this scope and loads it for every file/);
    assert.match(msg('PSR004'), /Cursor ignores \.md files in \.cursor\/rules/);
    assert.ok(result.findings.every(f => !fileOf(f).startsWith('tests/')), 'fixture instructions are test data');
  });

  it('a glob that only matches a file deleted from the working tree is dead', t => {
    const dir = project(t, { 'src/a.ts': '', 'old/gone.ts': '', '.claude/rules/old.md': '---\npaths: "old/**"\n---\nx\n' });
    rmSync(join(dir, 'old/gone.ts'));
    assert.deepEqual(codes(validatePathScopedRules(dir, {})), ['PSR001:high:.claude/rules/old.md']);
  });

  it('an allowance for any path in the group replaces the budget (FR-004)', t => {
    const dir = project(t, FIVE_HARNESSES);
    const allowed = validatePathScopedRules(dir, { agentInstructions: { allowances: { 'claude:src/web/app.tsx': 60000 } } });
    assert.ok(!allowed.findings.some(f => f.code === 'PSR003'));
  });

  it('nested AGENTS.md chains are STR004\'s, not PSR003\'s', t => {
    const dir = project(t, { 'src/a.ts': '', 'AGENTS.md': BIG, 'src/AGENTS.md': BIG });
    assert.ok(!validatePathScopedRules(dir, {}).findings.some(f => f.code === 'PSR003'));
  });

  it('a gitignored pointer is a machine-local file, not a broken one', t => {
    const dir = project(t, { '.gitignore': '.notes/\n', 'AGENTS.md': 'When working here, read `.notes/today.md`.\n', 'src/a.ts': '' });
    assert.equal(validatePathScopedRules(dir, {}).findings.length, 0);
  });

  it('without git, checks the working tree and says so', t => {
    const dir = project(t, FIVE_HARNESSES, { git: false });
    const result = validatePathScopedRules(dir, {});
    assert.equal(result.applicability.status, 'partial');
    assert.match(result.applicability.reason, /git unavailable/);
  });

  it('a project without instruction files is not applicable and unchanged (FR-007, SC-004)', t => {
    const dir = project(t, { 'src/a.ts': '', 'README.md': '# x\n' });
    const result = validatePathScopedRules(dir, {});
    assert.equal(result.applicable, false);
    assert.equal(result.findings.length, 0);
  });
});

describe('rules --for (User Story 3, SC-002)', () => {
  const table = [
    // path, harness, files in load order
    ['src/api/users.ts', 'codex', ['AGENTS.md', 'src/api/AGENTS.md']],
    ['src/api/users.ts', 'claude', ['CLAUDE.md', '.claude/rules/foreign.md', '.claude/rules/general.md', '.claude/rules/api.md']],
    ['src/api/users.ts', 'cursor', ['AGENTS.md', 'src/api/AGENTS.md', '.cursor/rules/always.mdc', '.cursor/rules/broken.mdc', '.cursor/rules/classes.mdc']],
    ['src/api/users.ts', 'copilot', ['.github/copilot-instructions.md', 'src/api/AGENTS.md']],
    ['src/api/users.ts', 'openhands', ['AGENTS.md', 'CLAUDE.md', '.agents/skills/lint/SKILL.md']],
    ['src/web/app.tsx', 'claude', ['CLAUDE.md', '.claude/rules/foreign.md', '.claude/rules/general.md', '.claude/rules/big.md']],
    ['src/web/app.tsx', 'cursor', ['AGENTS.md', '.cursor/rules/always.mdc', '.cursor/rules/web.mdc', '.cursor/rules/broken.mdc', '.cursor/rules/classes.mdc']],
    ['lib/util.py', 'copilot', ['.github/copilot-instructions.md', 'AGENTS.md', '.github/instructions/py.instructions.md']],
    ['new/dir/not-yet.ts', 'openhands', ['AGENTS.md', 'CLAUDE.md', '.agents/skills/lint/SKILL.md']],
    ['docs/guide.md', 'codex', ['AGENTS.md']],
  ];

  it('matches a hand-written table for ten paths across all five harnesses', t => {
    const dir = project(t, FIVE_HARNESSES);
    for (const [path, harness, files] of table) {
      const got = rulesFor(dir, path, { harness }).harnesses[harness].files.map(f => f.file);
      assert.deepEqual(got, files, `${harness} ${path}`);
    }
  });

  it('gives the reason, bytes and total, and lists what is not path-scoped', t => {
    const dir = project(t, FIVE_HARNESSES);
    const report = rulesFor(dir, 'src/api/users.ts');
    const claude = report.harnesses.claude;
    assert.deepEqual(claude.files.map(f => f.reason), ['directory: project root', 'always', 'always', 'paths: src/api/**']);
    assert.equal(claude.totalBytes, claude.files.reduce((n, f) => n + f.bytes, 0));
    const cursorReasons = report.harnesses.cursor.files.map(f => f.reason);
    assert.ok(cursorReasons.includes('unknown scope (see PSR004)'));
    assert.ok(cursorReasons.includes('unknown scope (pattern DocGuard does not evaluate)'));
  });

  it('marks a git-ignored rule local and lists it', t => {
    const dir = project(t, { ...FIVE_HARNESSES, '.gitignore': '.claude/rules/mine.md\n' });
    write(dir, '.claude/rules/mine.md', 'My own rules.\n');
    const mine = rulesFor(dir, 'src/api/users.ts', { harness: 'claude' }).harnesses.claude.files.find(f => f.file === '.claude/rules/mine.md');
    assert.equal(mine.local, true);
    assert.ok(!validatePathScopedRules(dir, {}).findings.some(f => fileOf(f) === '.claude/rules/mine.md'), 'guard checks tracked files only');
  });

  it('refuses absolute paths, .., and symlinks that leave the project (FR-006)', t => {
    const dir = project(t, { 'src/a.ts': '' });
    const outside = mkdtempSync(join(tmpdir(), 'docguard-psr-out-'));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    symlinkSync(outside, join(dir, 'escape'));
    assert.equal(safeProjectPath(dir, '/etc/passwd'), null);
    assert.equal(safeProjectPath(dir, '../x'), null);
    assert.equal(safeProjectPath(dir, 'src/../../x'), null);
    assert.equal(safeProjectPath(dir, 'escape/file.ts'), null);
    assert.equal(safeProjectPath(dir, './src/new.ts'), 'src/new.ts');
    assert.throws(() => rulesFor(dir, '../x'), /inside the project/);
    assert.throws(() => rulesFor(dir, 'src/a.ts', { harness: 'vim' }), /--harness must be one of/);
  });

  it('the CLI prints JSON and exits 1 on a refused path', t => {
    const dir = project(t, FIVE_HARNESSES);
    const ok = spawnSync(process.execPath, [CLI, 'rules', '--for', 'lib/util.py', '--harness', 'copilot', '--format', 'json', '--dir', dir], { encoding: 'utf8' });
    const report = JSON.parse(ok.stdout.slice(ok.stdout.indexOf('{')));
    assert.deepEqual(Object.keys(report.harnesses), ['copilot']);
    const bad = spawnSync(process.execPath, [CLI, 'rules', '--for', '/etc/passwd', '--dir', dir], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
  });
});

describe('what DocGuard itself writes and documents (FR-009, FR-010, SC-003)', () => {
  it('docguard agents writes a Cursor rule whose glob parses', t => {
    const dir = project(t, { 'AGENTS.md': '# Agents\n\nRules.\n', '.docguard.json': '{"projectName":"x"}\n' });
    spawnSync(process.execPath, [CLI, 'agents', '--agent', 'cursor', '--dir', dir], { encoding: 'utf8' });
    const fm = readFrontmatter(readFileSync(join(dir, '.cursor/rules/cdd.mdc'), 'utf8'));
    assert.deepEqual(fm.issues, []);
    assert.equal(fm.data.globs, '**/*');
  });

  it('this repository has no path-scoped rule findings', () => {
    const repoConfig = JSON.parse(readFileSync('.docguard.json', 'utf8'));
    const result = validatePathScopedRules(process.cwd(), repoConfig);
    assert.deepEqual(result.findings.filter(f => f.severity !== 'info').map(f => f.message), []);
  });

  it('documents the validator, the codes, the command and the verified formats', () => {
    const read = p => readFileSync(p, 'utf8');
    assert.match(read('docs/commands.md'), /### `docguard rules`[\s\S]*docguard-cli rules --for/);
    assert.match(read('docs/configuration.md'), /pathScopedRules/);
    assert.match(read('docs/ai-integration.md'), /checked against each vendor's documentation on 2026-09-30/);
    assert.match(read('README.md'), /Path-Scoped-Rules/);
    assert.match(read('docs-canonical/ARCHITECTURE.md'), /instruction-scopes\.mjs/);
  });
});
