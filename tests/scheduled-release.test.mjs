import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/scheduled-release.yml', import.meta.url), 'utf8');
const autoMerge = readFileSync(new URL('../.github/workflows/auto-merge.yml', import.meta.url), 'utf8');

describe('scheduled release workflow', () => {
  it('grants exactly the write scopes required by its release PR flow', () => {
    assert.match(workflow, /permissions:\n  contents: write\n  pull-requests: write\n/);
    assert.doesNotMatch(workflow, /\n  actions: write\n/);
    assert.match(workflow, /gh pr create/);
    assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.RELEASE_PR_TOKEN \}\}/);
    assert.match(workflow, /if \[ -z "\$RELEASE_PR_TOKEN" \]/);
    assert.doesNotMatch(workflow, /gh workflow run ci\.yml/);
  });

  it('recognizes authenticated release PRs by constrained branch, title, repository, and files', () => {
    assert.match(autoMerge, /pr\.head\.repo\.full_name === `\$\{owner\}\/\$\{repo\}`/);
    assert.match(autoMerge, /\^release\\\/v\\d\+\\\.\\d\+\\\.\\d\+\$/);
    assert.match(autoMerge, /\^release: v\\d\+\\\.\\d\+\\\.\\d\+ — automated weekly batch\$/);
    const source = autoMerge.match(/const ALLOWED = \/(.+)\/;/)?.[1];
    assert.ok(source, 'release path allowlist must remain explicit');
    const allowed = new RegExp(source);
    for (const path of [
      'package.json', 'package-lock.json', 'pyproject.toml', 'server.json', 'CHANGELOG.md',
      'templates/ci/github-actions.yml',
      'extensions/spec-kit-docguard/extension.yml',
      'extensions/spec-kit-docguard/templates/github-workflows/docguard-guard.yml',
      'extensions/spec-kit-docguard/templates/github-workflows/docguard-autofix.yml',
      'extensions/spec-kit-docguard/skills/docguard-guard/SKILL.md',
      '.agent/skills/docguard-sync/SKILL.md',
    ]) assert.ok(allowed.test(path), `release allowlist rejected ${path}`);
    for (const path of [
      'extensions/spec-kit-docguard/scripts/bash/publish.sh',
      'extensions/spec-kit-docguard/commands/docguard.guard.md',
      '.agent/settings.json',
      'templates/SECURITY.md.template',
      '.github/workflows/release.yml',
    ]) assert.equal(allowed.test(path), false, `release allowlist admitted ${path}`);
    assert.match(autoMerge, /const unexpected = paths\.filter/);
  });

  it('pins third-party actions to reviewed commit SHAs', () => {
    const uses = [...workflow.matchAll(/uses:\s*([^@\s]+)@([^\s]+)/g)];
    assert.deepEqual(uses.map(([, action]) => action), ['actions/checkout', 'actions/setup-node']);
    for (const [, , revision] of uses) assert.match(revision, /^[a-f0-9]{40}$/);
    assert.equal(uses[0][2], '3d3c42e5aac5ba805825da76410c181273ba90b1');
    assert.equal(uses[1][2], '820762786026740c76f36085b0efc47a31fe5020');
  });
});
