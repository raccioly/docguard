// @req docs-canonical/REQUIREMENTS.md#FR-024
import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runHooks } from '../cli/commands/hooks.mjs';
import { safeWrite } from '../cli/writers/generate-io.mjs';

// Full-suite runs execute several subprocess-heavy files in parallel. Keep this
// deadline bounded while allowing for scheduler contention on slower CI hosts.
const PROCESS_TIMEOUT_MS = 15000;

/**
 * @req docguard.document-lifecycle#FR-018
 * @req docguard.document-lifecycle#FR-019
 */

// A closed PATH proves that hooks neither depend on the host's DocGuard nor
// download anything. Only the JSON parser uses the real Node executable.
describe('generated enforcement shell contracts', () => {
  let dir;
  let bin;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'docguard hook contract '));
    bin = join(dir, 'bin');
    mkdirSync(bin);
    mkdirSync(join(dir, '.git'));
    symlinkSync(process.execPath, join(bin, 'node'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function executable(name, body) {
    const path = join(dir, name);
    safeWrite(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  }

  function fixture() {
    // These tests exercise the enforcement contract of an ADOPTED project.
    // The hook deliberately fails open when .docguard.json is absent (a hook is
    // repo-wide, the config is branch-local), so adoption must be explicit here.
    writeFileSync(join(dir, '.docguard.json'), '{"projectName":"contract"}');
    executable('bin/docguard', `
printf '%s\\n' "$*" >> "$CALLS"
case "$1" in
  score) printf '%s' "$SCORE_JSON"; exit "$SCORE_EXIT" ;;
  guard) exit "$GUARD_EXIT" ;;
  fix) exit "$FIX_EXIT" ;;
  *) exit 99 ;;
esac`);
    executable('bin/npx', 'printf "npx invoked\\n" >> "$CALLS"; exit 99');
    executable('bin/git', 'printf "git %s\\n" "$*" >> "$CALLS"; exit "$GIT_EXIT"');
  }

  function run(type, env = {}, autoFix = false) {
    runHooks(dir, { projectName: 'contract' }, { type, autoFix });
    return execute(type, env);
  }

  function execute(type, env = {}, args = []) {
    return spawnSync('/bin/sh', [join(dir, '.git/hooks', type), ...args], {
      cwd: dir,
      encoding: 'utf8',
      timeout: PROCESS_TIMEOUT_MS,
      env: {
        PATH: bin, CALLS: join(dir, 'calls'), SCORE_JSON: '{"score":80}',
        SCORE_EXIT: '0', GUARD_EXIT: '0', FIX_EXIT: '0', GIT_EXIT: '0', ...env,
      },
    });
  }

  function expect(result, code) {
    assert.equal(result.error, undefined);
    assert.equal(result.status, code, result.stdout + result.stderr);
  }

  for (const score of [0, 59, 60, 100]) {
    for (const pretty of [false, true]) {
      it(`enforces ${pretty ? 'pretty' : 'compact'} JSON score ${score}`, () => {
        fixture();
        expect(run('pre-push', { SCORE_JSON: JSON.stringify({ score, categories: { x: { score: 100 } } }, null, pretty ? 2 : 0) }), score < 60 ? 1 : 0);
      });
    }
  }

  for (const value of ['', 'broken', '{"score":100} trailing', '{"score":100', '{}',
    'null', '[]', '{"categories":{"x":{"score":100}}}', '{"score":"100"}',
    '{"score":null}', '{"score":true}', '{"score":-1}', '{"score":101}', '{"score":60.5}', '{"score":1e999}']) {
    it(`blocks invalid score output ${JSON.stringify(value)}`, () => {
      fixture();
      const result = run('pre-push', { SCORE_JSON: value });
      expect(result, 1);
      assert.match(result.stderr, /valid CDD score/);
    });
  }

  for (const code of [1, 2, 3, 126, 127, 137]) {
    it(`blocks score command failure ${code} even with valid high JSON`, () => {
      fixture();
      expect(run('pre-push', { SCORE_EXIT: String(code) }), 1);
    });
  }

  for (const autoFix of [false, true]) {
    for (const code of [0, 1, 2, 3, 126, 127, 137]) {
      it(`enforces guard exit ${code}, auto-fix=${autoFix}`, () => {
        fixture();
        const result = run('pre-commit', { GUARD_EXIT: String(code) }, autoFix);
        // 0 = clean, 2 = warnings only, 3 = project not initialised. Everything
        // else is a real failure and must block. 3 is NOT a lenient catch-all:
        // it is set only when .docguard.json is absent, so a tool that was never
        // adopted cannot stop a commit, while an adopted project still fails on 1.
        const passes = code === 0 || code === 2 || code === 3;
        expect(result, passes ? 0 : 1);
        if (code === 2) assert.match(result.stdout, /warnings — commit allowed/);
        if (code === 3) assert.match(result.stdout, /not initialised/);
      });
    }
  }

  for (const variable of ['FIX_EXIT', 'GIT_EXIT']) {
    it(`blocks auto-fix when ${variable} fails without running guard`, () => {
      fixture();
      expect(run('pre-commit', { [variable]: '1' }, true), 1);
      const calls = readFileSync(join(dir, 'calls'), 'utf8');
      assert.doesNotMatch(calls, /^guard$/m);
      if (variable === 'FIX_EXIT') assert.doesNotMatch(calls, /^git /m);
    });
  }

  for (const [type, autoFix] of [['pre-push', false], ['pre-commit', false], ['pre-commit', true]]) {
    it(`blocks missing Node for ${type}, auto-fix=${autoFix}`, () => {
      fixture();
      rmSync(join(bin, 'node'));
      const result = run(type, {}, autoFix);
      expect(result, 1);
      assert.match(result.stderr, /Node.js runtime not found/);
    });
    it(`blocks missing DocGuard without invoking npx for ${type}, auto-fix=${autoFix}`, () => {
      fixture();
      rmSync(join(bin, 'docguard'));
      const result = run(type, {}, autoFix);
      expect(result, 1);
      assert.match(result.stderr, /DocGuard not found/);
    });
    it(`prefers project installation for ${type}, auto-fix=${autoFix}`, () => {
      fixture();
      executable('node_modules/.bin/docguard', readFileSync(join(bin, 'docguard'), 'utf8'));
      executable('bin/docguard', 'echo "wrong PATH executable" >&2; exit 99');
      expect(run(type, {}, autoFix), 0);
      assert.doesNotMatch(readFileSync(join(dir, 'calls'), 'utf8'), /npx/);
    });
  }

  for (const [type, autoFix] of [['pre-push', false], ['pre-commit', false], ['pre-commit', true], ['commit-msg', false]]) {
    it(`runs a user postlude after successful ${type}, auto-fix=${autoFix}`, () => {
      fixture();
      runHooks(dir, { projectName: 'contract' }, { type, autoFix });
      const path = join(dir, '.git/hooks', type);
      safeWrite(path, `${readFileSync(path, 'utf8')}\nprintf 'ran' > "$POSTLUDE"\n`);
      chmodSync(path, 0o755);
      const postlude = join(dir, `postlude-${type}-${autoFix}`);
      const args = type === 'commit-msg' ? [join(dir, 'commit-message')] : [];
      if (type === 'commit-msg') safeWrite(args[0], 'fix: valid message\n');
      const result = execute(type, {
        POSTLUDE: postlude,
        ...(type === 'commit-msg' ? { PATH: process.env.PATH } : {}),
      }, args);
      expect(result, 0);
      assert.equal(readFileSync(postlude, 'utf8'), 'ran');
    });
  }

  it('blocks a failed JSON runtime even if it prints a high score', () => {
    fixture();
    rmSync(join(bin, 'node'));
    executable('bin/node', 'printf 100; exit 1');
    expect(run('pre-push'), 1);
  });

  it('does not back up a managed hook when the reinstall is byte-identical', () => {
    fixture();
    run('pre-push');
    const path = join(dir, '.git/hooks/pre-push');
    const original = readFileSync(path, 'utf8');
    run('pre-push');
    assert.equal(readFileSync(path, 'utf8'), original, 'the hook itself is unchanged');
    // The backup slot is single and unversioned. Spending it on a no-op rewrite
    // discards whatever it held — on a forced install, the user's own hook.
    assert.equal(existsSync(path + '.bak'), false,
      'an identical rewrite must not consume the backup slot');
  });
});

// No YAML dependency needed: pin the fields within each known event block.
// Official schema: github/spec-kit/extensions/EXTENSION-API-REFERENCE.md,
// hooks.<event>.optional is boolean; false emits an automatic hook.
describe('Spec Kit hook registration contracts', () => {
  for (const path of ['extension.yml', 'templates/extensions.yml']) {
    it(`requires lifecycle preflight and after_implement while keeping after_tasks optional in ${path}`, () => {
      const source = readFileSync(new URL(`../extensions/spec-kit-docguard/${path}`, import.meta.url), 'utf8');
      const brief = source.match(/^  before_specify:\n([\s\S]*?)(?=^  after_implement:)/m)?.[1];
      const after = source.match(/^  after_implement:\n([\s\S]*?)(?=^  before_tasks:)/m)?.[1];
      const converge = source.match(/^  after_converge:\n([\s\S]*?)(?=^  before_tasks:)/m)?.[1];
      const before = source.match(/^  before_tasks:\n([\s\S]*?)(?=^  after_tasks:)/m)?.[1];
      assert.ok(brief);
      assert.ok(after);
      assert.ok(before);
      assert.match(brief, /command: "?speckit\.docguard\.brief"?/);
      assert.match(brief, /optional: false/);
      assert.match(after, /command: "?speckit\.docguard\.guard"?/);
      assert.match(after, /optional: false/);
      assert.match(after, /command: "?speckit\.docguard\.complete"?/);
      assert.ok(converge);
      assert.match(converge, /command: "?speckit\.docguard\.complete"?/);
      assert.match(converge, /optional: true/);
      assert.match(before, /command: "?speckit\.docguard\.preflight"?/);
      assert.match(before, /optional: false/);
      assert.match(source, /after_tasks:\n[\s\S]*optional: true/);
    });
  }
});

describe('Spec Kit command registration contracts', () => {
  it('declares every shipped command with a unique matching file', () => {
    const manifest = readFileSync(
      new URL('../extensions/spec-kit-docguard/extension.yml', import.meta.url),
      'utf8',
    );
    const block = manifest.match(/^  commands:\n([\s\S]*?)(?=^  #|^  workflows:)/m)?.[1];
    assert.ok(block, 'provides.commands block is missing');

    const entries = [...block.matchAll(
      /^    - name: "([^"]+)"\n      file: "([^"]+)"\n      description: "([^"]+)"/gm,
    )].map(([, name, file, description]) => ({ name, file, description }));
    assert.ok(entries.length > 0, 'no commands were parsed from the manifest');
    assert.equal(new Set(entries.map(({ name }) => name)).size, entries.length, 'command names must be unique');
    assert.equal(new Set(entries.map(({ file }) => file)).size, entries.length, 'command files must be unique');

    for (const { name, file, description } of entries) {
      const verb = name.replace(/^speckit\.docguard\./, '');
      assert.notEqual(verb, name, `command is outside the docguard namespace: ${name}`);
      assert.equal(file, `commands/${verb}.md`, `${name} must map to its matching command file`);
      assert.ok(description.trim(), `${name} must have a description`);
      const command = readFileSync(
        new URL(`../extensions/spec-kit-docguard/${file}`, import.meta.url),
        'utf8',
      );
      assert.match(command, /^---\ndescription:/, `${file} must have command frontmatter`);
    }

    const shipped = readdirSync(
      new URL('../extensions/spec-kit-docguard/commands/', import.meta.url),
      { withFileTypes: true },
    )
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => `commands/${entry.name}`)
      .sort();
    assert.deepEqual(entries.map(({ file }) => file).sort(), shipped);
  });
});

