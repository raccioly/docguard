/**
 * @req docguard.release-readiness#FR-003
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { syncReleaseVersion } from '../.github/scripts/sync-release-version.mjs';

function write(root, relPath, content) {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function fixture({ brokenTemplate = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'docguard-release-version-'));
  write(root, 'package.json', '{"name":"docguard-cli","version":"9.8.7"}\n');
  write(root, 'pyproject.toml', '[project]\nname = "docguard-cli"\nversion = "0.37.0"\n');
  write(root, 'server.json', `${JSON.stringify({
    name: 'io.github.raccioly/docguard', version: '0.37.0',
    packages: [{ registryType: 'npm', identifier: 'docguard-cli', version: '0.37.0' }],
  }, null, 2)}\n`);
  write(root, 'extensions/spec-kit-docguard/extension.yml', 'extension:\n  id: "docguard"\n  version: "0.37.0"\n');
  write(root, 'templates/ci/github-actions.yml', brokenTemplate ? 'no package pin\n' : 'run: npm install docguard-cli@0.37.0\n');
  write(root, 'extensions/spec-kit-docguard/templates/github-workflows/docguard-guard.yml', 'run: npm install docguard-cli@0.37.0\n');
  write(root, 'extensions/spec-kit-docguard/templates/github-workflows/docguard-autofix.yml', 'uses: raccioly/docguard@v0.37.0\n');
  for (const name of ['docguard-guard', 'docguard-sync']) {
    write(root, `extensions/spec-kit-docguard/skills/${name}/SKILL.md`, [
      '---', 'metadata:', '  author: docguard', '  version: 0.37.0', '---',
      '<!-- docguard:version: 0.37.0 -->', '', '# Skill', '',
    ].join('\n'));
  }
  write(root, 'README.md', 'uses: raccioly/docguard@v0.12.0\nuses: raccioly/docguard@v0.30.0\nReleased in v0.37.0.\n');
  write(root, 'docs/ai-integration.md', '- uses: raccioly/docguard@v0.12.0\n');
  write(root, 'action.yml', "    - name: Install DocGuard\n      env:\n        DOCGUARD_RELEASED_VERSION: '0.37.0'\n");
  write(root, 'CHANGELOG.md', 'Released v0.37.0 remains historical.\n');
  return root;
}

describe('release version synchronization', () => {
  it('updates every active publication surface and leaves history untouched', () => {
    const root = fixture();
    try {
      const result = syncReleaseVersion(root);
      assert.equal(result.version, '9.8.7');
      assert.equal(result.changed.length, 11);
      // Copyable Action examples move; prose history in the same file does not.
      assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), 'uses: raccioly/docguard@v9.8.7\nuses: raccioly/docguard@v9.8.7\nReleased in v0.37.0.\n');
      // docguard.release-readiness#FR-003: a pinned action ref installs its own CLI.
      assert.match(readFileSync(join(root, 'action.yml'), 'utf8'), /DOCGUARD_RELEASED_VERSION: '9\.8\.7'/);
      assert.match(readFileSync(join(root, 'pyproject.toml'), 'utf8'), /version = "9\.8\.7"/);
      const server = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8'));
      assert.equal(server.version, '9.8.7');
      assert.equal(server.packages[0].version, '9.8.7');
      for (const relPath of result.changed.filter(p => p !== 'README.md')) {
        assert.doesNotMatch(readFileSync(join(root, relPath), 'utf8'), /0\.37\.0/);
        assert.equal(existsSync(join(root, `${relPath}.bak`)), false);
      }
      assert.equal(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), 'Released v0.37.0 remains historical.\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails before writing when a required release field is missing', () => {
    const root = fixture({ brokenTemplate: true });
    try {
      const before = readFileSync(join(root, 'pyproject.toml'), 'utf8');
      assert.throws(() => syncReleaseVersion(root), /expected 1 version field, found 0/);
      assert.equal(readFileSync(join(root, 'pyproject.toml'), 'utf8'), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
