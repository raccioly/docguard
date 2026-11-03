/**
 * `docguard sensor --aidlc` — DocGuard as an AWS AI-DLC sensor
 * (specs/090-aidlc-plugin). Prints AI-DLC's sensor contract, one JSON line
 * `{ pass, findings_count, findings, verdicts, docguard }`, and exits 0 when
 * guard ran; exits 1 (never 127) when it could not.
 *
 * `pass` means the work in progress introduced no drift: no blocking finding,
 * no blocked validator or undecided required check, and no finding that the
 * HEAD commit does not already have. Comparing with HEAD keeps pre-existing
 * warnings (a stock AI-DLC project carries some) from failing every gate,
 * while drift the stage just wrote fails it.
 *
 * AI-DLC fires a gate sensor once per declared output file, so one guard run
 * is cached per tree state in `.docguard/sensor-cache.json`, and the HEAD
 * comparison once per commit in `.docguard/sensor-head.json`.
 *
 * @implements docguard.aidlc-plugin#FR-001
 * @implements docguard.aidlc-plugin#FR-002
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runGuardInternal } from './guard.mjs';
import { loadConfig } from '../config.mjs';
import { gitIgnoredPaths, runGit } from '../shared-git.mjs';
import { ensureStateDir } from '../writers/state-dir.mjs';
import { fingerprintFinding } from '../writers/baseline.mjs';

const CACHE = '.docguard/sensor-cache.json';
const HEAD_CACHE = '.docguard/sensor-head.json';
const MAX_LISTED = 20;
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')).version;

/** HEAD, the working-tree changes with their content, and the config: what guard's answer depends on. */
export function treeKey(projectDir) {
  const h = createHash('sha256');
  const head = runGit(projectDir, ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const status = runGit(projectDir, ['status', '--porcelain', '-z', '--untracked-files=all'], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
  if (head.status === 0 && status.status === 0) {
    h.update(`head:${head.stdout.trim()}\n`);
    for (const entry of status.stdout.split('\0').filter(Boolean)) {
      const path = entry.slice(3);
      if (path.startsWith('.docguard/')) continue; // DocGuard's own state, including this cache
      h.update(`${entry}\n`);
      try { if (statSync(resolve(projectDir, path)).isFile()) h.update(readFileSync(resolve(projectDir, path))); } catch { /* deleted */ }
    }
  } else {
    // No git: the newest mtime under the project stands in for the tree state.
    h.update(`nogit:${newestMtime(projectDir)}\n`);
  }
  const cfg = resolve(projectDir, '.docguard.json');
  if (existsSync(cfg)) h.update(readFileSync(cfg));
  h.update(`v:${VERSION}`);
  return h.digest('hex');
}

function newestMtime(dir, depth = 0) {
  if (depth > 6) return 0;
  let newest = 0;
  try {
    for (const name of readdirSyncSafe(dir)) {
      if (name === '.git' || name === 'node_modules' || name === '.docguard') continue;
      const p = resolve(dir, name);
      const s = statSync(p);
      newest = Math.max(newest, s.isDirectory() ? newestMtime(p, depth + 1) : s.mtimeMs);
    }
  } catch { /* unreadable */ }
  return newest;
}
function readdirSyncSafe(dir) { try { return readdirSync(dir); } catch { return []; } }

/**
 * The finding fingerprints at the HEAD commit, from a guard run on a clean
 * export of it; null when there is no commit to compare with.
 */
export function headFingerprints(projectDir) {
  const head = runGit(projectDir, ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
  if (head.status !== 0 || head.error) return null;
  const sha = head.stdout.trim();
  const cachePath = resolve(projectDir, HEAD_CACHE);
  try {
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
    if (cached.head === sha && Array.isArray(cached.fingerprints)) return new Map(cached.fingerprints);
  } catch { /* first run at this commit */ }
  // A local clone, not an archive: history-based checks need .git to read
  // the same as they do in the working tree.
  const parent = mkdtempSync(join(tmpdir(), 'docguard-sensor-head-'));
  const dir = join(parent, 'head');
  try {
    const clone = runGit(projectDir, ['clone', '-q', '--local', '--no-checkout', projectDir, dir], { stdio: ['ignore', 'ignore', 'pipe'] });
    if (clone.status !== 0 || clone.error) return null;
    const checkout = spawnSync('git', ['-C', dir, '-c', 'advice.detachedHead=false', 'checkout', '-q', sha], { stdio: 'ignore' });
    if (checkout.status !== 0) return null;
    const counts = new Map();
    for (const f of runGuardInternal(dir, loadConfig(dir)).findings || []) {
      const fp = fingerprintFinding(f);
      counts.set(fp, (counts.get(fp) || 0) + 1);
    }
    try { ensureStateDir(projectDir); writeFileSync(cachePath, JSON.stringify({ head: sha, fingerprints: [...counts] }) + '\n'); } catch { /* read-only checkout */ }
    return counts;
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

/**
 * Findings the HEAD commit does not have, counted as a multiset. A finding
 * located in a git-ignored file is machine-local state the clone cannot see,
 * not work in progress, so it is never counted as introduced.
 */
export function newSinceHead(findings, headCounts, isIgnored = () => false) {
  if (!headCounts) return [...findings];
  const left = new Map(headCounts);
  return findings.filter(f => {
    const file = typeof f.location === 'string' ? f.location : f.location?.file;
    if (file && isIgnored(String(file).split(':')[0])) return false;
    const fp = fingerprintFinding(f);
    const n = left.get(fp) || 0;
    if (n > 0) { left.set(fp, n - 1); return false; }
    return true;
  });
}

const line = f => `${f.code || 'DOCGUARD'} ${typeof f.location === 'string' ? f.location : f.location?.file || ''} ${f.message}`.replace(/\s+/g, ' ').trim();

/** AI-DLC's sensor result, from a guard run and the HEAD comparison. */
export function sensorResult(data, headCounts = null, isIgnored = () => false) {
  const blocked = (data.validators || []).filter(v => v.verdict === 'blocked').map(v => v.key);
  const undecided = data.requiredChecks?.undecided || [];
  const findings = data.findings || [];
  const blocking = findings.filter(f => (f.effectiveSeverity || f.severity) === 'error');
  const introduced = headCounts ? newSinceHead(findings, headCounts, isIgnored) : [];
  const listed = [...new Set([...introduced, ...blocking, ...findings])].slice(0, MAX_LISTED).map(line);
  const pass = (data.effectiveErrors || 0) === 0 && blocked.length === 0 && undecided.length === 0 && introduced.length === 0;
  return {
    pass,
    findings_count: findings.length,
    new_findings_count: introduced.length,
    compared_with: headCounts ? 'HEAD' : null,
    findings: listed,
    verdicts: data.verdicts?.counts || null,
    ...(blocked.length ? { blocked } : {}),
    ...(undecided.length ? { undecided: undecided.map(u => `${u.key}: ${u.verdict}${u.reason ? ` (${u.reason})` : ''}`) } : {}),
    docguard: VERSION,
  };
}

export function runSensor(projectDir, config, flags = {}) {
  if (!flags.aidlc) {
    console.error('docguard sensor: only --aidlc is supported (AWS AI-DLC sensor contract)');
    process.exitCode = 1;
    return null;
  }
  const key = treeKey(projectDir);
  const cachePath = resolve(projectDir, CACHE);
  try {
    const cached = JSON.parse(readFileSync(cachePath, 'utf-8'));
    if (cached.key === key && cached.result) {
      process.stdout.write(`${JSON.stringify({ ...cached.result, cached: true })}\n`);
      return cached.result;
    }
  } catch { /* no cache yet */ }
  let result;
  try {
    const data = runGuardInternal(projectDir, config);
    const files = [...new Set((data.findings || []).map(f => (typeof f.location === 'string' ? f.location : f.location?.file)).filter(Boolean).map(p => String(p).split(':')[0]))];
    const ignored = files.length ? gitIgnoredPaths(projectDir, files) : null;
    result = sensorResult(data, headFingerprints(projectDir), p => Boolean(ignored && (ignored.ignored.has(p) || ignored.unknown.has(p))));
  } catch (err) {
    console.error(`docguard sensor: guard could not run: ${err.message}`);
    process.exitCode = 1;
    return null;
  }
  try { ensureStateDir(projectDir); writeFileSync(cachePath, JSON.stringify({ key, stage: flags.stage || null, result }) + '\n'); } catch { /* read-only checkout: no cache */ }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}
