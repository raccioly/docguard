import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

/**
 * Field report, 2026-09-18: `init --skip-prompts` adopted a Spec Kit feature
 * folder as the canonical root, wrote a two-key config, then threw from its own
 * mapped-layout guard. A Cloudflare Worker was typed as a library because init
 * carried a private copy of project-type detection that never learned about
 * Workers.
 */

import { detectCanonicalLayout, isFeatureSpecDirectory, mappedDefaultPaths, mappedRoleNames } from '../cli/shared-doc-roles.mjs';
import { autoDetectProjectType } from '../cli/config.mjs';
import { hasE2ESuite } from '../cli/shared-source.mjs';

const CLI = resolve('cli/docguard.mjs');
const init = (dir, args = []) => spawnSync(process.execPath, [CLI, 'init', '--profile', 'standard', '--skip-prompts', ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const config = dir => JSON.parse(readFileSync(join(dir, '.docguard.json'), 'utf8'));

function scratch(t, build) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-init-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  build(dir);
  return dir;
}

const write = (dir, rel, body) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), body);
};

function specKitProject(dir) {
  mkdirSync(join(dir, 'specs/001-pocket-archive-worker'), { recursive: true });
  mkdirSync(join(dir, 'specs/002-dashboard-enhancements'), { recursive: true });
  mkdirSync(join(dir, 'specs/003-enhanced-transcripts'), { recursive: true });
  writeFileSync(join(dir, 'specs/001-pocket-archive-worker/spec.md'), '# Spec\n');
  writeFileSync(join(dir, 'specs/002-dashboard-enhancements/spec.md'), '# Spec\n');
  writeFileSync(join(dir, 'specs/002-dashboard-enhancements/data-model.md'), '# Data Model\n');
  writeFileSync(join(dir, 'specs/003-enhanced-transcripts/data-model.md'), '# Data Model\n');
  writeFileSync(join(dir, 'package.json'), '{"name":"w","main":"src/index.ts"}\n');
}

describe('Spec Kit feature folders are not canonical roots', () => {
  it('recognises a numbered feature directory wherever it is anchored', () => {
    for (const dir of ['specs/002-dashboard-enhancements', 'specs/001-x', '002-foo', 'spec/010-thing', 'features/003-beta']) {
      assert.equal(isFeatureSpecDirectory(dir), true, dir);
    }
    for (const dir of ['docs-canonical', 'docs/canonical', 'specs/shared', 'my-002-notes', '', null]) {
      assert.equal(isFeatureSpecDirectory(dir), false, String(dir));
    }
  });

  it('never offers one as an adoption candidate, however many role files it holds', t => {
    const dir = scratch(t, specKitProject);
    const hits = detectCanonicalLayout(dir);
    assert.equal(hits.some(hit => hit.dir.startsWith('specs/')), false,
      'a feature folder must not be adoptable as the project-wide canonical root');
  });

  it('initializes a Spec Kit repo instead of adopting one feature and throwing', t => {
    const dir = scratch(t, specKitProject);
    const result = init(dir);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /read-only planning/);
    const written = config(dir);
    assert.equal(written.docs?.roles, undefined, 'no feature folder should have been adopted');
    assert.ok(written.profile && written.projectType && written.validators,
      'a complete config must be written, not a two-key fragment');
  });
});

describe('adopting a genuinely relocated layout', () => {
  const relocated = dir => {
    for (const role of ['ARCHITECTURE', 'DATA-MODEL', 'SECURITY']) write(dir, `docs/canonical/${role}.md`, `# ${role}\n`);
    writeFileSync(join(dir, 'package.json'), '{"name":"app","dependencies":{"express":"4"}}\n');
  };

  it('completes, persists the mapping, and keeps the rest of the config', t => {
    const dir = scratch(t, relocated);
    const result = init(dir);
    assert.equal(result.status, 0, result.stderr);
    const written = config(dir);
    assert.deepEqual(written.docs.roles, {
      architecture: 'docs/canonical/ARCHITECTURE.md',
      dataModel: 'docs/canonical/DATA-MODEL.md',
      security: 'docs/canonical/SECURITY.md',
    });
    assert.ok(written.profile && written.projectType && written.validators);
    for (const mapped of Object.values(written.docs.roles)) {
      assert.ok(written.requiredFiles.canonical.includes(mapped), `${mapped} must stay canonical`);
    }
  });

  it('scaffolds only the roles the mapping did not place', t => {
    const dir = scratch(t, relocated);
    assert.equal(init(dir).status, 0);
    for (const duplicated of ['ARCHITECTURE.md', 'DATA-MODEL.md', 'SECURITY.md']) {
      assert.equal(existsSync(join(dir, 'docs-canonical', duplicated)), false,
        `${duplicated} was mapped elsewhere and must not be duplicated`);
    }
    assert.equal(existsSync(join(dir, 'docs-canonical/TEST-SPEC.md')), true,
      'an unmapped role still needs scaffolding');
  });

  it('is idempotent: a second run neither throws nor loses the mapping', t => {
    const dir = scratch(t, relocated);
    assert.equal(init(dir).status, 0);
    const second = init(dir);
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stderr, /read-only planning/);
    assert.ok(config(dir).docs.roles.architecture);
  });

  it('leaves no configuration behind when it adopts nothing', t => {
    const dir = scratch(t, dir2 => writeFileSync(join(dir2, 'package.json'), '{"name":"x"}\n'));
    const before = existsSync(join(dir, '.docguard.json'));
    assert.equal(before, false);
    assert.equal(init(dir, ['--wizard']).status !== undefined, true);
  });
});

