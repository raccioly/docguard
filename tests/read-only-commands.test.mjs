/**
 * Read-only commands write nothing (specs/042-read-only-commands).
 *
 * Only `init` and the aliases that run it install DocGuard's agent skills and
 * slash commands. Every read, report, check and preview mode leaves the
 * working tree unchanged. DocGuard's own state directory ignores itself, and
 * DocGuard's dirty checks never count it.
 *
 * @req docguard.read-only-commands#FR-001
 * @req docguard.read-only-commands#FR-002
 * @req docguard.read-only-commands#FR-003
 * @req docguard.read-only-commands#FR-004
 * @req docguard.read-only-commands#FR-005
 * @req docguard.read-only-commands#FR-006
 * @req docguard.read-only-commands#FR-007
 * @req docguard.read-only-commands#SC-001
 * @req docguard.read-only-commands#SC-002
 * @req docguard.read-only-commands#SC-003
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { devNull, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
// Isolate from the developer's global git config (a global excludes file that
// ignores `.docguard/` would hide the defect this suite reproduces).
const ENV = {
  ...process.env,
  NO_COLOR: '1',
  DOCGUARD_NO_UPDATE_HINT: '1',
  GIT_CONFIG_GLOBAL: devNull,
  GIT_CONFIG_NOSYSTEM: '1',
};
const posix = process.platform !== 'win32';
const temporary = [];

function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(dir);
  return dir;
}

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
}

function cli(dir, args, options = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', env: ENV, input: options.input ?? '', timeout: options.timeout ?? 60_000,
  });
  return { ...result, out: `${result.stdout || ''}${result.stderr || ''}` };
}

function write(dir, path, content) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}

/** A committed project that ran `init` but has no `.agent/` and no `.docguard/`. */
let BASE;
function buildBase() {
  const dir = tempDir('docguard-042-base-');
  write(dir, 'package.json', '{"name":"fixture","version":"1.0.0"}\n');
  write(dir, 'src/index.js', 'export function add(a, b) { return a + b; }\n');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'initial']);
  cli(dir, ['init', '--skip-prompts', '--no-spec-kit']);
  rmSync(join(dir, '.agent'), { recursive: true, force: true });
  rmSync(join(dir, '.docguard'), { recursive: true, force: true });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'adopt docguard']);
  return dir;
}

function copyOfBase() {
  const dir = tempDir('docguard-042-case-');
  cpSync(BASE, dir, { recursive: true });
  return dir;
}

/** `git status` plus the bytes of every file outside `.git/` and `.docguard/`. */
function snapshot(dir) {
  const files = {};
  const walk = rel => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (path === '.git' || path === '.docguard') continue;
      if (entry.isDirectory()) { files[`${path}/`] = 'dir'; walk(path); }
      else files[path] = createHash('sha256').update(readFileSync(join(dir, path))).digest('hex');
    }
  };
  walk('');
  return { status: git(dir, ['status', '--porcelain=v1', '--untracked-files=all']), files };
}

function changedPaths(before, after) {
  const keys = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  return [...keys].filter(key => before.files[key] !== after.files[key]).sort();
}

before(() => { BASE = buildBase(); });
after(() => { for (const dir of temporary) rmSync(dir, { recursive: true, force: true }); });

