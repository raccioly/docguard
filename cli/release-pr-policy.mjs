/**
 * Pure policy for privileged release pull-request evaluation.
 *
 * @implements docguard.tokenless-scheduled-releases#FR-005
 * @implements docguard.tokenless-scheduled-releases#FR-006
 * @implements docguard.tokenless-scheduled-releases#FR-007
 * @implements docguard.tokenless-scheduled-releases#FR-008
 * @implements docguard.tokenless-scheduled-releases#FR-011
 */

export const REQUIRED_RELEASE_JOBS = Object.freeze([
  'test (18)',
  'test (20)',
  'test (22)',
  'test (24)',
]);

export const RELEASE_PATH_ALLOWLIST = /^(package(-lock)?\.json|pyproject\.toml|server\.json|CHANGELOG\.md|templates\/ci\/github-actions\.yml|extensions\/spec-kit-docguard\/(extension\.yml|templates\/github-workflows\/(docguard-guard|docguard-autofix)\.yml|skills\/docguard-(fix|guard|review|score|sync)\/SKILL\.md)|\.agent\/skills\/docguard-(fix|guard|review|score|sync)\/SKILL\.md|llms(-full)?\.txt)$/;

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value || '');
  return match ? match.slice(1).map(Number) : null;
}

function nextAllowed(base, candidate) {
  if (!base || !candidate || candidate[0] !== base[0]) return false;
  const nextPatch = candidate[1] === base[1] && candidate[2] === base[2] + 1;
  const nextMinor = candidate[1] === base[1] + 1 && candidate[2] === 0;
  return nextPatch || nextMinor;
}

function parseJson(text, label, errors) {
  try {
    return JSON.parse(text);
  } catch {
    errors.push(`${label}: invalid JSON`);
    return {};
  }
}

function extractVersions(files, errors) {
  const pkg = parseJson(files.packageJson, 'package.json', errors);
  const lock = parseJson(files.packageLock, 'package-lock.json', errors);
  const server = parseJson(files.server, 'server.json', errors);
  const python = /^version\s*=\s*["']([^"']+)["']/m.exec(files.pyproject || '')?.[1];
  const extension = /^  version:\s*["']([^"']+)["']/m.exec(files.extension || '')?.[1];
  return {
    package: pkg.version,
    lock: lock.version,
    lockPackage: lock.packages?.['']?.version,
    python,
    server: server.version,
    extension,
  };
}

export function evaluateReleaseCandidate(input) {
  const errors = [];
  const branchMatch = /^release\/v(\d+\.\d+\.\d+)$/.exec(input.headRef || '');
  const titleMatch = /^release: v(\d+\.\d+\.\d+) — automated weekly batch$/.exec(input.title || '');
  const branchVersion = branchMatch?.[1];
  const titleVersion = titleMatch?.[1];

  if (input.headRepo !== input.repository) errors.push('head repository: mismatch');
  if (input.baseRef !== input.defaultBranch) errors.push('base branch: mismatch');
  if (input.author !== 'github-actions[bot]') errors.push('author: must be github-actions[bot]');
  if (!branchVersion) errors.push('head branch: invalid release branch');
  if (!titleVersion) errors.push('title: invalid automated release title');

  const unexpectedPaths = (input.paths || []).filter(path => !RELEASE_PATH_ALLOWLIST.test(path));
  if (unexpectedPaths.length) errors.push(`paths: unexpected ${unexpectedPaths.join(', ')}`);
  if (!(input.paths || []).includes('package.json')) errors.push('paths: package.json is required');
  if (!(input.paths || []).includes('CHANGELOG.md')) errors.push('paths: CHANGELOG.md is required');

  const versions = extractVersions(input.files || {}, errors);
  const candidateVersion = versions.package;
  for (const [surface, value] of Object.entries(versions)) {
    if (!value) errors.push(`${surface}: missing version`);
    else if (candidateVersion && value !== candidateVersion) errors.push(`${surface}: version mismatch`);
  }
  if (branchVersion && candidateVersion && branchVersion !== candidateVersion) errors.push('branch: version mismatch');
  if (titleVersion && candidateVersion && titleVersion !== candidateVersion) errors.push('title: version mismatch');
  if (!nextAllowed(parseVersion(input.baseVersion), parseVersion(candidateVersion))) {
    errors.push('version: must be the next patch or next minor');
  }
  if (input.tagExists) errors.push('tag: release already exists');

  return { ok: errors.length === 0, version: candidateVersion || branchVersion || null, errors };
}

export function evaluateReleaseJobs(jobs) {
  const errors = [];
  for (const name of REQUIRED_RELEASE_JOBS) {
    const matches = (jobs || []).filter(job => job.name === name);
    if (matches.length !== 1) {
      errors.push(`${name}: expected one job, found ${matches.length}`);
      continue;
    }
    const [job] = matches;
    if (job.status !== 'completed' || job.conclusion !== 'success') {
      errors.push(`${name}: ${job.status || 'unknown'}/${job.conclusion || 'unknown'}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
