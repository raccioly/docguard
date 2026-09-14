/**
 * Read-only document lifecycle signals shared by `retire` and guard.
 * Signals identify review candidates; they never authorize deletion.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { shouldIgnore } from '../shared-ignore.mjs';
import { readSpecRegistry } from './spec-registry.mjs';
import { readRetirementManifest } from './retirement-manifest.mjs';

const RETIRED_STATUSES = new Set(['archived', 'deprecated', 'obsolete', 'superseded']);
const COMPLETION_STATUSES = new Set(['complete', 'completed']);
const EXCLUDED_PREFIXES = ['.git', '.local', '.docguard'];
const SUPPRESSIBLE_DELIVERY = new Set(['verified', 'released']);

/**
 * Read only the narrow registry state needed to avoid asking users to retire a
 * verified living specification. Any malformed or unknown shape fails closed:
 * the ordinary lifecycle review signal remains visible.
 * @implements docguard.document-lifecycle#FR-002
 */
function readVerifiedLivingSpecPaths(projectDir) {
  const registry = readSpecRegistry(projectDir);
  if (!registry.exists || registry.error) return new Set();
  return new Set(registry.value.specs
    .filter(spec => spec.reviewed.lifecycle.context === 'current'
      && spec.reviewed.lifecycle.persistenceModel === 'living'
      && SUPPRESSIBLE_DELIVERY.has(spec.reviewed.lifecycle.delivery))
    .map(spec => spec.path));
}

function trackedFiles(projectDir) {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: projectDir,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const error = result.error?.message || result.stderr || result.stdout || 'git ls-files failed';
    return {
      ok: false,
      files: [],
      reason: /not a git repository|must be run in a work tree/i.test(error)
        ? 'not-git'
        : 'git-unavailable',
      error: error.trim(),
    };
  }
  return { ok: true, files: result.stdout.split('\0').filter(Boolean), reason: null, error: null };
}

export function parseLifecycleStatus(content) {
  const header = content.split('\n').slice(0, 40).join('\n');
  const match = header.match(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?Status(?::)?(?:\*\*)?\s*:?\s*(?:\*\*)?([^*\n]+)/i);
  return match?.[1]?.trim() || null;
}

function completedTaskSignal(projectDir, path, content, tracked) {
  let taskContent = content;
  if (!/(?:^|\n)\s*- \[[ xX]\]/.test(taskContent) && /(?:^|\/)spec\.md$/i.test(path)) {
    const taskRel = `${dirname(path)}/tasks.md`;
    const taskPath = resolve(projectDir, taskRel);
    if (tracked.has(taskRel) && existsSync(taskPath)) taskContent = readFileSync(taskPath, 'utf8');
  }
  const checked = taskContent.match(/(?:^|\n)\s*- \[[xX]\]/g)?.length || 0;
  const open = taskContent.match(/(?:^|\n)\s*- \[ \]/g)?.length || 0;
  return checked > 0 && open === 0 ? { checked, open } : null;
}

export function scanDocumentLifecycle(projectDir, config = {}) {
  const inventory = trackedFiles(projectDir);
  const retired = readRetirementManifest(projectDir);
  if (!inventory.ok || !retired.ok) {
    return {
      scanned: 0,
      candidates: [],
      coverage: {
        status: 'unavailable',
        reason: inventory.ok ? 'manifest-invalid' : inventory.reason,
        error: inventory.error || retired.error,
        unreadable: [],
      },
    };
  }
  const tracked = new Set(inventory.files);
  const verifiedLivingSpecs = readVerifiedLivingSpecPaths(projectDir);
  const markdown = inventory.files.filter(path => /\.md$/i.test(path));
  const candidates = [];
  const unreadable = [];
  let scanned = 0;
  for (const path of retired.paths) {
    if (existsSync(resolve(projectDir, path))) {
      candidates.push({
        code: 'DLC004',
        path,
        confidence: 'high',
        status: 'retired',
        reason: 'retirement manifest records this path but it remains in the working tree',
      });
    }
  }
  for (const path of markdown) {
    if (EXCLUDED_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) continue;
    if (shouldIgnore(path, config, 'documentLifecycle')) continue;
    if (retired.paths.has(path) && !existsSync(resolve(projectDir, path))) continue;
    let content;
    try { content = readFileSync(resolve(projectDir, path), 'utf8'); } catch {
      unreadable.push(path);
      continue;
    }
    scanned++;
    const status = parseLifecycleStatus(content);
    const normalizedStatus = status?.trim().toLowerCase() || null;
    if (normalizedStatus && RETIRED_STATUSES.has(normalizedStatus)) {
      candidates.push({
        code: 'DLC001',
        path,
        confidence: 'high',
        status,
        reason: `explicit lifecycle status: ${status}`,
      });
      continue;
    }
    if (normalizedStatus && COMPLETION_STATUSES.has(normalizedStatus)) {
      candidates.push({
        code: 'DLC002',
        path: /(?:^|\/)spec\.md$/i.test(path) ? dirname(path) : path,
        confidence: 'review',
        status,
        reason: `artifact maturity is ${status}; verify persistence policy and backreferences before retirement`,
      });
      continue;
    }
    if (path.startsWith('specs/') && /(?:^|\/)spec\.md$/i.test(path)) {
      const tasks = completedTaskSignal(projectDir, path, content, tracked);
      if (tasks && !verifiedLivingSpecs.has(path)) {
        candidates.push({
          code: 'DLC002',
          path: dirname(path),
          confidence: 'review',
          status,
          reason: `${tasks.checked} checked tasks and no open tasks; confirm the outcome is documented`,
        });
      }
    }
  }
  return {
    scanned,
    candidates: [...new Map(candidates.map(candidate => [candidate.path, candidate])).values()]
      .sort((a, b) => a.path.localeCompare(b.path)),
    coverage: {
      status: unreadable.length > 0 ? 'partial' : 'complete',
      reason: unreadable.length > 0 ? 'unreadable-files' : null,
      error: null,
      unreadable,
    },
  };
}
