/**
 * The official MCP registry listing follows the release
 * (specs/026-release-readiness FR-007): the sweep detects a registry that is
 * behind, the publish job proves what it publishes, and a race or re-run is not
 * an error. The registry's answer is untrusted text: it is parsed and compared,
 * never run.
 *
 * @req docguard.release-readiness#FR-007
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SERVER_NAME, assertReleaseVersions, isAlreadyPublished, listedVersions, registryMissing,
  waitForNpmTarball, queryRegistry,
} from '../.github/scripts/mcp-registry.mjs';

const OFFICIAL = 'io.modelcontextprotocol.registry/official';
const entry = (version, isLatest, name = SERVER_NAME) => ({ server: { name, version }, _meta: { [OFFICIAL]: { isLatest } } });
const body = (...entries) => JSON.stringify({ servers: entries, metadata: { count: entries.length } });

describe('listedVersions reads the registry answer without trusting it (FR-007)', () => {
  it('returns the latest and every listed version of exactly this server', () => {
    const got = listedVersions(body(entry('0.40.0', false), entry('0.40.5', true), entry('9.9.9', true, 'io.github.raccioly/docguard-evil')), SERVER_NAME);
    assert.deepEqual(got, { latest: '0.40.5', versions: ['0.40.0', '0.40.5'] });
  });

  it('a server that is not listed has no latest and no versions', () => {
    assert.deepEqual(listedVersions(body(), SERVER_NAME), { latest: null, versions: [] });
    assert.deepEqual(listedVersions(body(entry('1.0.0', true, 'someone/else')), SERVER_NAME), { latest: null, versions: [] });
  });

  it('malformed JSON, a missing servers array or a non-string version is an error, not a guess', () => {
    assert.throws(() => listedVersions('not json', SERVER_NAME), /not JSON/);
    assert.throws(() => listedVersions('{}', SERVER_NAME), /servers/);
    assert.throws(() => listedVersions(JSON.stringify({ servers: [{ server: { name: SERVER_NAME, version: 5 } }] }), SERVER_NAME), /version/);
  });
});

describe('registryMissing is true only when the registry is readable and behind (FR-007)', () => {
  const answer = (latest) => ({ ok: true, text: body(entry('0.40.0', false), entry(latest, true)) });
  it('behind: the registry latest is older than the released version', () => {
    assert.deepEqual(registryMissing('0.47.0', answer('0.40.5')), { missing: true, note: 'registry latest 0.40.5; released 0.47.0' });
  });
  it('equal: nothing to publish', () => {
    assert.equal(registryMissing('0.47.0', answer('0.47.0')).missing, false);
  });
  it('ahead: never publish an older version over a newer listing', () => {
    assert.equal(registryMissing('0.47.0', answer('0.48.0')).missing, false);
  });
  it('compares versions as numbers, not text', () => {
    assert.equal(registryMissing('0.9.0', answer('0.10.0')).missing, false);
    assert.equal(registryMissing('0.10.0', answer('0.9.0')).missing, true);
  });
  it('server absent: not listed yet, so the release is published', () => {
    assert.equal(registryMissing('0.47.0', { ok: true, text: body() }).missing, true);
  });
  it('malformed JSON, a failed query or an unreadable version fails closed with a reason', () => {
    for (const result of [{ ok: true, text: '<html>' }, { ok: false, error: 'ENOTFOUND' }, { ok: true, text: body(entry('latest', true)) }]) {
      const got = registryMissing('0.47.0', result);
      assert.equal(got.missing, false);
      assert.ok(got.warning, 'a warning is surfaced');
    }
  });
  it('a refused current version is an error, not a publish', () => {
    assert.throws(() => registryMissing('0.47.0; rm -rf /', answer('0.40.5')), /x\.y\.z/);
  });
});

describe('queryRegistry reports a network failure instead of throwing (FR-007)', () => {
  it('maps a rejected fetch, a non-200 and a good body', async () => {
    assert.deepEqual(await queryRegistry({ fetchImpl: async () => { throw new Error('ECONNRESET'); } }), { ok: false, error: 'ECONNRESET' });
    assert.deepEqual(await queryRegistry({ fetchImpl: async () => ({ ok: false, status: 503 }) }), { ok: false, error: 'HTTP 503' });
    assert.deepEqual(await queryRegistry({ fetchImpl: async url => { assert.match(url, /search=docguard&limit=100$/); return { ok: true, text: async () => '{}' }; } }), { ok: true, text: '{}' });
  });
});

describe('the publish job refuses a tag whose versions disagree (FR-007)', () => {
  const fixture = (server, pkg) => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-registry-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'server.json'), JSON.stringify(server));
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    return dir;
  };
  const ok = { name: SERVER_NAME, version: '0.47.0', packages: [{ identifier: 'docguard-cli', version: '0.47.0' }] };

  it('passes when server.json, its package entry and package.json all equal the version', () => {
    assertReleaseVersions(fixture(ok, { version: '0.47.0', mcpName: SERVER_NAME }), '0.47.0');
  });
  it('names the field that disagrees', () => {
    assert.throws(() => assertReleaseVersions(fixture({ ...ok, version: '0.46.0' }, { version: '0.47.0', mcpName: SERVER_NAME }), '0.47.0'), /server\.json version is 0\.46\.0/);
    assert.throws(() => assertReleaseVersions(fixture({ ...ok, packages: [{ identifier: 'docguard-cli', version: '0.46.0' }] }, { version: '0.47.0', mcpName: SERVER_NAME }), '0.47.0'), /packages\[0\]\.version is 0\.46\.0/);
    assert.throws(() => assertReleaseVersions(fixture(ok, { version: '0.46.0', mcpName: SERVER_NAME }), '0.47.0'), /package\.json version is 0\.46\.0/);
  });
  it('requires the registry name and the npm ownership proof', () => {
    assert.throws(() => assertReleaseVersions(fixture({ ...ok, name: 'io.github.other/x' }, { version: '0.47.0', mcpName: SERVER_NAME }), '0.47.0'), /server\.json name/);
    assert.throws(() => assertReleaseVersions(fixture(ok, { version: '0.47.0' }), '0.47.0'), /mcpName/);
  });
});

describe('waiting for the npm tarball the registry validates (FR-007)', () => {
  it('polls until 200 and fails after the bound', async () => {
    let calls = 0;
    await waitForNpmTarball('0.47.0', 900, { fetchImpl: async () => ({ status: ++calls < 3 ? 404 : 200 }), sleep: async () => {} });
    assert.equal(calls, 3);
    await assert.rejects(waitForNpmTarball('0.47.0', 0, { fetchImpl: async () => ({ status: 404 }), sleep: async () => {} }), /not served/);
  });
  it('asks for the exact tarball of this version', async () => {
    let seen;
    await waitForNpmTarball('0.47.0', 0, { fetchImpl: async url => { seen = url; return { status: 200 }; }, sleep: async () => {} });
    assert.equal(seen, 'https://registry.npmjs.org/docguard-cli/-/docguard-cli-0.47.0.tgz');
  });
});

describe('a publish that lost a race is a success (FR-007)', () => {
  it('recognizes the registry duplicate-version refusal and nothing else', () => {
    assert.ok(isAlreadyPublished('Error: publish failed: server returned status 400: invalid version: cannot publish duplicate version'));
    assert.ok(!isAlreadyPublished('version 0.47.0 already exists'), 'only the registry\'s own wording counts');
    assert.ok(!isAlreadyPublished('Error: duplicate version of a different thing'));
    assert.ok(!isAlreadyPublished('Error: invalid audience'));
    assert.ok(!isAlreadyPublished('Package validation failed'));
    assert.ok(!isAlreadyPublished(''));
  });
});
