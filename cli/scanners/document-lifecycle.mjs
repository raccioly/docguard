/**
 * Read-only document lifecycle signals shared by `retire` and guard.
 * Signals identify review candidates; they never authorize deletion.
 */

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { shouldIgnore } from '../shared-ignore.mjs';

const RETIRED_STATUSES = new Set(['archived', 'deprecated', 'obsolete', 'superseded']);
const COMPLETION_STATUSES = new Set(['complete', 'completed']);
const EXCLUDED_PREFIXES = ['.git', '.local', '.docguard'];
const MANIFEST_PATH = '.docguard-archive.json';

export function readRetirementManifest(projectDir) {
  const path = resolve(projectDir, MANIFEST_PATH);
  if (!existsSync(path)) return { ok: true, paths: new Set(), entries: [], retention: null, error: null };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (parsed?.schemaVersion !== 1 || parsed?.strategy !== 'git-history' || !Array.isArray(parsed.entries)) {
      throw new Error('unsupported schema');
    }
    const globalRecovery = parsed.retention?.recoverability === 'verified'
      && typeof parsed.retention?.ref === 'string'
      && /^(?:sha1|sha256)$/.test(parsed.retention?.objectFormat || '');
    for (const entry of parsed.entries) {
      const path = entry?.path;
      const entryRecovery = entry?.recoverability === 'verified'
        && typeof entry?.retentionRef === 'string'
        && /^(?:sha1|sha256)$/.test(entry?.objectFormat || '');
      if (typeof path !== 'string' || !path || path.startsWith('/')
        || path.replaceAll('\\', '/').split('/').includes('..')
        || typeof entry?.archivedFrom !== 'string'
        || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(entry.archivedFrom)
        || typeof entry?.blob !== 'string'
        || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(entry.blob)
        || typeof entry?.reason !== 'string' || !entry.reason.trim()
        || (entry?.requirementIds !== undefined && (!Array.isArray(entry.requirementIds)
          || entry.requirementIds.some(id => typeof id !== 'string' || !id || id.length > 128 || /[\s#\0]/.test(id))))
        || (entry?.specId !== undefined && (typeof entry.specId !== 'string'
          || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(entry.specId)))
        || (!globalRecovery && !entryRecovery)) {
        throw new Error(`invalid recovery entry for ${path || '<unknown path>'}`);
      }
    }
    return {
      ok: true,
      paths: new Set(parsed.entries.map(entry => entry.path)),
      entries: parsed.entries,
      retention: parsed.retention || null,
      error: null,
    };
  } catch (error) {
    return { ok: false, paths: new Set(), entries: [], retention: null, error: `${MANIFEST_PATH}: ${error.message}` };
  }
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
      if (tasks) {
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
