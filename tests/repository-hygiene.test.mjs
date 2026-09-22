import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

/**
 * This repository is public, and every tracked file is republished on each tag
 * as a GitHub source archive. Three classes of content have reached it by
 * accident before — always through a `git add -A` that swept in whatever the
 * working tree happened to hold (`f1fef7a` took .codex/, `ee3fc88` took a .bak,
 * `fc73116` took .claude/ and all of .wolf/, `96e2dd8` took a generated cache).
 * .gitignore stops the known paths; these assertions stop the content, which is
 * what actually matters once a path is renamed or a new tool is adopted.
 */

/** Tracked files are the oracle: ignored-but-present local files are fine. */
function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 32 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
}

/** Git's own heuristic: a NUL byte early in the file means "not text". */
function readTextOrNull(file) {
  const buffer = readFileSync(join(root, file));
  if (buffer.subarray(0, 8192).includes(0)) return null;
  return buffer.toString('utf8');
}

/**
 * Base64 so this guard does not itself reintroduce the identifiers it forbids —
 * a plaintext needle in a public test file is the leak it is meant to prevent.
 * These are slugs of private downstream projects that were used as field-test
 * subjects; they carry no technical meaning for DocGuard and must not return.
 */
const FORBIDDEN_IDENTIFIERS = ['aHVnb2Nyb3Nz', 'bWVyZ2Vyc3luYw==']
  .map(token => Buffer.from(token, 'base64').toString('utf8'));

/**
 * Any developer's home directory, not one specific machine. An absolute path
 * under /Users/<name> or /home/<name> is never reproducible for anyone else —
 * `assets/demo.tape` pinned one and the recording broke for its own author once
 * the worktree was deleted and Node was upgraded.
 */
const ABSOLUTE_HOME_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]+\//;

describe('repository hygiene', () => {
  it('keeps private project identifiers out of every tracked file', () => {
    const offenders = [];
    for (const file of trackedFiles()) {
      const text = readTextOrNull(file);
      if (text === null) continue;
      const haystack = text.toLowerCase();
      for (const identifier of FORBIDDEN_IDENTIFIERS) {
        if (haystack.includes(identifier)) offenders.push(`${file}: private project identifier`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it('keeps absolute developer home paths out of every tracked file', () => {
    const offenders = [];
    for (const file of trackedFiles()) {
      const text = readTextOrNull(file);
      if (text === null) continue;
      // This test declares the pattern it forbids, so it cannot match itself.
      if (file === 'tests/repository-hygiene.test.mjs') continue;
      const match = text.match(ABSOLUTE_HOME_PATH);
      if (match) offenders.push(`${file}: absolute home path`);
    }
    assert.deepEqual(offenders, []);
  });

  it('does not track generated or machine-local agent state', () => {
    const generated = [
      // Spec Kit re-downloads this catalog from the catalog_url it records, so a
      // committed copy is a frozen snapshot that ages while looking current.
      /^\.specify\/extensions\/\.cache\//,
      // Agent tooling that reads .wolf/, which this repository ignores. Project
      // instructions every contributor needs live in AGENTS.md and CLAUDE.md.
      /^\.claude\//,
      /^\.codex\//,
      /^\.wolf\//,
      // safeWrite's local recovery copies, never source.
      /\.bak$/,
    ];
    const offenders = trackedFiles().filter(file => generated.some(pattern => pattern.test(file)));
    assert.deepEqual(offenders, []);
  });
});
