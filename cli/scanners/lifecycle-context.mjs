/**
 * Deterministic active-intent projection for AI tools and lifecycle hooks.
 * @implements docguard.document-lifecycle#FR-014
 * @implements docguard.document-lifecycle#FR-017
 */

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const digest = content => `sha256:${createHash('sha256').update(content).digest('hex')}`;
const posix = path => path.split(sep).join('/');

function safeDigest(projectDir, path) {
  if (!path || path.split(/[\\/]/).includes('.local')) return null;
  try {
    const root = realpathSync(projectDir);
    const absolute = resolve(projectDir, path);
    const real = realpathSync(absolute);
    if (!existsSync(absolute) || !lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink()
      || (real !== root && !real.startsWith(`${root}${sep}`))) return null;
    return digest(readFileSync(absolute));
  } catch { return null; }
}

export function buildLifecycleContext(projectDir, registry, revision) {
  const specs = registry.specs
    .filter(spec => spec.reviewed.lifecycle.context === 'current'
      && spec.reviewed.lifecycle.approval === 'approved')
    .map(spec => ({
      specId: spec.specId,
      path: posix(relative(projectDir, resolve(projectDir, spec.path))),
      digest: spec.observed.artifacts.find(artifact => artifact.path === spec.path)?.digest || safeDigest(projectDir, spec.path),
      delivery: spec.reviewed.lifecycle.delivery,
      requirements: [...spec.intent.requirements].sort(),
      canonicalDocs: spec.reviewed.scope.canonicalDocs.map(path => ({ path, digest: safeDigest(projectDir, path) })),
    }))
    .sort((a, b) => a.specId.localeCompare(b.specId));
  return {
    schemaVersion: 1,
    generatedFrom: revision,
    assurance: 'pointers-and-content-hashes-only',
    factualAccuracy: null,
    specs,
  };
}

export function serializeLifecycleContext(projectDir, registry, revision) {
  return `${JSON.stringify(buildLifecycleContext(projectDir, registry, revision), null, 2)}\n`;
}
