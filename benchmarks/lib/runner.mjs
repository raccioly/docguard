/**
 * Disposable benchmark execution with deterministic core results.
 * @implements docguard.precision-evidence-loop#FR-002
 * @implements docguard.precision-evidence-loop#FR-005
 * @implements docguard.precision-evidence-loop#FR-006
 * @implements docguard.precision-evidence-loop#FR-017
 */

import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadBenchmarkManifest, safeRelativePath } from './manifest.mjs';
import { calculateMetrics } from './metrics.mjs';

const BENCHMARK_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(BENCHMARK_ROOT, '..');
const DOCGUARD = resolve(REPO_ROOT, 'cli', 'docguard.mjs');
const PACKAGE = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
const digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function gitRevision() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

function fixtureDigest(root) {
  const hash = createHash('sha256');
  function visit(dir) {
    for (const name of readdirSync(dir).sort()) {
      if (['.git', '.local'].includes(name.toLowerCase())) continue;
      const path = join(dir, name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) throw new Error(`Fixture symlink is not allowed: ${relative(root, path)}`);
      if (info.isDirectory()) visit(path);
      else if (info.isFile()) {
        hash.update(relative(root, path).split(sep).join('/'));
        hash.update('\0');
        hash.update(readFileSync(path));
        hash.update('\0');
      }
    }
  }
  visit(root);
  return `sha256:${hash.digest('hex')}`;
}

function materializeGit(source, destination) {
  const gitOptions = {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  };
  let result = spawnSync('git', ['init', '-q', destination], gitOptions);
  if (result.status !== 0) throw new Error(`git init failed: ${result.stderr.trim()}`);
  result = spawnSync('git', ['remote', 'add', 'origin', source.url], { ...gitOptions, cwd: destination });
  if (result.status !== 0) throw new Error(`git remote add failed: ${result.stderr.trim()}`);
  result = spawnSync('git', ['-c', 'protocol.file.allow=never', 'fetch', '--depth', '1', 'origin', source.revision], {
    ...gitOptions, cwd: destination,
  });
  if (result.status !== 0) throw new Error(`git fetch failed for pinned revision: ${result.stderr.trim()}`);
  result = spawnSync('git', ['checkout', '-q', '--detach', 'FETCH_HEAD'], { ...gitOptions, cwd: destination });
  if (result.status !== 0) throw new Error(`git checkout failed: ${result.stderr.trim()}`);
  const actual = spawnSync('git', ['rev-parse', 'HEAD'], { ...gitOptions, cwd: destination });
  if (actual.status !== 0 || actual.stdout.trim() !== source.revision) throw new Error('Materialized Git revision does not match the manifest pin.');
}

function safeTarget(root, value) {
  const path = resolve(root, safeRelativePath(value));
  const realRoot = realpathSync(root);
  const parent = realpathSync(dirname(path));
  if (!parent.startsWith(`${realRoot}${sep}`) && parent !== realRoot) throw new Error(`Mutation parent escapes repository: ${value}`);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`Mutation target cannot be a symlink: ${value}`);
  return path;
}

