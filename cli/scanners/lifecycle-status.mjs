/**
 * A document's declared lifecycle status, read from its header. A leaf
 * module: `speckit.mjs` needs it, and importing it from
 * `document-lifecycle.mjs` closed an import cycle through `spec-registry.mjs`.
 *
 * @implements docguard.upstream-coverage#FR-007
 * @implements docguard.dora-evidence#FR-005
 */

export const RETIRED_STATUSES = new Set(['archived', 'deprecated', 'obsolete', 'superseded']);

export function parseLifecycleStatus(content) {
  const header = content.split('\n').slice(0, 40).join('\n');
  const match = header.match(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?Status(?::)?(?:\*\*)?\s*:?\s*(?:\*\*)?([^*\n]+)/i);
  return match?.[1]?.trim() || null;
}
