/**
 * The CHANGELOG notes a change shipped in, read the same way before and after
 * the release cut moves `[Unreleased]` under a version.
 *
 * @implements docguard.release-cut-green#FR-001
 * @implements docguard.release-cut-green#FR-002
 */

/**
 * Everything from `## [Unreleased]` down to the `## [<version>]` heading: the
 * notes added since that release, whether still unreleased or already cut.
 * Throws when either heading is missing, so a test can never read the whole file.
 */
export function notesSince(changelog, version) {
  const start = changelog.indexOf('## [Unreleased]');
  if (start < 0) throw new Error('CHANGELOG.md has no ## [Unreleased] heading');
  const end = changelog.indexOf(`\n## [${version}]`, start);
  if (end < 0) throw new Error(`CHANGELOG.md has no ## [${version}] heading below [Unreleased]`);
  return changelog.slice(start, end);
}

/**
 * The same notes as a CHANGELOG whose `[Unreleased]` section holds all of them,
 * for checks that read only that section (the scheduler's bump inference).
 */
export function notesAsUnreleased(changelog, version) {
  const body = notesSince(changelog, version).replace(/^## \[.*$/gm, '').trim();
  return `# Changelog\n\n## [Unreleased]\n\n${body}\n\n## [${version}]\n`;
}