describe('the mapped-layout write guard still protects generation', () => {
  it('names the mapped roles and how to get out of the state', async () => {
    const { assertDefaultDocWrites } = await import('../cli/shared-doc-roles.mjs');
    const mapped = { docs: { roles: { architecture: 'docs/canonical/ARCHITECTURE.md' } } };
    assert.deepEqual(mappedRoleNames(mapped), ['architecture']);
    assert.deepEqual([...mappedDefaultPaths(mapped)], ['docs-canonical/ARCHITECTURE.md']);
    assert.throws(() => assertDefaultDocWrites(mapped), error => {
      assert.match(error.message, /architecture/);
      assert.match(error.message, /remove docs\.roles/);
      return true;
    });
    assert.doesNotThrow(() => assertDefaultDocWrites({ docs: { roles: { architecture: 'docs-canonical/ARCHITECTURE.md' } } }));
    assert.deepEqual(mappedRoleNames({}), []);
  });

  it('still blocks the generating commands', () => {
    const source = readFileSync(resolve('cli/docguard.mjs'), 'utf8');
    assert.match(source, /command === 'setup' \|\| command === 'diagnose' && flags\.auto\) assertDefaultDocWrites/);
    assert.doesNotMatch(source, /\['init', 'setup'\]\.includes\(command\)/);
    assert.match(readFileSync(resolve('cli/commands/init.mjs'), 'utf8'), /assertDefaultDocWrites\(config\);\n    const \{ runSetup \}/,
      'init --wizard dispatches to the generating wizard and must keep the guard');
  });
});

describe('project type is decided in one place', () => {
  it('detects a Cloudflare Worker from any wrangler config spelling', t => {
    for (const name of ['wrangler.toml', 'wrangler.json', 'wrangler.jsonc']) {
      const dir = scratch(t, d => {
        writeFileSync(join(d, name), name.endsWith('toml') ? 'name = "w"\n' : '{ "name": "w" }\n');
        writeFileSync(join(d, 'package.json'), '{"name":"w","main":"src/index.ts"}\n');
      });
      assert.equal(autoDetectProjectType(dir), 'api', `${name} must type the project as api`);
    }
  });

  it('gives a Worker the api knobs rather than the library ones', t => {
    const dir = scratch(t, d => {
      writeFileSync(join(d, 'wrangler.jsonc'), '{ "name": "w" }\n');
      writeFileSync(join(d, 'package.json'), '{"name":"w","main":"src/index.ts"}\n');
      mkdirSync(join(d, 'docs-canonical'), { recursive: true });
      for (const role of ['ARCHITECTURE', 'DATA-MODEL']) writeFileSync(join(d, 'docs-canonical', `${role}.md`), `# ${role}\n`);
    });
    assert.equal(init(dir).status, 0);
    const written = config(dir);
    assert.equal(written.projectType, 'api');
    assert.equal(written.projectTypeConfig.needsEnvVars, true);
    assert.equal(written.projectTypeConfig.needsDatabase, true);
  });

  it('lets a detected end-to-end suite outrank the type default', t => {
    const dir = scratch(t, d => {
      writeFileSync(join(d, 'wrangler.jsonc'), '{ "name": "w" }\n');
      writeFileSync(join(d, 'package.json'), '{"name":"w","main":"src/index.ts"}\n');
      mkdirSync(join(d, 'tests/e2e'), { recursive: true });
      writeFileSync(join(d, 'tests/e2e/smoke.spec.ts'), '// e2e\n');
    });
    assert.equal(hasE2ESuite(dir), true);
    assert.equal(init(dir).status, 0);
    assert.equal(config(dir).projectTypeConfig.needsE2E, true,
      'api defaults to needsE2E false, but a suite on disk is evidence');
    const bare = scratch(t, d => writeFileSync(join(d, 'package.json'), '{"name":"x"}\n'));
    assert.equal(hasE2ESuite(bare), false);
  });

  it('keeps exactly one detector, so the copies cannot drift apart again', () => {
    for (const file of ['cli/commands/init.mjs', 'cli/commands/setup.mjs']) {
      assert.doesNotMatch(readFileSync(resolve(file), 'utf8'), /function detectProjectType\s*\(/,
        `${file} must use the shared detector, not a private copy`);
    }
    assert.match(readFileSync(resolve('cli/config.mjs'), 'utf8'), /export function autoDetectProjectType/);
  });
});
