/**
 * Validate recovery evidence before archived requirements can leave the active
 * working tree or become traceability tombstones.
 * @implements docguard.document-lifecycle#FR-007
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
