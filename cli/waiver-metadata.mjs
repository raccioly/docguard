/**
 * Waiver metadata — the one rule for `owner:` and `expires:` on every kind of
 * suppression (specs/084-accountable-suppressions): inline pragmas, validator
 * and section N/A markers, `.docguardignore` reasons and `.docguard.json`
 * object entries.
 *
 * At most one `owner:` and one `expires:` token, whitespace-separated, at the
 * END of the text, in either order. Anything before them is the reason, so a
 * word like `owner:` inside the prose stays prose. Text without such a
 * trailing token is returned unchanged (FR-008).
 *
 * @implements docguard.accountable-suppressions#FR-001
 */

const OWNER_RE = /^(?:@[A-Za-z0-9][\w.-]*(?:\/[\w.-]+)?|[A-Za-z0-9][\w.-]*\/[\w.-]+|[^\s@]+@[^\s@]+\.[A-Za-z]{2,})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for `@handle`, `team/name` or an email address. */
export function isOwner(text) {
  return typeof text === 'string' && OWNER_RE.test(text);
}

/** A real calendar date in `YYYY-MM-DD`, or null. */
export function parseWaiverDate(text) {
  const m = DATE_RE.exec(text || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? text : null;
}

/** Today's UTC date as `YYYY-MM-DD`. */
export function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** True when `expires` is set and the day after it has begun (UTC). */
export function isExpired(expires, today = utcDay()) {
  return typeof expires === 'string' && expires < today;
}

/**
 * Split trailing metadata from reason text.
 * @param {string|null} text
 * @returns {{ reason: string|null, owner: string|null, expires: string|null, problem: string|null }}
 */
export function splitWaiverMetadata(text) {
  const out = { reason: text == null ? null : String(text), owner: null, expires: null, problem: null };
  if (!out.reason) return out;
  let rest = out.reason.trimEnd();
  for (let i = 0; i < 3; i++) {
    const m = /(?:^|\s)(owner|expires):(\S*)$/.exec(rest);
    if (!m) break;
    const [, key, value] = m;
    if (out[key] !== null) { out.problem = `duplicate ${key}: token`; }
    else if (key === 'owner') {
      if (OWNER_RE.test(value)) out.owner = value;
      else out.problem = `owner "${value}" is not @handle, team/name or an email`;
    } else {
      const date = parseWaiverDate(value);
      if (date) out.expires = date;
      else out.problem = `expires "${value}" is not a real YYYY-MM-DD date`;
    }
    rest = rest.slice(0, m.index).trimEnd();
  }
  if (out.owner === null && out.expires === null && out.problem === null) return out;
  out.reason = rest.trim() || null;
  return out;
}
