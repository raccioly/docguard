#!/usr/bin/env node

/**
 * Validate the scheduler-generated release diff before it leaves the trusted
 * default-branch checkout. GitHub's native auto-merge then enforces the
 * repository's required pull-request checks on every candidate revision.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateReleaseCandidate } from '../../cli/release-pr-policy.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);

function read(root, path) {
  return readFileSync(resolve(root, path), 'utf8');
}

export function validateReleaseWorkspace({
  root = process.cwd(),
  baseVersion,
  branch,
  repository,
  defaultBranch = 'main',
}) {
  const paths = execFileSync('git', ['diff', '--name-only', 'HEAD', '--'], {
    cwd: root,
    encoding: 'utf8',
  }).trim().split('\n').filter(Boolean);
  const version = JSON.parse(read(root, 'package.json')).version;
  const result = evaluateReleaseCandidate({
    repository,
    headRepo: repository,
    defaultBranch,
    baseRef: defaultBranch,
    headRef: branch,
    title: `release: v${version} — automated weekly batch`,
    author: 'github-actions[bot]',
    baseVersion,
    paths,
    files: {
      packageJson: read(root, 'package.json'),
      packageLock: read(root, 'package-lock.json'),
      pyproject: read(root, 'pyproject.toml'),
      server: read(root, 'server.json'),
      extension: read(root, 'extensions/spec-kit-docguard/extension.yml'),
    },
    tagExists: false,
  });
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return { version: result.version, paths };
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    const result = validateReleaseWorkspace({
      baseVersion: valueAfter('--base-version'),
      branch: valueAfter('--branch'),
      repository: process.env.GITHUB_REPOSITORY,
    });
    console.log(`Validated v${result.version} release candidate (${result.paths.length} changed files).`);
  } catch (error) {
    console.error(`Release candidate validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
