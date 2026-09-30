/**
 * How old the running DocGuard release is, from the CHANGELOG it ships with
 * (specs/038-update-awareness).
 *
 * The deterministic core makes no network call (Constitution VIII), so
 * DocGuard cannot know whether a newer version exists. It can know its own
 * release date: release prep writes `## [X.Y.Z] - YYYY-MM-DD` for every
 * version, and CHANGELOG.md ships in every channel built from `npm pack`.
 * When the release is old, agent-facing text says so and names
 * `docguard upgrade`, which contacts npm only when someone runs it.
 *
 * Anything uncertain (no CHANGELOG, no heading for this exact version, a date
 * that does not parse, a clock before the release) produces no note: the
 * note never guesses.
 *
 * @implements docguard.update-awareness#FR-001
 * @implements docguard.update-awareness#FR-002
 * @implements docguard.update-awareness#FR-003
 * @implements docguard.update-awareness#FR-005
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The note shows once the release is more than this many whole days old. */
export const UPDATE_HINT_DAYS = 14;
export const UPDATE_HINT_OPT_OUT = 'DOCGUARD_NO_UPDATE_HINT';

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 86400000;
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const truthy = value => typeof value === 'string' && value !== '' && value !== '0' && value.toLowerCase() !== 'false';

/** The `YYYY-MM-DD` of `## [version] - YYYY-MM-DD`, outside fenced code blocks, or null. */
export function releaseDateFromChangelog(text, version) {
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\] - (\\S+)\\s*$`);
  let fence = null;
  for (const line of String(text).split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (fence === null) fence = marker[1][0];
      else if (marker[1][0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = line.match(heading);
    if (m) return m[1];
  }
  return null;
}

/** Milliseconds at UTC midnight for a real calendar date, or null. */
function utcDay(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null;
}

/**
 * @param {{ now?: Date|number, env?: Record<string,string|undefined>, pkgDir?: string }} [opts]
 * @returns {{ version: string|null, releasedOn: string|null, ageDays: number|null, show: boolean, reason: string }}
 *   reason: shown | opt-out | source-checkout | missing-changelog | no-heading | bad-date | clock-before-release | fresh
 */
export function releaseAge({ now = Date.now(), env = process.env, pkgDir = PKG_DIR } = {}) {
  const none = (reason, extra = {}) => ({ version: null, releasedOn: null, ageDays: null, show: false, reason, ...extra });
  if (truthy(env?.[UPDATE_HINT_OPT_OUT])) return none('opt-out');
  // A clone has a .git directory and a linked worktree a .git file: either
  // way this is DocGuard's own source, whose version is always "old".
  if (existsSync(join(pkgDir, '.git'))) return none('source-checkout');
  let version;
  try { version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version; } catch { return none('no-heading'); }
  if (typeof version !== 'string' || !version) return none('no-heading');
  let changelog;
  try { changelog = readFileSync(join(pkgDir, 'CHANGELOG.md'), 'utf8'); } catch { return none('missing-changelog', { version }); }
  const releasedOn = releaseDateFromChangelog(changelog, version);
  if (releasedOn === null) return none('no-heading', { version });
  const released = utcDay(releasedOn);
  if (released === null) return none('bad-date', { version });
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const ageDays = Math.floor((nowMs - released) / DAY_MS);
  if (!Number.isFinite(ageDays) || ageDays < 0) return none('clock-before-release', { version, releasedOn });
  const show = ageDays > UPDATE_HINT_DAYS;
  return { version, releasedOn, ageDays, show, reason: show ? 'shown' : 'fresh' };
}

/**
 * The note for one surface, or null when it is not shown. The pack states the
 * date and threshold, never a day count, so a committed pack stays the same
 * from one day to the next.
 *
 * @param {ReturnType<typeof releaseAge>} age
 * @param {'footer'|'mcp'|'pack'} surface
 */
export function updateHintText(age, surface) {
  if (!age?.show) return null;
  const check = 'Run `docguard upgrade` to check npm for a newer version (it contacts the registry only when run)';
  if (surface === 'pack') {
    return `DocGuard ${age.version} was released on ${age.releasedOn}, more than ${UPDATE_HINT_DAYS} days before this pack was written; a newer version may exist. ${check}. Ask the user before upgrading.`;
  }
  const lead = `DocGuard ${age.version} was released on ${age.releasedOn} (${age.ageDays} days ago); a newer version may exist.`;
  if (surface === 'mcp') {
    return `${lead} Tell the user, and offer to run \`docguard upgrade\`, which checks npm only when run. Do not upgrade DocGuard without the user's agreement.`;
  }
  return `${lead} ${check}.`;
}

/** The guard footer also stays silent in CI, where a pinned version is deliberate. */
export function footerHint({ now, env = process.env, pkgDir } = {}) {
  if (truthy(env?.CI)) return null;
  return updateHintText(releaseAge({ now, env, pkgDir }), 'footer');
}
