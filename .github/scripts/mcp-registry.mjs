#!/usr/bin/env node

/**
 * Publish each release to the official MCP registry, and notice when the
 * registry has fallen behind.
 *
 * Spec: specs/026-release-readiness (docguard.release-readiness#FR-007).
 *
 * Subcommands (all read-only except `publish`):
 *   detect --version X.Y.Z          write `registry_missing=true|false` to $GITHUB_OUTPUT (stdout when unset)
 *   listed --version X.Y.Z          exit 0 when the registry already lists that version
 *   assert-versions --version X.Y.Z --dir <tag checkout>
 *   wait-package --version X.Y.Z [--wait 900]
 *   publish --bin <mcp-publisher> --dir <tag checkout>
 *
 * The registry's answer is untrusted text. It is parsed as JSON and compared;
 * it is never interpolated into a command, and a value that is not a plain
 * `x.y.z` version is an unreadable answer, not a version.
 *
 * @implements docguard.release-readiness#FR-007
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVER_NAME = 'io.github.raccioly/docguard';
const PACKAGE = 'docguard-cli';
const OFFICIAL = 'io.modelcontextprotocol.registry/official';
const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;
const SEARCH_URL = 'https://registry.modelcontextprotocol.io/v0/servers?search=docguard&limit=100';

const parts = v => STABLE.exec(v).slice(1).map(Number);
const compare = (a, b) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
};
const requireStable = version => {
  if (!STABLE.test(version || '')) throw new Error(`version must be x.y.z, got ${JSON.stringify(version)}`);
};

/** The versions the registry lists for exactly this server, and the one it flags latest. */
export function listedVersions(text, name = SERVER_NAME) {
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('registry answer is not JSON'); }
  if (!json || !Array.isArray(json.servers)) throw new Error('registry answer has no servers array');
  const versions = [];
  let latest = null;
  for (const item of json.servers) {
    if (item?.server?.name !== name) continue;
    const version = item.server.version;
    if (typeof version !== 'string') throw new Error('registry lists a server without a string version');
    versions.push(version);
    if (item._meta?.[OFFICIAL]?.isLatest === true) latest = version;
  }
  return { latest, versions };
}

/** One GET of the registry read API; a failure is a value, not an exception. */
export async function queryRegistry({ fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(SEARCH_URL, { signal: AbortSignal.timeout(30000), headers: { accept: 'application/json' } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, text: await res.text() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * Is the registry behind the released version? True only for a readable answer
 * whose latest is older than `current`, or that does not list the server at all.
 * An unreadable answer is `missing: false` with a warning: no publish on a
 * guess. A registry ahead of the release is never overwritten with an older one.
 */
export function registryMissing(current, result) {
  requireStable(current);
  if (!result.ok) return { missing: false, warning: `MCP registry not read (${result.error}); not publishing from this sweep` };
  let listed;
  try { listed = listedVersions(result.text); } catch (error) {
    return { missing: false, warning: `MCP registry answer unreadable (${error.message}); not publishing from this sweep` };
  }
  if (listed.latest === null) {
    return listed.versions.length
      ? { missing: false, warning: 'MCP registry lists this server but flags no latest version; not publishing from this sweep' }
      : { missing: true, note: `registry does not list ${SERVER_NAME}; released ${current}` };
  }
  if (!STABLE.test(listed.latest)) return { missing: false, warning: 'MCP registry latest is not an x.y.z version; not publishing from this sweep' };
  const order = compare(listed.latest, current);
  return { missing: order < 0, note: `registry latest ${listed.latest}; released ${current}` };
}

/** server.json (both version fields), package.json and its ownership proof must all say `version`. */
export function assertReleaseVersions(dir, version) {
  requireStable(version);
  const read = file => JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const server = read('server.json');
  const pkg = read('package.json');
  const problems = [];
  if (server.name !== SERVER_NAME) problems.push(`server.json name is ${JSON.stringify(server.name)}, expected ${SERVER_NAME}`);
  if (server.version !== version) problems.push(`server.json version is ${server.version}, expected ${version}`);
  (server.packages || []).forEach((p, i) => {
    if (p.version !== version) problems.push(`server.json packages[${i}].version is ${p.version}, expected ${version}`);
  });
  if (!(server.packages || []).length) problems.push('server.json lists no package');
  if (pkg.version !== version) problems.push(`package.json version is ${pkg.version}, expected ${version}`);
  if (pkg.mcpName !== SERVER_NAME) problems.push(`package.json mcpName is ${JSON.stringify(pkg.mcpName)}, expected ${SERVER_NAME}`);
  if (problems.length) throw new Error(problems.join('; '));
}

/** The registry validates the npm package, and a fresh tarball can 404 for minutes. */
export async function waitForNpmTarball(version, waitSeconds, { fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  requireStable(version);
  const url = `https://registry.npmjs.org/${PACKAGE}/-/${PACKAGE}-${version}.tgz`;
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    let status = 0;
    try { status = (await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) })).status; } catch { /* retry */ }
    if (status === 200) return;
    if (Date.now() >= deadline) throw new Error(`${PACKAGE}@${version} tarball is not served by the npm registry after ${waitSeconds}s (last status ${status})`);
    await sleep(15000);
  }
}

/** The registry's refusal of a version it already lists (internal/database ErrInvalidVersion: "cannot publish duplicate version"). */
export const isAlreadyPublished = output => /cannot publish duplicate version/i.test(String(output || ''));

function publish(bin, dir) {
  const run = spawnSync(resolve(bin), ['publish'], { cwd: resolve(dir), encoding: 'utf8' });
  const output = `${run.stdout || ''}${run.stderr || ''}`;
  process.stdout.write(output);
  if (run.status === 0) return;
  if (isAlreadyPublished(output)) {
    console.log('::notice::The MCP registry already lists this version; nothing to publish.');
    return;
  }
  throw new Error(`mcp-publisher publish failed (exit ${run.status}); the next sweep retries`);
}

async function main(argv) {
  const [command] = argv;
  const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const version = opt('--version');
  switch (command) {
    case 'detect': {
      // Never fails the caller: detect-version gates every other job, so an
      // unreadable registry is `false` plus a warning, not a red run.
      let got;
      try { got = registryMissing(version, await queryRegistry()); } catch (error) { got = { missing: false, warning: `MCP registry check failed (${error.message}); not publishing from this sweep` }; }
      if (got.warning) console.log(`::warning::${got.warning}`);
      else console.log(got.note);
      const line = `registry_missing=${got.missing}\n`;
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line); else process.stdout.write(line);
      return;
    }
    case 'listed': {
      requireStable(version);
      const result = await queryRegistry();
      let listed = false;
      try { listed = result.ok && listedVersions(result.text).versions.includes(version); } catch { /* publish decides */ }
      console.error(listed ? `registry already lists ${version}` : `registry does not list ${version}`);
      process.exitCode = listed ? 0 : 1;
      return;
    }
    case 'assert-versions':
      assertReleaseVersions(opt('--dir') || '.', version);
      console.log(`server.json and package.json agree on ${version}.`);
      return;
    case 'wait-package':
      await waitForNpmTarball(version, Number(opt('--wait') || 900));
      console.log(`${PACKAGE}@${version} is served by the npm registry.`);
      return;
    case 'publish':
      publish(opt('--bin') || './mcp-publisher', opt('--dir') || '.');
      return;
    default:
      throw new Error(`unknown command ${JSON.stringify(command)}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`::error::mcp-registry: ${error.message}`);
    process.exitCode = 1;
  });
}
