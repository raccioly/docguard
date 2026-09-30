#!/usr/bin/env node

/**
 * Release changelog: infer the semver bump from the curated [Unreleased]
 * section, and cut that section into a versioned one.
 *
 * Spec: specs/026-release-readiness (docguard.release-readiness).
 *
 * WHY INFER: the weekly scheduler defaulted to `patch`, so an unattended cut
 * of a release that adds commands and finding codes published the wrong
 * version. The curated changelog already states what kind of release it is:
 * an `### Added`, `### Removed` or `### Deprecated` entry is a minor release
 * for a 0.x project; only `### Changed`, `### Fixed` or `### Security` is a
 * patch.
 *
 * WHY THE CUT MOVES THE BODY: the old splice inserted a new version header
 * and a `### Changed` commit list ABOVE the curated [Unreleased] body, so the
 * released section carried two `### Changed` headings and the commit list
 * shadowed the reviewed notes. The cut now moves the curated body under the
 * version header unchanged and appends the merged commit subjects under their
 * own `### Commits` heading.
 *
 * @implements docguard.release-readiness#FR-001
 * @implements docguard.release-readiness#FR-002
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MINOR_HEADINGS = new Set(['added', 'removed', 'deprecated']);
const UNRELEASED_RE = /^## \[Unreleased\][^\n]*\n/m;

/** The [Unreleased] body: everything up to the next `## ` heading. */
export function unreleasedSection(changelog) {
  const m = UNRELEASED_RE.exec(changelog);
  if (!m) return null;
  const start = m.index + m[0].length;
  const rest = changelog.slice(start);
  const next = rest.search(/^## /m);
  const end = next < 0 ? changelog.length : start + next;
  return { headerStart: m.index, bodyStart: start, end, body: changelog.slice(start, end) };
}

/** `### Heading` names that carry at least one bullet. */
export function populatedHeadings(body) {
  const out = new Set();
  let current = null;
  for (const line of body.split('\n')) {
    const h = line.match(/^### (.+?)\s*$/);
    if (h) { current = h[1].toLowerCase(); continue; }
    if (current && /^\s*[-*] \S/.test(line)) out.add(current);
  }
  return out;
}

/**
 * @returns {{ bump: 'minor'|'patch', reason: string }}
 */
export function inferBump(changelog) {
  const section = unreleasedSection(changelog);
  if (!section) return { bump: 'patch', reason: 'no [Unreleased] section; nothing curated says this adds anything' };
  const headings = populatedHeadings(section.body);
  const minor = [...headings].filter(h => MINOR_HEADINGS.has(h));
  if (minor.length) return { bump: 'minor', reason: `[Unreleased] has ${minor.map(h => `### ${h[0].toUpperCase()}${h.slice(1)}`).join(', ')} entries` };
  const present = [...headings];
  return { bump: 'patch', reason: present.length ? `[Unreleased] has only ${present.map(h => `### ${h[0].toUpperCase()}${h.slice(1)}`).join(', ')} entries` : '[Unreleased] is empty' };
}

export function nextVersion(current, bump) {
  const m = String(current).match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`expected a stable x.y.z version, got ${JSON.stringify(current)}`);
  const [maj, min, pat] = m.slice(1).map(Number);
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  if (bump === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`bump must be patch or minor, got ${JSON.stringify(bump)}`);
}

/**
 * Move the curated [Unreleased] body under `## [version] - date`, append the
 * merged commit subjects under `### Commits`, and leave an empty [Unreleased].
 */
export function cutChangelog(changelog, { version, date, lastTag, commits = [] }) {
  const section = unreleasedSection(changelog);
  if (!section) throw new Error('CHANGELOG.md has no ## [Unreleased] section');
  if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(changelog)) {
    throw new Error(`CHANGELOG.md already has a ## [${version}] section`);
  }
  const curated = section.body.trim();
  const lines = [`## [${version}] - ${date}`, ''];
  if (curated) lines.push(curated, '');
  else lines.push(`Automated weekly release — batches everything merged since \`${lastTag}\`.`, '');
  const subjects = commits.map(s => s.replace(/^[0-9a-f]{7,40} /, '').trim()).filter(Boolean);
  if (subjects.length) {
    lines.push('### Commits', '', ...subjects.map(s => `- ${s}`), '');
  }
  return `${changelog.slice(0, section.bodyStart)}\n${lines.join('\n')}\n${changelog.slice(section.end)}`;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const opt = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
  const path = resolve(opt('--changelog') || 'CHANGELOG.md');
  const changelog = readFileSync(path, 'utf8');
  if (cmd === 'infer') {
    const r = inferBump(changelog);
    console.log(JSON.stringify(r));
    return;
  }
  if (cmd === 'cut') {
    const version = opt('--version');
    const commitsFile = opt('--commits');
    const commits = commitsFile ? readFileSync(commitsFile, 'utf8').split('\n') : [];
    const next = cutChangelog(changelog, {
      version,
      date: opt('--date') || new Date().toISOString().slice(0, 10),
      lastTag: opt('--last-tag') || 'the last tag',
      commits,
    });
    writeFileSync(path, next);
    console.log(`Cut [Unreleased] into [${version}].`);
    return;
  }
  throw new Error('usage: release-changelog.mjs infer|cut [--changelog <path>] [--version x.y.z --date YYYY-MM-DD --last-tag <tag> --commits <file>]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(`release-changelog: ${error.message}`);
    process.exitCode = 1;
  }
}
