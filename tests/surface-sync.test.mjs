/**
 * Surface-Sync validator tests.
 *
 * Pins the validator against the exact class of bugs it was built for:
 * a code-derived enumerable list (commands, validators, slash commands)
 * exists in code but is silently missing from the README's table. The
 * count-based canonical-sync passes on this scenario; surface-sync must
 * catch it.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateSurfaceSync } from '../cli/validators/surface-sync.mjs';

function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

describe('Surface-Sync validator', () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'docguard-surface-sync-')); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('returns N/A (total 0) when no surfaces are configured', () => {
    write(tmp, 'README.md', '# X\n| `guard` | description |\n');
    const r = validateSurfaceSync(tmp, {});
    assert.equal(r.total, 0);
    assert.equal(r.warnings.length, 0);
    assert.equal(r.errors.length, 0);
  });

  it('flags a command implemented in code but missing from the README table', () => {
    // Code-truth: cli/commands/{guard,demo}.mjs
    write(tmp, 'cli/commands/guard.mjs', 'export {};');
    write(tmp, 'cli/commands/demo.mjs', 'export {};');

    // README documents `guard` only (table form). `demo` mentioned in prose
    // is NOT a documented list entry — should still be reported as missing.
    write(tmp, 'README.md', [
      '# Project',
      '',
      'Try `npx docguard-cli demo` for a quick preview.',  // prose mention only
      '',
      '## Commands',
      '',
      '| Command | Description |',
      '|---------|-------------|',
      '| `guard` | Run validation |',
      '',
    ].join('\n'));

    const config = {
      surfaceSync: {
        surfaces: [
          { name: 'commands', glob: 'cli/commands/*.mjs', extract: 'basename-no-ext', docs: ['README.md'] },
        ],
      },
    };

    const r = validateSurfaceSync(tmp, config);
    assert.equal(r.total, 1, 'one (surface, doc) pair was checked');
    assert.equal(r.passed, 0, 'should not pass — demo is missing from the table');
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /Surface "commands" drift/);
    assert.match(r.warnings[0], /`demo`/);
    assert.match(r.warnings[0], /missing from README\.md/);
  });

  it('passes when every code item is documented in a table row', () => {
    write(tmp, 'cli/commands/guard.mjs', 'export {};');
    write(tmp, 'cli/commands/demo.mjs', 'export {};');
    write(tmp, 'README.md', [
      '## Commands',
      '| Command | Description |',
      '|---------|-------------|',
      '| `guard` | Run validation |',
      '| `demo`  | Quick preview |',
      '',
    ].join('\n'));

    const config = {
      surfaceSync: {
        surfaces: [
          { name: 'commands', glob: 'cli/commands/*.mjs', extract: 'basename-no-ext', docs: ['README.md'] },
        ],
      },
    };

    const r = validateSurfaceSync(tmp, config);
    assert.equal(r.passed, 1);
    assert.equal(r.warnings.length, 0);
  });

  it('respects the `ignore` list (deprecation aliases not flagged)', () => {
    write(tmp, 'cli/commands/guard.mjs', 'export {};');
    write(tmp, 'cli/commands/setup.mjs', 'export {};'); // deprecation alias

    write(tmp, 'README.md', [
      '## Commands',
      '| Command | Description |',
      '|---------|-------------|',
      '| `guard` | Run validation |',
      '',
    ].join('\n'));

    const config = {
      surfaceSync: {
        surfaces: [
          {
            name: 'commands',
            glob: 'cli/commands/*.mjs',
            extract: 'basename-no-ext',
            ignore: ['setup'],
            docs: ['README.md'],
          },
        ],
      },
    };

    const r = validateSurfaceSync(tmp, config);
    assert.equal(r.passed, 1, 'setup is ignored, so the doc is complete');
    assert.equal(r.warnings.length, 0);
  });

  it('flags a doc item with no corresponding code file (removed surface)', () => {
    write(tmp, 'cli/commands/guard.mjs', 'export {};');
    write(tmp, 'README.md', [
      '## Commands',
      '| Command | Description |',
      '|---------|-------------|',
      '| `guard`  | Run validation |',
      '| `ancient` | Doesn\'t exist anymore |',
      '',
    ].join('\n'));

    const config = {
      surfaceSync: {
        surfaces: [
          { name: 'commands', glob: 'cli/commands/*.mjs', extract: 'basename-no-ext', docs: ['README.md'] },
        ],
      },
    };

    const r = validateSurfaceSync(tmp, config);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /`ancient`/);
    assert.match(r.warnings[0], /listed in README\.md but not found in code/);
  });

  it('does NOT count backticks inside fenced code blocks as documented entries', () => {
    write(tmp, 'cli/commands/guard.mjs', 'export {};');
    write(tmp, 'cli/commands/demo.mjs', 'export {};');
    // README has a code block that LOOKS like a list but is just a shell example.
    // Fenced code is stripped before list-context scanning, so `demo` should
    // still be reported as missing.
    write(tmp, 'README.md', [
      '## Commands',
      '```',
      'docguard guard',
      'docguard demo',
      '```',
      '',
      '| `guard` | only one in the real table |',
      '',
    ].join('\n'));

    const config = {
      surfaceSync: {
        surfaces: [
          { name: 'commands', glob: 'cli/commands/*.mjs', extract: 'basename-no-ext', docs: ['README.md'] },
        ],
      },
    };

    const r = validateSurfaceSync(tmp, config);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /`demo`/, 'demo is in code but only in a code block, not in any table — should warn');
  });

  it('detects bullet-list entries as documented items', () => {
    write(tmp, 'cli/commands/guard.mjs', 'export {};');
    write(tmp, 'cli/commands/demo.mjs', 'export {};');
    write(tmp, 'README.md', [
      '## Commands',
      '',
      '- `guard` — run validation',
      '- `demo` — quick preview',
      '',
    ].join('\n'));

    const config = {
      surfaceSync: {
        surfaces: [
          { name: 'commands', glob: 'cli/commands/*.mjs', extract: 'basename-no-ext', docs: ['README.md'] },
        ],
      },
    };

    const r = validateSurfaceSync(tmp, config);
    assert.equal(r.passed, 1, 'bullet-list items count as documented');
    assert.equal(r.warnings.length, 0);
  });

  it('strips the `docguard ` prefix when extracting from table cells', () => {
    write(tmp, 'cli/commands/guard.mjs', 'export {};');
    write(tmp, 'README.md', [
      '## Commands',
      '| Command | Description |',
      '|---------|-------------|',
      '| `docguard guard` | Run validation |',
      '',
    ].join('\n'));

    const config = {
      surfaceSync: {
        surfaces: [
          { name: 'commands', glob: 'cli/commands/*.mjs', extract: 'basename-no-ext', docs: ['README.md'] },
        ],
      },
    };

    const r = validateSurfaceSync(tmp, config);
    assert.equal(r.passed, 1, 'docguard-prefixed entries should still match the bare command name');
  });

  it('handles multiple target docs independently', () => {
    write(tmp, 'cli/commands/guard.mjs', 'export {};');
    write(tmp, 'README.md', '| `guard` | x |\n');
    write(tmp, 'AGENTS.md', '## Commands\n(no commands listed)\n');

    const config = {
      surfaceSync: {
        surfaces: [
          { name: 'commands', glob: 'cli/commands/*.mjs', extract: 'basename-no-ext', docs: ['README.md', 'AGENTS.md'] },
        ],
      },
    };

    const r = validateSurfaceSync(tmp, config);
    assert.equal(r.total, 2, 'one (surface, doc) pair per doc');
    assert.equal(r.passed, 1, 'README is complete');
    assert.equal(r.warnings.length, 1, 'AGENTS.md is missing guard');
    assert.match(r.warnings[0], /AGENTS\.md/);
  });

  it('scopes scanning to a specific section when `section` is set', () => {
    // Two tables in one README: a Commands table and a Validators table. Without
    // section-scoping, the commands surface would also see validator names and
    // produce cross-table false positives.
    write(tmp, 'cli/commands/guard.mjs', 'export {};');
    write(tmp, 'cli/commands/demo.mjs', 'export {};');
    write(tmp, 'README.md', [
      '# Project',
      '',
      '## Commands',
      '',
      '| Command | Description |',
      '|---------|-------------|',
      '| `guard` | Run validation |',
      '| `demo`  | Quick preview |',
      '',
      '## Validators',
      '',
      '| Validator | Description |',
      '|-----------|-------------|',
      '| `api-surface` | API drift |',
      '| `freshness`   | Doc age |',
      '',
    ].join('\n'));

    // Without section scoping, the commands surface would think `api-surface`
    // and `freshness` were "documented commands missing from code".
    const config = {
      surfaceSync: {
        surfaces: [
          {
            name: 'commands',
            glob: 'cli/commands/*.mjs',
            extract: 'basename-no-ext',
            docs: ['README.md'],
            section: 'Commands',
          },
        ],
      },
    };

    const r = validateSurfaceSync(tmp, config);
    assert.equal(r.passed, 1, `should pass: scope limited to Commands section; warnings: ${r.warnings.join('\n')}`);
    assert.equal(r.warnings.length, 0,
      'no cross-table false positives expected when section is scoped');
  });

  it('warns sensibly when the configured section heading is absent from the doc', () => {
    write(tmp, 'cli/commands/guard.mjs', 'export {};');
    write(tmp, 'README.md', '# Empty doc with no commands section\n');

    const config = {
      surfaceSync: {
        surfaces: [
          {
            name: 'commands',
            glob: 'cli/commands/*.mjs',
            extract: 'basename-no-ext',
            docs: ['README.md'],
            section: 'Commands',
          },
        ],
      },
    };

    const r = validateSurfaceSync(tmp, config);
    // Section missing → empty scope → all code items report as missing.
    // That's the right behavior: the user said "scope to Commands" and it
    // doesn't exist, so the doc has no documented commands.
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /`guard`/);
    assert.match(r.warnings[0], /missing from README\.md/);
  });

  it('returns silently when the surface glob matches nothing', () => {
    write(tmp, 'README.md', '# x\n');
    const config = {
      surfaceSync: {
        surfaces: [
          { name: 'commands', glob: 'nonexistent/*.mjs', extract: 'basename-no-ext', docs: ['README.md'] },
        ],
      },
    };
    const r = validateSurfaceSync(tmp, config);
    assert.equal(r.total, 0);
    assert.equal(r.warnings.length, 0);
  });
});
