import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  evaluateReleaseCandidate,
  evaluateReleaseJobs,
  RELEASE_PATH_ALLOWLIST,
} from '../cli/release-pr-policy.mjs';
import { validateReleaseWorkspace } from '../.github/scripts/validate-release-candidate.mjs';

/**
 * @req docguard.tokenless-scheduled-releases#FR-001
 * @req docguard.tokenless-scheduled-releases#FR-002
 * @req docguard.tokenless-scheduled-releases#FR-003
 * @req docguard.tokenless-scheduled-releases#FR-004
 * @req docguard.tokenless-scheduled-releases#FR-005
 * @req docguard.tokenless-scheduled-releases#FR-006
 * @req docguard.tokenless-scheduled-releases#FR-007
 * @req docguard.tokenless-scheduled-releases#FR-008
 * @req docguard.tokenless-scheduled-releases#FR-009
 * @req docguard.tokenless-scheduled-releases#FR-010
 * @req docguard.tokenless-scheduled-releases#FR-011
 * @req docguard.tokenless-scheduled-releases#FR-012
 * @req docguard.tokenless-scheduled-releases#SC-001
 * @req docguard.tokenless-scheduled-releases#SC-002
 * @req docguard.tokenless-scheduled-releases#SC-003
 * @req docguard.tokenless-scheduled-releases#SC-004
 */

const workflow = readFileSync(new URL('../.github/workflows/scheduled-release.yml', import.meta.url), 'utf8');
const autoMerge = readFileSync(new URL('../.github/workflows/auto-merge.yml', import.meta.url), 'utf8');
const release = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const validator = readFileSync(new URL('../.github/scripts/validate-release-candidate.mjs', import.meta.url), 'utf8');