export function applyExactMutations(root, mutations) {
  for (const mutation of mutations) {
    const path = safeTarget(root, mutation.path);
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Mutation target is not a regular file: ${mutation.path}`);
    const content = readFileSync(path, 'utf8');
    const occurrences = content.split(mutation.find).length - 1;
    if (occurrences !== mutation.expectedOccurrences) {
      throw new Error(`Mutation precondition failed for ${mutation.path}: expected ${mutation.expectedOccurrences} occurrence(s), found ${occurrences}.`);
    }
    writeFileSync(path, content.split(mutation.find).join(mutation.replace), 'utf8');
  }
}

function normalizeLocation(location) {
  const raw = typeof location === 'string' ? location : location?.file;
  if (!raw) return '<project>';
  return raw.replace(/:\d+(?::\d+)?$/, '').replaceAll('\\', '/').replace(/^\.\//, '');
}

export function findingIdentity(finding) {
  return `${finding.code}@${normalizeLocation(finding.location)}`;
}

function invokeGuard(projectDir) {
  const start = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [DOCGUARD, 'guard', '--dir', projectDir, '--format', 'json'], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
  });
  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
  if (result.error) throw new Error(`Guard invocation failed: ${result.error.message}`);
  if (![0, 1, 2].includes(result.status)) throw new Error(`Guard exited unexpectedly (${result.status}): ${result.stderr.trim()}`);
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error('Guard did not return valid JSON.'); }
  return { report, exitCode: result.status, durationMs };
}

function materializeCase(item, manifestDir, runRoot, sourceCache) {
  const destination = join(runRoot, item.id);
  if (item.source.kind === 'fixture') {
    const source = resolve(manifestDir, item.source.path);
    cpSync(source, destination, { recursive: true, dereference: false, errorOnExist: true });
  } else {
    const cacheKey = `${item.source.url}@${item.source.revision}`;
    let source = sourceCache.get(cacheKey);
    if (!source) {
      source = join(runRoot, '.sources', item.source.revision);
      mkdirSync(dirname(source), { recursive: true });
      materializeGit(item.source, source);
      sourceCache.set(cacheKey, source);
    }
    cpSync(source, destination, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      filter: path => relative(source, path).split(sep)[0] !== '.git',
    });
  }
  applyExactMutations(destination, item.mutations);
  if (item.config) {
    const configPath = join(destination, '.docguard.json');
    if (existsSync(configPath) && lstatSync(configPath).isSymbolicLink()) throw new Error('Benchmark config target cannot be a symlink.');
    writeFileSync(configPath, `${JSON.stringify(item.config, null, 2)}\n`, 'utf8');
  }
  return destination;
}

function caseCore(item, sourceRevision, invocation) {
  const actual = [...new Set((invocation.report.findings || [])
    .filter(finding => item.scope.codes.includes(finding.code))
    .map(findingIdentity))].sort();
  const expected = [...item.expected];
  const unexpected = actual.filter(identity => !expected.includes(identity));
  const missing = expected.filter(identity => !actual.includes(identity));
  const forbiddenObserved = item.forbidden.filter(identity => actual.includes(identity));
  const validator = (invocation.report.validators || []).find(candidate => candidate.key === item.scope.validatorKey);
  const measured = ['defect', 'clean_control'].includes(item.classification);
  const abstained = !validator || ['disabled', 'not-applicable', 'missing-prerequisite', 'unsupported', 'no-matches', 'error']
    .includes(validator.applicability?.status);
  const status = !measured ? item.classification === 'unsupported_syntax' ? 'UNSUPPORTED' : 'ADJUDICATION'
    : abstained || unexpected.length || missing.length || forbiddenObserved.length ? 'FAIL' : 'PASS';
  return {
    id: item.id,
    split: item.split,
    repositoryGroup: item.repositoryGroup,
    causalFamily: item.causalFamily,
    parserTier: item.parserTier,
    classification: item.classification,
    repairOutcome: item.repairOutcome,
    sourceRevision,
    configDigest: digest(JSON.stringify(item.config)),
    scope: item.scope,
    expected,
    forbidden: item.forbidden,
    actual,
    unexpected,
    missing,
    forbiddenObserved,
    abstained,
    applicability: validator?.applicability || { status: 'unknown', reason: 'Validator result was not present.' },
    checkCoverage: validator ? {
      status: validator.status,
      passed: validator.passed,
      total: validator.total,
      quality: validator.quality,
    } : null,
    commandStatus: invocation.report.status,
    status,
  };
}

export function runBenchmark({ manifestPath = resolve(BENCHMARK_ROOT, 'corpus.json'), includeExternal = false, split = null, keep = false } = {}) {
  const absoluteManifest = resolve(manifestPath);
  const manifestText = readFileSync(absoluteManifest, 'utf8');
  const manifest = loadBenchmarkManifest(absoluteManifest);
  const selected = manifest.cases.filter(item => (!split || item.split === split) && (includeExternal || item.source.kind === 'fixture'));
  const runRoot = mkdtempSync(join(tmpdir(), 'docguard-benchmark-'));
  const coreCases = [];
  const observations = [];
  const sourceCache = new Map();
  try {
    for (const item of selected) {
      const sourceRevision = item.source.kind === 'git'
        ? item.source.revision
        : fixtureDigest(resolve(dirname(absoluteManifest), item.source.path));
      const projectDir = materializeCase(item, dirname(absoluteManifest), runRoot, sourceCache);
      const cold = invokeGuard(projectDir);
      const warm = invokeGuard(projectDir);
      coreCases.push(caseCore(item, sourceRevision, warm));
      observations.push({ id: item.id, coldMs: Number(cold.durationMs.toFixed(3)), warmMs: Number(warm.durationMs.toFixed(3)) });
    }
    const core = {
      schemaVersion: 1,
      manifestDigest: digest(manifestText),
      tool: { version: PACKAGE.version, revision: gitRevision() },
      cases: coreCases.sort((a, b) => a.id.localeCompare(b.id)),
    };
    core.metrics = calculateMetrics(core.cases);
    return {
      core,
      observations: {
        environment: { node: process.version, platform: process.platform, arch: process.arch },
        cases: observations.sort((a, b) => a.id.localeCompare(b.id)),
        retainedRoot: keep ? runRoot : null,
      },
    };
  } finally {
    if (!keep) rmSync(runRoot, { recursive: true, force: true });
  }
}
