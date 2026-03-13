/**
 * Watch Command — Live mode that watches for file changes and re-runs guard
 * 
 * Like `jest --watch` but for CDD compliance.
 * Uses Node.js fs.watch (zero dependencies).
 *
 * --auto-fix: When guard finds issues, output AI fix prompts automatically.
 */

import { watch as fsWatch, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';
import { c } from '../docguard.mjs';
import { runGuardInternal } from './guard.mjs';

const DEBOUNCE_MS = 500;
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo',
]);
const WATCH_EXTS = new Set([
  '.md', '.json', '.mjs', '.js', '.ts', '.tsx', '.jsx', '.py',
]);

export function runWatch(projectDir, config, flags) {
  console.log(`${c.bold}👁️  DocGuard Watch — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}`);
  if (flags.autoFix) {
    console.log(`${c.cyan}   Mode: auto-fix (will output AI prompts on failures)${c.reset}`);
  }
  console.log(`${c.dim}   Watching for changes... (Ctrl+C to stop)${c.reset}\n`);

  // Run guard immediately on start
  runGuardQuiet(projectDir, config, flags);

  // Collect directories to watch
  const watchDirs = collectWatchDirs(projectDir);
  console.log(`${c.dim}   Watching ${watchDirs.length} directories${c.reset}\n`);

  let debounceTimer = null;
  let lastChange = '';

  for (const dir of watchDirs) {
    try {
      fsWatch(dir, { persistent: true }, (eventType, filename) => {
        if (!filename) return;
        const ext = extname(filename);
        if (!WATCH_EXTS.has(ext)) return;

        const changePath = relative(projectDir, resolve(dir, filename));
        if (changePath === lastChange) return; // skip duplicates
        lastChange = changePath;

        // Debounce — wait for rapid saves to settle
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          console.log(`\n${c.dim}   Changed: ${c.cyan}${changePath}${c.reset}`);
          runGuardQuiet(projectDir, config, flags);
          lastChange = '';
        }, DEBOUNCE_MS);
      });
    } catch {
      // Some directories may not be watchable
    }
  }

  // Keep process alive
  process.on('SIGINT', () => {
    console.log(`\n${c.dim}   Watch stopped.${c.reset}\n`);
    process.exit(0);
  });
}

function runGuardQuiet(projectDir, config, flags) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`${c.dim}   [${timestamp}] Running guard...${c.reset}`);

  try {
    const data = runGuardInternal(projectDir, config);

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

function collectWatchDirs(rootDir) {
  const dirs = [rootDir];

  function walk(dir) {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry)) continue;
        if (entry.startsWith('.')) continue;

        const fullPath = resolve(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            dirs.push(fullPath);
            walk(fullPath);
          }
        } catch { /* skip unreadable */ }
      }
    } catch { /* skip unreadable */ }
  }

  // Always watch docs-canonical explicitly
  const docsDir = resolve(rootDir, 'docs-canonical');
  if (existsSync(docsDir) && !dirs.includes(docsDir)) {
    dirs.push(docsDir);
  }

  walk(rootDir);
  return dirs;
}