describe('scheduled release workflow', () => {
  it('uses only the ephemeral repository token and arms protected native auto-merge', () => {
    assert.match(workflow, /permissions:\n  actions: write\n  contents: write\n  pull-requests: write\n/);
    assert.match(workflow, /gh pr create/);
    assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
    assert.doesNotMatch(workflow, /secrets\.(RELEASE_PR_TOKEN|APP_PRIVATE_KEY|GH_PAT)/);
    assert.doesNotMatch(workflow, /gh workflow run ci\.yml --ref "\$BRANCH"/);
    assert.match(workflow, /Approve workflows to run/);
    assert.match(workflow, /ordinary pull-request CI then satisfies branch protection/);
    assert.match(workflow, /gh pr merge --auto --squash "\$PR_URL"/);
    assert.match(workflow, /gh pr merge --auto --squash "\$EXISTING"/);
    assert.match(workflow, /validate-release-candidate\.mjs/);
    assert.match(workflow, /gh workflow run release\.yml --ref main/);
    assert.match(workflow, /wait_for_merge_and_publish/);
    assert.match(workflow, /seq 1 40/);
    assert.match(workflow, /hourly tag-driven release sweep/);
    assert.match(workflow, /gh pr list[\s\S]*--head "\$BRANCH"[\s\S]*--state open/);
    assert.match(workflow, /git merge-base --is-ancestor HEAD "origin\/\$BRANCH"/);
    assert.match(workflow, /git ls-remote --exit-code --heads origin "\$BRANCH"/);
    assert.match(workflow, /concurrency:\n  group: scheduled-release\n  cancel-in-progress: false/);
    assert.match(release, /concurrency:\n  group: docguard-release\n  cancel-in-progress: false/);
    assert.match(release, /schedule:\n[\s\S]*cron: '17 \* \* \* \*'/);
  });

  it('prevalidates release identity, synchronized versions, and changed paths before push', () => {
    for (const path of [
      'package.json', 'package-lock.json', 'pyproject.toml', 'server.json', 'CHANGELOG.md',
      'templates/ci/github-actions.yml',
      'extensions/spec-kit-docguard/extension.yml',
      'extensions/spec-kit-docguard/templates/github-workflows/docguard-guard.yml',
      'extensions/spec-kit-docguard/templates/github-workflows/docguard-autofix.yml',
      'extensions/spec-kit-docguard/skills/docguard-guard/SKILL.md',
      '.agent/skills/docguard-sync/SKILL.md',
    ]) assert.ok(RELEASE_PATH_ALLOWLIST.test(path), `release allowlist rejected ${path}`);
    for (const path of [
      'extensions/spec-kit-docguard/scripts/bash/publish.sh',
      'extensions/spec-kit-docguard/commands/docguard.guard.md',
      '.agent/settings.json',
      'templates/SECURITY.md.template',
      '.github/workflows/release.yml',
    ]) assert.equal(RELEASE_PATH_ALLOWLIST.test(path), false, `release allowlist admitted ${path}`);
    assert.match(validator, /evaluateReleaseCandidate/);
    assert.match(validator, /execFileSync\('git', \['diff', '--name-only', 'HEAD', '--'\]/);
    assert.match(validator, /author: 'github-actions\[bot\]'/);
    assert.match(validator, /tagExists: false/);
    assert.match(release, /push:\n    branches: \[main\][\s\S]*package\.json/);
  });

  it('accepts only exact next-version release metadata', () => {
    const base = {
      repository: 'raccioly/docguard',
      headRepo: 'raccioly/docguard',
      defaultBranch: 'main',
      baseRef: 'main',
      headRef: 'release/v0.40.1',
      title: 'release: v0.40.1 — automated weekly batch',
      author: 'github-actions[bot]',
      baseVersion: '0.40.0',
      paths: ['package.json', 'package-lock.json', 'pyproject.toml', 'server.json', 'CHANGELOG.md', 'extensions/spec-kit-docguard/extension.yml'],
      files: {
        packageJson: '{"version":"0.40.1"}',
        packageLock: '{"version":"0.40.1","packages":{"":{"version":"0.40.1"}}}',
        pyproject: 'version = "0.40.1"',
        server: '{"version":"0.40.1"}',
        extension: '  version: "0.40.1"',
      },
      tagExists: false,
    };
    assert.deepEqual(evaluateReleaseCandidate(base), { ok: true, version: '0.40.1', errors: [] });
    const minor = structuredClone(base);
    minor.headRef = 'release/v0.41.0';
    minor.title = 'release: v0.41.0 — automated weekly batch';
    for (const key of Object.keys(minor.files)) minor.files[key] = minor.files[key].replaceAll('0.40.1', '0.41.0');
    assert.equal(evaluateReleaseCandidate(minor).ok, true);

    for (const mutate of [
      value => { value.author = 'raccioly'; },
      value => { value.headRepo = 'attacker/docguard'; },
      value => { value.baseRef = 'develop'; },
      value => { value.title = 'release: v0.40.2 — automated weekly batch'; },
      value => { value.files.server = '{"version":"0.39.0"}'; },
      value => { value.files.packageLock = '{"version":"0.40.1","packages":{}}'; },
      value => { value.paths.push('.github/workflows/release.yml'); },
      value => { value.tagExists = true; },
      value => {
        value.headRef = 'release/v0.40.2';
        value.title = 'release: v0.40.2 — automated weekly batch';
        for (const key of Object.keys(value.files)) value.files[key] = value.files[key].replaceAll('0.40.1', '0.40.2');
      },
    ]) {
      const candidate = structuredClone(base);
      mutate(candidate);
      assert.equal(evaluateReleaseCandidate(candidate).ok, false, JSON.stringify(candidate));
    }
  });

  it('validates the real workspace diff and rejects an unexpected path', () => {
    const root = mkdtempSync(join(tmpdir(), 'docguard-release-candidate-'));
    const writeVersion = version => {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
      writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ version, packages: { '': { version } } }));
      writeFileSync(join(root, 'pyproject.toml'), `[project]\nversion = "${version}"\n`);
      writeFileSync(join(root, 'server.json'), JSON.stringify({ version }));
      writeFileSync(join(root, 'extensions/spec-kit-docguard/extension.yml'), `extension:\n  version: "${version}"\n`);
      writeFileSync(join(root, 'CHANGELOG.md'), `## [${version}]\n`);
    };
    try {
      mkdirSync(join(root, 'extensions/spec-kit-docguard'), { recursive: true });
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['config', 'user.name', 'DocGuard Test'], { cwd: root });
      execFileSync('git', ['config', 'user.email', 'test@docguard.local'], { cwd: root });
      writeVersion('0.40.0');
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
      writeVersion('0.40.1');

      const result = validateReleaseWorkspace({
        root,
        baseVersion: '0.40.0',
        branch: 'release/v0.40.1',
        repository: 'raccioly/docguard',
      });
      assert.equal(result.version, '0.40.1');
      assert.ok(result.paths.includes('package.json'));

      writeFileSync(join(root, 'cli.mjs'), 'unexpected');
      execFileSync('git', ['add', 'cli.mjs'], { cwd: root });
      assert.throws(() => validateReleaseWorkspace({
        root,
        baseVersion: '0.40.0',
        branch: 'release/v0.40.1',
        repository: 'raccioly/docguard',
      }), /paths: unexpected cli\.mjs/);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  it('binds the merge decision to one successful job for every required runtime', () => {
    const jobs = [18, 20, 22, 24].map(version => ({ name: `test (${version})`, status: 'completed', conclusion: 'success' }));
    assert.deepEqual(evaluateReleaseJobs(jobs), { ok: true, errors: [] });
    assert.equal(evaluateReleaseJobs(jobs.slice(1)).ok, false);
    assert.equal(evaluateReleaseJobs([...jobs, jobs[0]]).ok, false);
    assert.equal(evaluateReleaseJobs(jobs.map((job, index) => index ? job : { ...job, conclusion: 'failure' })).ok, false);
  });

  it('retains the release matrix, tests, self-guard, and supply-chain workflow', () => {
    assert.match(ci, /node-version: \[18, 20, 22, 24\]/);
    assert.match(ci, /node --test --test-reporter=tap tests\/\*\.test\.mjs/);
    assert.match(ci, /node cli\/docguard\.mjs guard --format json/);
    assert.match(release, /node-version: \[18, 20, 22, 24\]/);
    assert.match(readFileSync(new URL('../.github/workflows/supply-chain.yml', import.meta.url), 'utf8'), /osv-scanner/);
  });

  it('keeps the privileged workflow-run gate scoped to Dependabot and Jules', () => {
    assert.match(autoMerge, /github\.event\.workflow_run\.event == 'pull_request'/);
    assert.match(autoMerge, /dependabot\[bot\]/);
    assert.match(autoMerge, /google-labs-jules\[bot\]/);
    assert.match(autoMerge, /persist-credentials: false/);
    assert.doesNotMatch(autoMerge, /releaseShape|release\\\/v|createWorkflowDispatch/);
  });

  it('pins third-party actions to reviewed commit SHAs', () => {
    const uses = [...workflow.matchAll(/uses:\s*([^@\s]+)@([^\s]+)/g)];
    assert.deepEqual(uses.map(([, action]) => action), ['actions/checkout', 'actions/setup-node']);
    for (const [, , revision] of uses) assert.match(revision, /^[a-f0-9]{40}$/);
    assert.equal(uses[0][2], '3d3c42e5aac5ba805825da76410c181273ba90b1');
    assert.equal(uses[1][2], '820762786026740c76f36085b0efc47a31fe5020');
  });

});
