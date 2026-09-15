/**
 * Watch Command — Live mode that watches for file changes and re-runs guard
 * 
 * Like `jest --watch` but for CDD compliance.
 * Uses Node.js fs.watch (zero dependencies).
 *
 * --auto-fix: When guard finds issues, output AI fix prompts automatically.
 */

import { watch as fsWatch, readdirSync, lstatSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';
import { c } from '../shared.mjs';
import { runGuardInternal } from './guard.mjs';
import { clearMemoryPlanCache } from '../scanners/memory-plan.mjs';
import { buildIgnoreFilter, loadDocguardIgnore, DEFAULT_IGNORE_DIRS, relPosix } from '../shared-ignore.mjs';

const DEBOUNCE_MS = 500;
const WATCH_EXTS = new Set([
  '.md', '.json', '.mjs', '.cjs', '.js', '.ts', '.tsx', '.jsx', '.mts', '.cts', '.py',
  '.java', '.go', '.rs', '.rb', '.php', '.yaml', '.yml', '.toml',
]);

export function runWatch(projectDir, config, flags = {}, runtime = {}) {
  const watch = runtime.watch || fsWatch;
  const guard = runtime.guard || runGuardInternal;
  const clearCache = runtime.clearCache || clearMemoryPlanCache;
  const projectName = config.projectName || basename(resolve(projectDir)) || 'project';
  console.log(`${c.bold}👁️  DocGuard Watch — ${projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}`);
  if (flags.autoFix) {
    console.log(`${c.cyan}   Mode: auto-fix (will output AI prompts on failures)${c.reset}`);
  }
  console.log(`${c.dim}   Watching for changes... (Ctrl+C to stop)${c.reset}\n`);

  let ignored = buildIgnoreFilter([...(config.ignore || []), ...loadDocguardIgnore(projectDir)]);
  const skip = path => path.split('/').some(part => part === '.local' || DEFAULT_IGNORE_DIRS.has(part)) || ignored(path);
  const watchers = new Map();
  let debounceTimer = null;
  let running = false;
  let pending = false;
  let stopped = false;
  const changes = new Set();

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(debounceTimer);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
  function onSignal() {
    stop();
    console.log(`\n${c.dim}   Watch stopped.${c.reset}\n`);
  }
  function failed(err, dir) {
    if (stopped) return;
    console.error(`${c.red}   Watch failed for ${relPosix(projectDir, dir) || '.'}: ${err.code || err.message}. Watch stopped; resolve the error and restart.${c.reset}`);
    process.exitCode = 1;
    stop();
  }
  async function check() {
    if (stopped) return;
    if (running) { pending = true; return; }
    running = true;
    pending = false;
    const changed = [...changes];
    changes.clear();
    if (changed.length) console.log(`\n${c.dim}   Changed: ${c.cyan}${changed.join(', ')}${c.reset}`);
    try {
      clearCache();
      await runGuardQuiet(projectDir, config, flags, guard);
    } catch (err) {
      console.error(`${c.red}   Guard failed: ${err.message}${c.reset}`);
    } finally {
      running = false;
      // If saves are still arriving, let their debounce expire first.
      if (pending && !debounceTimer && !stopped) void check();
    }
  }
  function changed(dir, filename) {
    if (stopped) return;
    const name = filename == null ? null : String(filename);
    const path = name == null ? relPosix(projectDir, dir) : relPosix(projectDir, resolve(dir, name));
    if (skip(path) || path.startsWith('../')) return;
    if (name && name.startsWith('.') && !['.docguard.json', '.docguardignore', '.env.example'].includes(name)) return;
    // Rename events include directory creation/removal. Reconcile subscriptions
    // after the burst settles so new subdirectories are watched too.
    if (name && extname(name) && !WATCH_EXTS.has(extname(name).toLowerCase()) && name !== '.docguardignore' && name !== '.env.example') return;
    changes.add(path || '(unknown path)');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      reconcile();
      void check();
    }, DEBOUNCE_MS);
  }
  function reconcile() {
    if (stopped) return;
    ignored = buildIgnoreFilter([...(config.ignore || []), ...loadDocguardIgnore(projectDir)]);
    const dirs = collectWatchDirs(projectDir, skip, failed);
    if (stopped) return;
    const wanted = new Set(dirs);
    for (const [dir, watcher] of watchers) {
      if (!wanted.has(dir)) { watcher.close(); watchers.delete(dir); }
    }
    for (const dir of dirs) {
      if (watchers.has(dir)) continue;
      try {
        const watcher = watch(dir, { persistent: true }, (_event, filename) => changed(dir, filename));
        watchers.set(dir, watcher);
        watcher.on('error', err => failed(err, dir));
      } catch (err) { failed(err, dir); break; }
    }
  }
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  reconcile();
  if (!stopped) {
    void check();
    console.log(`${c.dim}   Watching ${watchers.size} directories${c.reset}\n`);
  }
  return { close: stop };
}

async function runGuardQuiet(projectDir, config, flags, guard) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${c.dim}   [${timestamp}] Running guard...${c.reset}`);

  try {
    const data = await guard(projectDir, config);

    if (data.status === 'PASS') {
      console.log(`  ${c.green}✅ PASS${c.reset} — ${data.passed}/${data.total} checks passed`);
    } else if (data.status === 'WARN') {
      console.log(`  ${c.yellow}⚠️  WARN${c.reset} — ${data.passed}/${data.total} passed, ${data.warnings} warning(s)`);
    } else {
      console.log(`  ${c.red}❌ FAIL${c.reset} — ${data.passed}/${data.total} passed, ${data.errors} error(s)`);
    }

    // Auto-fix: output fix prompts for failures
    if (flags.autoFix && data.status !== 'PASS') {
      console.log(`\n  ${c.cyan}${c.bold}🤖 Auto-fix prompts:${c.reset}`);

      for (const v of data.validators) {
        if (v.status === 'pass' || v.status === 'skipped') continue;

        const docMap = { 'Architecture': 'architecture', 'Security': 'security', 'Test-Spec': 'test-spec', 'Environment': 'environment' };
        const docTarget = docMap[v.name];

        for (const msg of [...v.errors, ...v.warnings]) {
          console.log(`  ${c.yellow}→${c.reset} [${v.name}] ${msg}`);
          if (docTarget) {
            console.log(`    ${c.dim}Fix: docguard fix --doc ${docTarget}${c.reset}`);
          }
        }
      }

      console.log(`\n  ${c.dim}Or run: docguard diagnose (for full AI remediation prompt)${c.reset}`);
    }
  } catch (err) {
    console.log(`${c.red}   Guard failed: ${err.message}${c.reset}`);
  }
}

function collectWatchDirs(rootDir, skip, onError) {
  const dirs = [];
  function walk(dir) {
    dirs.push(dir);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch (err) { onError(err, dir); return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = resolve(dir, entry.name);
      if (skip(relPosix(rootDir, full)) || entry.isSymbolicLink()) continue;
      try {
        if (lstatSync(full).isDirectory()) walk(full);
      } catch (err) {
        if (err.code !== 'ENOENT') onError(err, full);
      }
    }
  }
  walk(rootDir);
  return dirs;
}