// Every read, report, check and preview invocation (FR-002, FR-003, FR-004).
const READ_ONLY = [
  ['guard'], ['guard', '--format', 'json'], ['guard', '--format', 'sarif'], ['guard', '--quiet'], ['audit'],
  ['score'], ['score', '--format', 'json'], ['score', '--tax'], ['score', '--trend'],
  ['diff'], ['diff', '--since', 'HEAD~1'], ['impact'], ['diagnose'],
  ['fix'], ['fix', '--doc', 'architecture'], ['fix', '--history'],
  ['trace'], ['trace', '--reverse'], ['trace', '--owners'], ['trace', '--features'],
  ['explain', 'STR001'], ['memory'], ['memory', '--diff'], ['memory', '--pack', '--stdout'],
  ['agent'], ['agent', '--task', 'add a subtract function'],
  ['retire', '--plan'], ['retire'], ['archive', '--plan'],
  ['specs'], ['specs', '--check'], ['specs', 'preflight'],
  ['review'], ['review', '--suggest'], ['feedback', '--preview'],
  ['verify'], ['verify', '--semantic'], ['verify', '--evidence'],
  ['report'], ['report', '--format', 'json'], ['ci'], ['ci', '--no-history'],
  ['rules', '--for', 'src/index.js'], ['rules', '--for', 'src/index.js', '--format', 'json'],
  ['generate', '--plan'], ['generate', '--plan', '--format', 'json'],
  ['generate', '--spec', 'src'], ['generate', '--spec', 'src', '--format', 'json'],
  ['sync'], ['sync', '--format', 'json'],
  ['reconcile', '--since', 'HEAD~1'], ['reconcile', '--since', 'HEAD~1', '--check'],
  ['reconcile', '--since', 'HEAD~1', '--format', 'json'],
  ['upgrade'], ['upgrade', '--check-only'],
  ['hooks', '--list'], ['init', '--with', 'hooks', '--list'], ['agents', '--check'],
  ['demo'], ['mcp'], ['nudge-hook'],
  ['guard', '--help'], ['generate', '--help'], ['--version'], ['--help'],
  // An unknown name and a removed alias fail before anything is written (FR-001).
  ['bogus'], ['gen'],
];

describe('every read, report, check and preview mode leaves the tree unchanged (FR-001–FR-004, SC-001)', () => {
  for (const args of READ_ONLY) {
    it(`docguard ${args.join(' ')}`, () => {
      const dir = copyOfBase();
      const beforeRun = snapshot(dir);
      const result = cli(dir, args, { input: args[0] === 'nudge-hook' ? '{}' : '' });
      const afterRun = snapshot(dir);
      assert.deepEqual(changedPaths(beforeRun, afterRun), [], `files changed:\n${result.out.slice(0, 2000)}`);
      assert.equal(afterRun.status, beforeRun.status, 'git status changed');
      assert.equal(existsSync(join(dir, '.agent')), false, '.agent/ must not be scaffolded');
      assert.equal(existsSync(join(dir, '.specify')), false, '.specify/ must not be scaffolded');
      assert.doesNotMatch(result.out, /Spec Kit is not initialized/, 'only init may print the Spec Kit hint');
    });
  }

  it('docguard watch (stopped after its first run)', () => {
    const dir = copyOfBase();
    const beforeRun = snapshot(dir);
    cli(dir, ['watch'], { timeout: 4000 });
    const afterRun = snapshot(dir);
    assert.deepEqual(changedPaths(beforeRun, afterRun), []);
    assert.equal(afterRun.status, beforeRun.status);
  });
});

