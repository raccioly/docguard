const STATUSES = new Set(['READY', 'QUEUED', 'IN_PROGRESS']);
const ALIASES = new Map([
  ['QUEUED', 'QUEUED'],
  ['IN-PROGRESS', 'IN_PROGRESS'],
  ['IN_PROGRESS', 'IN_PROGRESS'],
]);

export function normalizeStatus(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return STATUSES.has(normalized) ? normalized : (ALIASES.get(normalized) ?? null);
}
