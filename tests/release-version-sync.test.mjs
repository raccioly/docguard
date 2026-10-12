/**
 * @req docguard.release-readiness#FR-003
 * @req docguard.spec-kit-integration-honesty#FR-005
 * @req docguard.release-cut-green#FR-003
 * @req docguard.docs-verification-findings#FR-005
 * @req docguard.volatile-anchor-lines#FR-006
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { syncReleaseVersion } from '../.github/scripts/sync-release-version.mjs';
import { computeLinks } from '../cli/scanners/anchors.mjs';

function write(root, relPath, content) {
  const fullPath = join(root, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function fixture({ brokenTemplate = false, agentMirrors = false } = {}) {
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
  write(root, 'extensions/spec-kit-docguard/commands/guard.md', '# Guard\n\nOtherwise run `npx --yes docguard-cli@0.37.0`.\n');
  write(root, 'commands/docguard.guard.md', '# Guard\n\nOtherwise run `npx --yes docguard-cli@0.37.0`.\n');
  write(root, 'README.md', 'uses: raccioly/docguard@v0.12.0\nuses: raccioly/docguard@v0.30.0\nReleased in v0.37.0.\n    - repo: https://github.com/raccioly/docguard\n      rev: v0.29.0\n');
  write(root, '.pre-commit-hooks.yaml', '#         rev: v0.29.0\n- id: docguard-guard\n#         rev: v0.29.0\n');
  write(root, 'templates/ci/gitlab-component.yml', [
    '#       - component: gitlab.com/raccioly/docguard-component/docguard@0.29.0',
    '#       - remote: https://raw.githubusercontent.com/raccioly/docguard/v0.29.0/templates/ci/gitlab-component.yml',
    "      default: '0.29.0'", '',
  ].join('\n'));
  write(root, 'docs/ai-integration.md', '- uses: raccioly/docguard@v0.12.0\n');
  write(root, 'action.yml', "    - name: Install DocGuard\n      env:\n        DOCGUARD_RELEASED_VERSION: '0.37.0'\n");
  write(root, 'CHANGELOG.md', 'Released v0.37.0 remains historical.\n');
  if (agentMirrors) {
    // A stale skill mirror, a stale command mirror, and no mirror yet for docguard-sync.
    write(root, '.agent/skills/docguard-guard/SKILL.md', 'stale skill\n');
    write(root, '.agent/commands/docguard.guard.md', '# Guard\n\nOtherwise run `npx --yes docguard-cli@0.30.0`.\n');
  }
  return root;
}

describe('release version synchronization', () => {
  it('updates every active publication surface and leaves history untouched', () => {
    const root = fixture();
    try {
      const result = syncReleaseVersion(root);
      assert.equal(result.version, '9.8.7');
      // docguard.spec-kit-integration-honesty#FR-005: command files move their pin too.
      // docguard.docs-verification-findings#FR-005: pre-commit and GitLab examples move too.
      assert.equal(result.changed.length, 15);
      assert.ok(result.changed.includes('.pre-commit-hooks.yaml'));
      assert.ok(result.changed.includes('templates/ci/gitlab-component.yml'));
      assert.equal(readFileSync(join(root, '.pre-commit-hooks.yaml'), 'utf8'), '#         rev: v9.8.7\n- id: docguard-guard\n#         rev: v9.8.7\n');
      const gitlab = readFileSync(join(root, 'templates/ci/gitlab-component.yml'), 'utf8');
      assert.match(gitlab, /docguard-component\/docguard@9\.8\.7/);
      assert.match(gitlab, /raccioly\/docguard\/v9\.8\.7\//);
      assert.match(gitlab, /default: '9\.8\.7'/);
      assert.ok(result.changed.includes('extensions/spec-kit-docguard/commands/guard.md'));
      assert.ok(result.changed.includes('commands/docguard.guard.md'));
      // Copyable Action examples move; prose history in the same file does not.
      assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), 'uses: raccioly/docguard@v9.8.7\nuses: raccioly/docguard@v9.8.7\nReleased in v0.37.0.\n    - repo: https://github.com/raccioly/docguard\n      rev: v9.8.7\n');
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

  it('writes the .agent mirrors from the synchronized sources (docguard.release-cut-green#FR-003)', () => {
    const root = fixture({ agentMirrors: true });
    try {
      const result = syncReleaseVersion(root);
      for (const name of ['docguard-guard', 'docguard-sync']) {
        const source = readFileSync(join(root, `extensions/spec-kit-docguard/skills/${name}/SKILL.md`), 'utf8');
        assert.match(source, /docguard:version: 9\.8\.7/);
        assert.equal(readFileSync(join(root, `.agent/skills/${name}/SKILL.md`), 'utf8'), source, `${name} mirror`);
        assert.ok(result.changed.includes(`.agent/skills/${name}/SKILL.md`));
      }
      const command = readFileSync(join(root, 'commands/docguard.guard.md'), 'utf8');
      assert.equal(readFileSync(join(root, '.agent/commands/docguard.guard.md'), 'utf8'), command);
      assert.match(command, /docguard-cli@9\.8\.7/);
      assert.equal(result.changed.length, 18);
      assert.equal(existsSync(join(root, '.agent/skills/docguard-guard/SKILL.md.bak')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a docguard:volatile marker on the lines it rewrites, so tagged release files keep their anchors (docguard.volatile-anchor-lines#FR-006)', () => {
    for (const marked of [true, false]) {
      const root = fixture();
      try {
        const mark = marked ? ' # docguard:volatile' : '';
        write(root, 'specs/001-ci/spec.md', '# CI\n\n**Spec ID**: `acme.ci`\n\n- **FR-001**: Action.\n- **FR-002**: Extension.\n');
        write(root, 'action.yml', `# @implements acme.ci#FR-001\nruns:\n  steps:\n    - name: Install DocGuard\n      env:\n        DOCGUARD_RELEASED_VERSION: '0.37.0'${mark}\n`);
        write(root, 'extensions/spec-kit-docguard/extension.yml', `# @implements acme.ci#FR-002\nextension:\n  id: "docguard"\n  version: "0.37.0"${mark}\n`);
        const fps = () => computeLinks(root, {}, { noCache: true }).links
          .filter(l => l.file === 'action.yml' || l.file === 'extensions/spec-kit-docguard/extension.yml')
          .map(l => `${l.file} ${l.exact} ${l.floor}`).sort();
        const before = fps();
        assert.equal(before.length, 2);
        syncReleaseVersion(root);
        assert.match(readFileSync(join(root, 'action.yml'), 'utf8'), new RegExp(`DOCGUARD_RELEASED_VERSION: '9\\.8\\.7'${marked ? ' # docguard:volatile' : '\\n'}`));
        assert.match(readFileSync(join(root, 'extensions/spec-kit-docguard/extension.yml'), 'utf8'), new RegExp(`version: "9\\.8\\.7"${marked ? ' # docguard:volatile' : '\\n'}`));
        if (marked) assert.deepEqual(fps(), before, 'a marked release line keeps both anchors');
        else assert.notDeepEqual(fps(), before, 'control: without the marker the release changes both anchors');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('leaves the mirrors untouched when synchronization fails', () => {
    const root = fixture({ brokenTemplate: true, agentMirrors: true });
    try {
      assert.throws(() => syncReleaseVersion(root));
      assert.equal(readFileSync(join(root, '.agent/skills/docguard-guard/SKILL.md'), 'utf8'), 'stale skill\n');
      assert.equal(existsSync(join(root, '.agent/skills/docguard-sync/SKILL.md')), false);
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