describe('explicit writers other than init do not scaffold (FR-004)', () => {
  for (const args of [
    ['generate'], ['generate', '--plan', '--write'], ['sync', '--write'],
    ['reconcile', '--since', 'HEAD~1', '--write'], ['hooks', '--claude'],
  ]) {
    it(`docguard ${args.join(' ')} creates no .agent/ or .specify/`, () => {
      const dir = copyOfBase();
      const result = cli(dir, args);
      assert.equal(existsSync(join(dir, '.agent')), false, result.out.slice(0, 2000));
      assert.equal(existsSync(join(dir, '.specify')), false);
      assert.doesNotMatch(result.out, /Spec Kit is not initialized/);
    });
  }

  it('the skill installer has exactly one caller: init (FR-001)', () => {
    const callers = [];
    const walk = rel => {
      for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
        const path = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith('.mjs') && /\bensureSkills\s*\(/.test(
          readFileSync(join(ROOT, path), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')
            .replace(/export function ensureSkills\s*\(/, ''),
        )) callers.push(path);
      }
    };
    walk('cli');
    assert.deepEqual(callers, ['cli/commands/init.mjs']);
  });
});

describe('the setup family still installs skills and commands (FR-001, SC-003)', () => {
  const skill = dir => join(dir, '.agent/skills/docguard-guard/SKILL.md');
  const command = dir => join(dir, '.agent/commands/docguard.guard.md');

  it('init installs them, and a second init rewrites none of them', () => {
    const dir = copyOfBase();
    const first = cli(dir, ['init', '--skip-prompts', '--no-spec-kit']);
    assert.ok(existsSync(skill(dir)), first.out.slice(0, 2000));
    assert.ok(existsSync(command(dir)));
    const mtimes = [statSync(skill(dir)).mtimeMs, statSync(command(dir)).mtimeMs];
    const second = cli(dir, ['init', '--skip-prompts', '--no-spec-kit']);
    assert.doesNotMatch(second.out, /skills installed\/updated|slash commands installed/);
    assert.deepEqual([statSync(skill(dir)).mtimeMs, statSync(command(dir)).mtimeMs], mtimes);
  });

  it('an alias that runs init (badge) installs them too', () => {
    const dir = copyOfBase();
    cli(dir, ['badge']);
    assert.ok(existsSync(skill(dir)));
    assert.ok(existsSync(command(dir)));
  });
});

describe('the .docguard/ state directory ignores itself (FR-005, SC-002)', () => {
  const ignoreFile = dir => join(dir, '.docguard/.gitignore');
  const untracked = dir => git(dir, ['status', '--porcelain=v1', '--untracked-files=all']);

  it('a plan-cache write leaves git status clean, and git add -A stages nothing under .docguard/', () => {
    const dir = copyOfBase();
    cli(dir, ['generate', '--plan']);
    assert.ok(existsSync(join(dir, '.docguard/plan.cache.json')), 'the preview still caches its plan');
    assert.equal(readFileSync(ignoreFile(dir), 'utf8'), '*\n');
    assert.equal(untracked(dir), '');
    git(dir, ['add', '-A']);
    assert.equal(git(dir, ['diff', '--cached', '--name-only']), '');
  });

  for (const [label, args, file, input] of [
    ['score history (ci)', ['ci'], 'history.jsonl'],
    ['context pack (memory --pack)', ['memory', '--pack'], 'context-pack.md'],
    ['nudge state (nudge-hook)', ['nudge-hook'], 'nudge-state.json', '{"tool_input":{"file_path":"AGENTS.md"}}'],
    ['feedback records (feedback)', ['feedback', '--all'], 'feedback'],
  ]) {
    it(`${label} writes the ignore file with its state`, () => {
      const dir = copyOfBase();
      const result = cli(dir, args, { input: input ?? '' });
      assert.ok(existsSync(join(dir, '.docguard', file)), `${file} missing:\n${result.out.slice(0, 2000)}`);
      assert.equal(readFileSync(ignoreFile(dir), 'utf8'), '*\n');
      assert.equal(untracked(dir), '');
    });
  }

  it('fix memory writes the ignore file with its state', async () => {
    const { appendFixes } = await import('../cli/writers/fix-memory.mjs');
    const dir = copyOfBase();
    appendFixes(dir, [{ file: 'README.md', kind: 'test', summary: 'fixture' }]);
    assert.ok(existsSync(join(dir, '.docguard/fixed.json')));
    assert.equal(readFileSync(ignoreFile(dir), 'utf8'), '*\n');
    assert.equal(untracked(dir), '');
  });

  it('a spec completion writes the ignore file with the active context', async t => {
    const { dir, revision, completeSpec } = await completionFixture(t);
    const result = completeSpec(dir, {}, { id: 'acme.feature', since: revision, write: true, reason: 'Reviewed.' },
      { guardResult: { status: 'PASS', errors: 0, warnings: 0 } });
    assert.equal(result.status, 'VERIFIED');
    assert.ok(existsSync(join(dir, '.docguard/current-context.json')));
    assert.equal(readFileSync(ignoreFile(dir), 'utf8'), '*\n');
    assert.doesNotMatch(untracked(dir), /\.docguard\//);
  });

  it('an existing .docguard/.gitignore is kept as it is', () => {
    const dir = copyOfBase();
    write(dir, '.docguard/.gitignore', 'plan.cache.json\n');
    cli(dir, ['generate', '--plan']);
    assert.equal(readFileSync(ignoreFile(dir), 'utf8'), 'plan.cache.json\n');
  });

  it('an existing .docguard/ from an earlier version gains the ignore file on the next write', () => {
    const dir = copyOfBase();
    write(dir, '.docguard/history.jsonl', '');
    cli(dir, ['generate', '--plan']);
    assert.equal(readFileSync(ignoreFile(dir), 'utf8'), '*\n');
  });

  it('a symlinked .docguard is never written through', { skip: !posix && 'POSIX symlinks' }, () => {
    const dir = copyOfBase();
    const outside = tempDir('docguard-042-outside-');
    symlinkSync(outside, join(dir, '.docguard'));
    cli(dir, ['generate', '--plan']);
    assert.deepEqual(readdirSync(outside), []);
  });

  it('ensureStateDir refuses a .docguard that is a file', async () => {
    const { ensureStateDir } = await import('../cli/writers/state-dir.mjs');
    const dir = copyOfBase();
    write(dir, '.docguard', 'not a directory');
    assert.equal(ensureStateDir(dir), false);
    assert.equal(readFileSync(join(dir, '.docguard'), 'utf8'), 'not a directory');
    const fresh = copyOfBase();
    assert.equal(ensureStateDir(fresh), true);
    assert.equal(readFileSync(ignoreFile(fresh), 'utf8'), '*\n');
  });
});

/** The spec-completion fixture of tests/spec-completion.test.mjs, reduced. */
async function completionFixture(t, { trackedState = false } = {}) {
  const { completeSpec } = await import('../cli/commands/specs.mjs');
  const { projectSpecRegistry, SPEC_REGISTRY_PATH } = await import('../cli/scanners/spec-registry.mjs');
  const dir = tempDir('docguard-042-complete-');
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  write(dir, '.docguard.json', JSON.stringify({ projectName: 'fixture', profile: 'starter' }));
  write(dir, 'specs/001-feature/spec.md', '# Feature\n\n**Spec ID**: `acme.feature`\n\n- **FR-001**: The system MUST work.\n');
  write(dir, 'specs/001-feature/tasks.md', '# Tasks\n\n- [x] T001 Build.\n');
  write(dir, 'src/feature.js', '/** @implements acme.feature#FR-001 */\nexport const feature = true;\n');
  write(dir, 'tests/feature.test.js', '/** @req acme.feature#FR-001 */\ntest("feature", () => {});\n');
  write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n');
  write(dir, 'CHANGELOG.md', '# Changelog\n');
  if (trackedState) write(dir, '.docguard/plan.cache.json', '{"v":"old"}\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'initial']);
  const registry = projectSpecRegistry(dir).registry;
  registry.specs[0].reviewed.lifecycle.approval = 'approved';
  registry.specs[0].reviewed.lifecycle.delivery = 'implemented';
  registry.specs[0].reviewed.scope.canonicalDocs = ['docs-canonical/ARCHITECTURE.md'];
  write(dir, SPEC_REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'registry']);
  return { dir, revision: git(dir, ['rev-parse', 'HEAD']).trim(), completeSpec };
}

describe('dirty checks never count DocGuard\'s own state (FR-006, SC-002)', () => {
  /** A copy of the base with `.docguard/plan.cache.json` committed, as an earlier version allowed. */
  function trackedStateProject() {
    const dir = copyOfBase();
    write(dir, '.docguard/plan.cache.json', '{"v":"old"}\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'committed state']);
    return dir;
  }
  const packDirty = dir => {
    const pack = cli(dir, ['memory', '--pack', '--stdout']).stdout;
    return /dirty: (\w+)/.exec(pack)?.[1];
  };

  it('memory --pack reports dirty: false after a commit and a second pack', () => {
    const dir = copyOfBase();
    cli(dir, ['sync']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'after sync', '--allow-empty']);
    assert.equal(git(dir, ['show', '--name-only', '--format=', 'HEAD']).trim(), '', 'nothing under .docguard/ is committed');
    cli(dir, ['memory', '--pack']);
    cli(dir, ['memory', '--pack']);
    assert.match(readFileSync(join(dir, '.docguard/context-pack.md'), 'utf8'), /dirty: false/);
  });

  it('memory --pack ignores a committed .docguard/ file that a later run rewrote, and still sees source changes', () => {
    const dir = trackedStateProject();
    cli(dir, ['sync']);
    assert.match(git(dir, ['status', '--porcelain']), /\.docguard\/plan\.cache\.json/, 'the committed cache was rewritten');
    assert.equal(packDirty(dir), 'false');
    write(dir, 'src/index.js', 'export const changed = true;\n');
    assert.equal(packDirty(dir), 'true');
  });

  it('getHeadInfo (report, reconcile) ignores .docguard/ and sees other changes', async () => {
    const { getHeadInfo } = await import('../cli/shared-git.mjs');
    const dir = trackedStateProject();
    write(dir, '.docguard/plan.cache.json', '{"v":"new"}\n');
    assert.equal(getHeadInfo(dir).dirty, false);
    write(dir, 'src/index.js', 'export const changed = true;\n');
    assert.equal(getHeadInfo(dir).dirty, true);
  });

  it('gitEvidence ignores .docguard/ and sees other changes', async () => {
    const { gitEvidence } = await import('../cli/scanners/semantic-claims.mjs');
    const dir = trackedStateProject();
    write(dir, '.docguard/plan.cache.json', '{"v":"new"}\n');
    assert.equal(gitEvidence(dir).dirty, false);
    write(dir, 'src/index.js', 'export const changed = true;\n');
    assert.equal(gitEvidence(dir).dirty, true);
  });

  it('nonLifecycleChanges (specs complete, specs reanchor) ignores .docguard/ and sees other changes', async () => {
    const { nonLifecycleChanges } = await import('../cli/scanners/revision-anchor.mjs');
    const dir = trackedStateProject();
    const paths = { registryPath: '.docguard-specs.json', contextPath: '.docguard/current-context.json' };
    write(dir, '.docguard/plan.cache.json', '{"v":"new"}\n');
    assert.deepEqual(nonLifecycleChanges(dir, paths), []);
    write(dir, 'src/index.js', 'export const changed = true;\n');
    assert.deepEqual(nonLifecycleChanges(dir, paths), ['src/index.js']);
  });

  it('specs complete is not blocked by a rewritten committed cache', async t => {
    const { dir, revision, completeSpec } = await completionFixture(t, { trackedState: true });
    write(dir, '.docguard/plan.cache.json', '{"v":"new"}\n');
    const result = completeSpec(dir, {}, { id: 'acme.feature', since: revision, write: true, reason: 'Reviewed.' },
      { guardResult: { status: 'PASS', errors: 0, warnings: 0 } });
    assert.equal(result.status, 'VERIFIED', JSON.stringify(result.blockers));
  });
});

describe('the documentation states the rule (FR-007)', () => {
  const read = path => readFileSync(join(ROOT, path), 'utf8');

  it('SECURITY.md states the scaffolding rule and the self-ignoring state directory', () => {
    const security = read('docs-canonical/SECURITY.md');
    assert.match(security, /Only `init`[^\n]*installs DocGuard's agent skills and slash commands/);
    assert.match(security, /`\.docguard\/\.gitignore`/);
    assert.match(security, /\| rules --for, trace --owners/);
  });

  it('DATA-MODEL.md notes that .docguard/ ignores itself', () => {
    assert.match(read('docs-canonical/DATA-MODEL.md'), /`\.docguard\/\.gitignore`[^\n]*`\*`/);
  });

  it('ENVIRONMENT.md names sync --write, not a bare sync, as a writer', () => {
    const environment = read('docs-canonical/ENVIRONMENT.md');
    assert.match(environment, /`sync --write`/);
    assert.doesNotMatch(environment, /`fix --write`, `sync`, `init`/);
  });

  it('ARCHITECTURE.md says the skill installer runs only from init', () => {
    assert.match(read('docs-canonical/ARCHITECTURE.md'), /`ensureSkills` runs only from `init`/);
  });

  it('CHANGELOG.md records the fix under Unreleased', () => {
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## [Unreleased]'), changelog.indexOf('\n## [', changelog.indexOf('## [Unreleased]') + 1));
    assert.match(unreleased, /### Fixed[\s\S]*`rules --for`[\s\S]*`\.docguard\/`/);
  });
});