/**
 * specs/018-extension-manifest-hygiene — the manifest must not claim Spec Kit
 * support it cannot deliver, and the manual-install template must match it.
 *
 * @req docguard.extension-manifest-hygiene#FR-001
 * @req docguard.extension-manifest-hygiene#FR-002
 * @req docguard.extension-manifest-hygiene#FR-003
 * @req docguard.extension-manifest-hygiene#FR-004
 * @req docguard.extension-manifest-hygiene#FR-006
 * @req docguard.extension-manifest-hygiene#SC-001
 * @req docguard.extension-manifest-hygiene#SC-003 — category/effect asserted here;
 *      live `specify extension info` on 1.0.13 recorded in the tasks status
 */
describe('extension manifest hygiene', () => {
  const read = rel => readFileSync(new URL(`../extensions/spec-kit-docguard/${rel}`, import.meta.url), 'utf8');
  const manifest = read('extension.yml');

  // Hook entries as {event, command, optional, priority}, from either file.
  const hookEntries = (source) => {
    const block = source.slice(source.search(/^hooks:\s*$/m));
    const entries = [];
    let event = null;
    let current = null;
    for (const line of block.split('\n').slice(1)) {
      if (/^\S/.test(line)) break;
      const ev = line.match(/^ {2}([a-z_]+):\s*$/);
      if (ev) { event = ev[1]; continue; }
      const cmd = line.match(/^\s*-?\s*command:\s*"?([\w.-]+)"?/);
      if (cmd) { current = { event, command: cmd[1] }; entries.push(current); continue; }
      const kv = line.match(/^\s+(optional|priority):\s*(\S+)/);
      if (kv && current) current[kv[1]] = kv[1] === 'priority' ? Number(kv[2]) : kv[2] === 'true';
    }
    return entries;
  };

  // Newest Spec Kit feature each construct needs (Spec Kit CHANGELOG).
  const FLOORS = { hookPriority: '0.10.0', categoryEffect: '0.10.2', after_converge: '0.11.2' };
  const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

  it('declares a Spec Kit floor at least as new as the features it uses', () => {
    const floor = manifest.match(/speckit_version:\s*">=([\d.]+)"/)[1];
    const used = [];
    if (/priority:/.test(manifest)) used.push(FLOORS.hookPriority);
    if (/^\s+(category|effect):/m.test(manifest)) used.push(FLOORS.categoryEffect);
    if (/^ {2}after_converge:/m.test(manifest)) used.push(FLOORS.after_converge);
    for (const need of used) assert.ok(cmp(floor, need) >= 0, `floor ${floor} is older than ${need}`);
    assert.match(manifest, /^ {2}category: "docs"$/m);
    const tags = manifest.slice(manifest.indexOf('\ntags:')).split('\n').slice(1).filter(l => /^ {2}- /.test(l));
    assert.ok(tags.length >= 2 && tags.length <= 5, `Spec Kit allows 2-5 tags, found ${tags.length}`);
    assert.match(manifest, /^ {2}effect: "read-write"$/m);
  });

  it('gives every hook an explicit priority, with the briefing first', () => {
    const hooks = hookEntries(manifest);
    assert.ok(hooks.length >= 6);
    for (const h of hooks) assert.ok(Number.isInteger(h.priority) && h.priority >= 1, `${h.event}/${h.command} has no priority`);
    assert.equal(hooks.find(h => h.event === 'before_specify').priority, 5);
  });

  it('uses no non-schema keys under requires or provides', () => {
    assert.doesNotMatch(manifest, /^ {2}framework:/m);
    const provides = manifest.slice(manifest.indexOf('\nprovides:'), manifest.indexOf('\nhooks:'));
    assert.doesNotMatch(provides, /^ {2}workflows:/m);
    assert.match(manifest, /^x-docguard:\n {2}github_workflows:/m);
  });

  it('keeps the manual-install template equal to the manifest hooks, in Spec Kit\'s shape', () => {
    const template = read('templates/extensions.yml');
    assert.match(template, /^installed:\n- docguard$/m);
    assert.match(template, /^settings:\n {2}auto_execute_hooks: true$/m);
    const strip = hs => hs.map(({ event, command, optional, priority }) => ({ event, command, optional, priority }));
    assert.deepEqual(strip(hookEntries(template)), strip(hookEntries(manifest)));
  });

  it('command documents state no counts of checks, validators or skills', () => {
    for (const file of readdirSync(new URL('../extensions/spec-kit-docguard/commands/', import.meta.url))) {
      assert.doesNotMatch(read(`commands/${file}`), /\b\d+\+?\s+(?:automated\s+)?(?:checks|validators|skills)\b/, file);
    }
  });
});
