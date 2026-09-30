/**
 * Release readiness (specs/026-release-readiness): the version a release cuts,
 * the notes it publishes, the CLI its Action installs, the Homebrew formula it
 * renders, and the help and schema surfaces it ships must all say the same
 * thing as the code.
 *
 * @req docguard.release-readiness#FR-001
 * @req docguard.release-readiness#FR-002
 * @req docguard.release-readiness#FR-003
 * @req docguard.release-readiness#FR-004
 * @req docguard.release-readiness#FR-005
 * @req docguard.release-readiness#FR-006
 * @req docguard.release-readiness#SC-001
 * @req docguard.release-readiness#SC-002
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cutChangelog, inferBump, nextVersion, populatedHeadings } from '../.github/scripts/release-changelog.mjs';
import { fetchPublished, renderFormula, sha256Of, verifyIntegrity } from '../.github/scripts/homebrew-formula.mjs';
import { CODES } from '../cli/findings.mjs';

const CLI = resolve('cli/docguard.mjs');
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const help = args => strip(spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }).stdout);

const CHANGELOG = (unreleased) => `# Changelog\n\n## [Unreleased]\n\n${unreleased}\n## [0.42.1] - 2026-09-22\n\n### Fixed\n\n- old fix\n`;

describe('the scheduler infers the bump from the curated changelog (FR-001)', () => {
  it('an Added entry makes a minor release', () => {
    const r = inferBump(CHANGELOG('### Added\n\n- **new command**\n\n### Fixed\n\n- a fix\n'));
    assert.equal(r.bump, 'minor');
    assert.match(r.reason, /### Added/);
  });

  it('Removed and Deprecated are minor too; Changed, Fixed and Security alone are a patch', () => {
    assert.equal(inferBump(CHANGELOG('### Removed\n\n- a flag\n')).bump, 'minor');
    assert.equal(inferBump(CHANGELOG('### Deprecated\n\n- a flag\n')).bump, 'minor');
    assert.equal(inferBump(CHANGELOG('### Changed\n\n- wording\n\n### Fixed\n\n- bug\n\n### Security\n\n- pin\n')).bump, 'patch');
  });

  it('an empty heading does not count, and a released section is never read', () => {
    assert.equal(inferBump(CHANGELOG('### Added\n\n### Fixed\n\n- bug\n')).bump, 'patch');
    assert.deepEqual([...populatedHeadings('### Added\n\n')], []);
    assert.equal(inferBump('# Changelog\n\n## [Unreleased]\n\n## [1.0.0]\n\n### Added\n\n- old\n').bump, 'patch');
  });

  it('computes the next version and rejects anything but patch or minor', () => {
    assert.equal(nextVersion('0.42.1', 'minor'), '0.43.0');
    assert.equal(nextVersion('0.42.1', 'patch'), '0.42.2');
    assert.throws(() => nextVersion('0.42.1', 'major'), /patch or minor/);
    assert.throws(() => nextVersion('0.42.1-rc.1', 'patch'), /stable/);
  });

  it("this repository's [Unreleased] section cuts a minor release (SC-001)", () => {
    assert.equal(inferBump(readFileSync('CHANGELOG.md', 'utf8')).bump, 'minor');
  });

  it('the scheduler defaults to auto and uses the script, not an inline patch default', () => {
    const wf = readFileSync('.github/workflows/scheduled-release.yml', 'utf8');
    assert.match(wf, /default: 'auto'/);
    assert.match(wf, /options: \[auto, patch, minor\]/);
    assert.match(wf, /release-changelog\.mjs infer/);
    assert.doesNotMatch(wf, /inputs\.bump \|\| 'patch'/);
  });
});

describe('the cut moves the curated notes under the version (FR-002)', () => {
  const cut = cutChangelog(CHANGELOG('### Added\n\n- **feature**\n\n### Changed\n\n- tweak\n'), {
    version: '0.43.0', date: '2026-10-01', lastTag: 'v0.42.1', commits: ['abc1234 feat: feature (#1)', 'def5678 fix: tweak (#2)', ''],
  });

  it('leaves an empty [Unreleased] and puts the curated body under the new version', () => {
    assert.match(cut, /## \[Unreleased\]\n\n## \[0\.43\.0\] - 2026-10-01\n\n### Added\n\n- \*\*feature\*\*/);
  });

  it('adds the commit subjects under their own heading, with no duplicate headings (SC-002)', () => {
    const section = cut.slice(cut.indexOf('## [0.43.0]'), cut.indexOf('## [0.42.1]'));
    const headings = section.match(/^### .+$/gm);
    assert.deepEqual(headings, ['### Added', '### Changed', '### Commits']);
    assert.match(section, /### Commits\n\n- feat: feature \(#1\)\n- fix: tweak \(#2\)\n/);
  });

  it('an empty [Unreleased] still yields a readable section', () => {
    const out = cutChangelog(CHANGELOG(''), { version: '0.42.2', date: '2026-10-01', lastTag: 'v0.42.1', commits: ['abc1234 chore: deps'] });
    assert.match(out, /## \[0\.42\.2\] - 2026-10-01\n\nAutomated weekly release — batches everything merged since `v0\.42\.1`\.\n\n### Commits\n\n- chore: deps/);
  });

  it('refuses to cut a version that already has a section', () => {
    assert.throws(() => cutChangelog(CHANGELOG('- x\n'), { version: '0.42.1', date: 'd', lastTag: 't' }), /already has/);
  });
});

describe('the Action installs the CLI it was released with (FR-003)', () => {
  it('action.yml pins the package.json version and never installs @latest implicitly', () => {
    const action = readFileSync('action.yml', 'utf8');
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    assert.match(action, new RegExp(`DOCGUARD_RELEASED_VERSION: '${version.replace(/\./g, '\\.')}'`));
    assert.doesNotMatch(action, /docguard-cli@latest/);
    assert.match(action, /docguard-version:/);
    // The input reaches the script through env, never interpolated into it.
    assert.match(action, /DOCGUARD_VERSION_INPUT: \$\{\{ inputs\.docguard-version \}\}/);
    assert.doesNotMatch(action, /npm install -g "?docguard-cli@\$\{\{/);
  });

  it('release PRs may change action.yml', async () => {
    const { RELEASE_PATH_ALLOWLIST } = await import('../cli/release-pr-policy.mjs');
    assert.ok(RELEASE_PATH_ALLOWLIST.test('action.yml'));
    assert.match(readFileSync('.github/workflows/scheduled-release.yml', 'utf8'), /git add [^\n]*action\.yml/);
  });
});

describe('the Homebrew formula is rendered from the published tarball (FR-004)', () => {
  const template = readFileSync('packaging/homebrew/docguard.rb', 'utf8');
  const sha = 'a'.repeat(64);

  it('the in-repo formula is a template with one placeholder each', () => {
    const out = renderFormula(template, { version: '0.43.0', sha256: sha });
    assert.match(out, /url "https:\/\/registry\.npmjs\.org\/docguard-cli\/-\/docguard-cli-0\.43\.0\.tgz"/);
    assert.match(out, new RegExp(`sha256 "${sha}"`));
    assert.doesNotMatch(out, /\{\{/);
  });

  it('rejects a bad version, a bad hash, or a template missing a placeholder', () => {
    assert.throws(() => renderFormula(template, { version: 'latest', sha256: sha }), /x\.y\.z/);
    assert.throws(() => renderFormula(template, { version: '1.0.0', sha256: 'ABC' }), /64 lowercase/);
    assert.throws(() => renderFormula('sha256 "{{SHA256}}"', { version: '1.0.0', sha256: sha }), /\{\{VERSION\}\} exactly once/);
  });

  it('trusts a download only when it matches npm dist.integrity', () => {
    const bytes = Buffer.from('tarball bytes');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    assert.ok(verifyIntegrity(bytes, integrity));
    assert.throws(() => verifyIntegrity(Buffer.from('tampered'), integrity), /does not match/);
    assert.equal(sha256Of(bytes), createHash('sha256').update(bytes).digest('hex'));
  });

  it('polls until the registry serves the tarball, bounded by the wait', async () => {
    const bytes = Buffer.from('published');
    const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
    let calls = 0;
    const fetchImpl = async url => {
      calls++;
      if (calls <= 2) return { ok: false };
      if (url.endsWith('.tgz')) return { ok: true, arrayBuffer: async () => bytes };
      return { ok: true, json: async () => ({ dist: { integrity } }) };
    };
    const got = await fetchPublished('1.2.3', 3600, { fetchImpl, sleep: async () => {} });
    assert.equal(got.toString(), 'published');
    await assert.rejects(fetchPublished('1.2.3', 0, { fetchImpl: async () => ({ ok: false }), sleep: async () => {} }), /not served/);
  });

  it('release.yml publishes the tap only after npm, retries a behind tap, and skips without the key', () => {
    const wf = readFileSync('.github/workflows/release.yml', 'utf8');
    const job = wf.slice(wf.indexOf('  publish-homebrew:'), wf.indexOf('  publish-npm:'));
    assert.match(job, /needs: \[detect-version, publish-npm\]/);
    assert.match(job, /needs\.publish-npm\.result == 'success'/);
    assert.match(job, /brew_missing == 'true'/);
    assert.match(job, /homebrew-formula\.mjs --version "\$VERSION"/);
    assert.match(job, /publish-homebrew-tap\.sh "\$VERSION"/);
    assert.match(job, /if \[ -z "\$\{HOMEBREW_TAP_DEPLOY_KEY\}" \]/);
    assert.match(wf, /HAS_TAP_KEY: \$\{\{ secrets\.HOMEBREW_TAP_DEPLOY_KEY != '' \}\}/);
    assert.equal(spawnSync('bash', ['-n', '.github/scripts/publish-homebrew-tap.sh']).status, 0);
  });
});

describe('top-level help names every subcommand (FR-005)', () => {
  it('each command whose help lists subcommands names them all in its --help summary line', () => {
    const top = help(['--help']);
    for (const command of ['specs', 'generate']) {
      const line = top.split('\n').find(l => new RegExp(`^\\s+${command}\\s`).test(l));
      assert.ok(line, `no top-level line for ${command}`);
      const own = help([command, '--help']);
      const block = own.slice(own.indexOf('Options:')).split('\n').slice(1);
      const end = block.findIndex(l => !l.trim());
      const options = block.slice(0, end < 0 ? block.length : end).filter(l => /^\s{2}\S/.test(l));
      const subcommands = options.map(l => l.trim().split(/\s+/)[0]).filter(w => /^[a-z]+$/.test(w));
      const modes = options.map(l => l.trim().split(/\s+/)[0]).filter(w => ['--spec', '--plan'].includes(w));
      for (const word of [...subcommands, ...modes]) assert.ok(line.includes(word), `${command} summary omits ${word}: ${line.trim()}`);
    }
  });
});

describe('the config schema declares every key a finding tells users to set (FR-006)', () => {
  it('each `"section": { "key": ... }` in finding help exists in the schema', () => {
    const schema = JSON.parse(readFileSync('schemas/docguard-config.schema.json', 'utf8'));
    const text = Object.values(CODES).map(c => `${c.help || ''} ${c.title || ''}`).join('\n');
    const pairs = [...text.matchAll(/"(\w+)":\s*\{\s*"(\w+)"/g)].map(m => [m[1], m[2]]);
    assert.ok(pairs.length >= 2, 'the help text is expected to name config keys');
    for (const [section, key] of pairs) {
      assert.ok(schema.properties?.[section]?.properties?.[key], `schema lacks ${section}.${key}`);
    }
  });
});
