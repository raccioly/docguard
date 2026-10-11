/**
 * Fixture git: the one way a test builds or inspects a throwaway repository.
 *
 * A fixture must not depend on the machine's global git config. A global
 * `core.hooksPath` (agent sandboxes, husky-style setups), `commit.gpgsign=true`
 * or `init.defaultBranch` turned 189 tests red on such a machine while CI,
 * whose runners carry no global config, stayed green and could not reproduce
 * it. Other tests passed vacuously instead: a fixture commit failed, nobody
 * read its status, and the assertion ran against an empty repository.
 *
 * The options apply per invocation, never environment-wide. The product code
 * under test still meets the ambient config, and the CI `hermeticity` job runs
 * the suite under a hostile one so both halves stay honest. Rule: fixture git
 * goes through this module; product git (`cli/**`) never does.
 *
 * @implements docguard.test-git-hermeticity#FR-001
 * @implements docguard.test-git-hermeticity#FR-002
 * @implements docguard.test-git-hermeticity#FR-004
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { devNull } from 'node:os';
import { join } from 'node:path';

/** Leading options for every fixture git call: no hooks, no signing. */
export const FIXTURE_GIT = Object.freeze([
  '-c', `core.hooksPath=${devNull}`,
  '-c', 'commit.gpgsign=false',
  '-c', 'tag.gpgsign=false',
]);

const quote = process.platform === 'win32' ? (arg) => `"${arg}"` : (arg) => `'${arg}'`;

/** FIXTURE_GIT as one shell-quoted string, for tests that build `git …` command lines. */
export const FIXTURE_GIT_SHELL = FIXTURE_GIT.map(quote).join(' ');

/**
 * Run fixture git in `cwd` and return its stdout. A failure throws with git's
 * stderr, so a fixture that could not be built fails the test loudly instead
 * of letting it assert against a half-built repository.
 */
export function fixtureGit(cwd, args, options = {}) {
  const result = spawnSync('git', [...FIXTURE_GIT, ...args], { cwd, encoding: 'utf8', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`fixture git ${args.join(' ')} exited ${result.status} in ${cwd}: ${result.stderr}`);
  }
  return result.stdout;
}

/** The hooks the CI `hermeticity` job makes fail. */
export const HOSTILE_HOOKS = Object.freeze([
  'pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'pre-push', 'post-checkout',
]);

/**
 * The machine the CI `hermeticity` job simulates, built under `root`: a global
 * config whose hooks all fail (and record that they ran), mandatory signing
 * through a gpg that always fails, and `trunk` as the default branch. Returns
 * an environment to pass to one spawn at a time, so nothing else in the suite
 * sees it, and `fired()`, the hooks that ran.
 */
export function hostileGitEnv(root) {
  const hooks = join(root, 'hooks');
  mkdirSync(hooks, { recursive: true });
  const log = join(root, 'fired.log');
  for (const hook of HOSTILE_HOOKS) {
    writeFileSync(join(hooks, hook), `#!/bin/sh\necho ${hook} >> '${log}'\necho "hostile ${hook} hook fired" >&2\nexit 1\n`);
    chmodSync(join(hooks, hook), 0o755);
  }
  const config = join(root, 'gitconfig');
  writeFileSync(config, [
    '[core]', `\thooksPath = ${hooks}`,
    '[commit]', '\tgpgsign = true',
    '[tag]', '\tgpgsign = true',
    '[gpg]', '\tprogram = false',
    '[init]', '\tdefaultBranch = trunk',
    '',
  ].join('\n'));
  return {
    env: { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1' },
    fired: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []),
  };
}
