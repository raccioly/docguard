import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evaluateReleaseCandidate,
  evaluateReleaseJobs,
  RELEASE_PATH_ALLOWLIST,
} from '../cli/release-pr-policy.mjs';

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
const liveProbe = JSON.parse(readFileSync(new URL('./fixtures/release-workflow-probe.json', import.meta.url), 'utf8'));

describe('scheduled release workflow', () => {
  it('uses only the ephemeral repository token and explicitly dispatches CI', () => {
    assert.match(workflow, /permissions:\n  actions: write\n  contents: write\n  pull-requests: write\n/);
    assert.match(workflow, /gh pr create/);
    assert.match(workflow, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
    assert.doesNotMatch(workflow, /RELEASE_PR_TOKEN|personal access token|private key/i);
    assert.match(workflow, /gh workflow run ci\.yml --ref "\$BRANCH"/);
    assert.match(workflow, /gh workflow run release\.yml --ref main/);
    assert.match(workflow, /gh pr list[\s\S]*--head "\$BRANCH"[\s\S]*--state open/);
    assert.match(workflow, /git merge-base --is-ancestor HEAD "origin\/\$BRANCH"/);
    assert.match(workflow, /git ls-remote --exit-code --heads origin "\$BRANCH"/);
    assert.match(workflow, /concurrency:\n  group: scheduled-release\n  cancel-in-progress: false/);
    assert.match(release, /concurrency:\n  group: docguard-release\n  cancel-in-progress: false/);
  });

  it('recognizes authenticated release PRs by constrained branch, title, repository, and files', () => {
    assert.match(autoMerge, /pr\.head\.repo\.full_name === `\$\{owner\}\/\$\{repo\}`/);
    assert.match(autoMerge, /\^release\\\/v\\d\+\\\.\\d\+\\\.\\d\+\$/);
    assert.match(autoMerge, /\^release: v\\d\+\\\.\\d\+\\\.\\d\+ — automated weekly batch\$/);
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
    assert.match(autoMerge, /release-pr-policy\.mjs/);
    assert.match(autoMerge, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
    assert.match(autoMerge, /persist-credentials: false/);
    assert.match(autoMerge, /run\.event === 'workflow_dispatch'/);
    assert.match(autoMerge, /run_id: run\.id/);
    assert.match(autoMerge, /workflow_id: 'release\.yml'/);
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

  it('pins third-party actions to reviewed commit SHAs', () => {
    const uses = [...workflow.matchAll(/uses:\s*([^@\s]+)@([^\s]+)/g)];
    assert.deepEqual(uses.map(([, action]) => action), ['actions/checkout', 'actions/setup-node']);
    for (const [, , revision] of uses) assert.match(revision, /^[a-f0-9]{40}$/);
    assert.equal(uses[0][2], '3d3c42e5aac5ba805825da76410c181273ba90b1');
    assert.equal(uses[1][2], '820762786026740c76f36085b0efc47a31fe5020');
  });

  it('retains evidence that the live dispatch gate fails closed for a non-release PR', () => {
    assert.equal(liveProbe.schemaVersion, 1);
    assert.equal(liveProbe.repository, 'raccioly/docguard');
    assert.equal(liveProbe.pullRequest.number, 372);
    assert.equal(liveProbe.pullRequest.state, 'CLOSED');
    assert.equal(liveProbe.pullRequest.merged, false);
    assert.equal(liveProbe.pullRequest.branchDeleted, true);
    assert.match(liveProbe.candidateHeadSha, /^[a-f0-9]{40}$/);

    assert.equal(liveProbe.ci.event, 'workflow_dispatch');
    assert.equal(liveProbe.ci.conclusion, 'success');
    assert.equal(liveProbe.ci.headSha, liveProbe.candidateHeadSha);
    assert.deepEqual(liveProbe.ci.nodeVersions, [18, 20, 22, 24]);
    assert.equal(liveProbe.ci.url, `https://github.com/raccioly/docguard/actions/runs/${liveProbe.ci.runId}`);

    assert.equal(liveProbe.gate.event, 'workflow_run');
    assert.equal(liveProbe.gate.conclusion, 'success');
    assert.equal(liveProbe.gate.decision, 'refused_non_release');
    assert.equal(liveProbe.gate.triggeringRunId, liveProbe.ci.runId);
    assert.match(liveProbe.gate.trustedPolicySha, /^[a-f0-9]{40}$/);
    assert.equal(liveProbe.gate.url, `https://github.com/raccioly/docguard/actions/runs/${liveProbe.gate.runId}`);
    assert.match(liveProbe.gate.logEvidence, /not a release PR.+cannot auto-merge it/);
  });
});
