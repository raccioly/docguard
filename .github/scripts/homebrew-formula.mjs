#!/usr/bin/env node

/**
 * Render the Homebrew formula from the PUBLISHED npm tarball.
 *
 * Spec: specs/026-release-readiness (docguard.release-readiness#FR-004).
 *
 * The sha256 must describe the bytes Homebrew will download, so it is computed
 * from registry.npmjs.org after `npm publish`, never from a local `npm pack`
 * (a provenance-signed publish can differ byte for byte). The download is
 * checked against npm's own `dist.integrity` (sha512) before its sha256 is
 * trusted. A publish is `PUT 202`: the tarball can take minutes to appear, so
 * the fetch polls, bounded by --wait seconds.
 *
 * @implements docguard.release-readiness#FR-004
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STABLE = /^\d+\.\d+\.\d+$/;
const PACKAGE = 'docguard-cli';

export function tarballUrl(version) {
  return `https://registry.npmjs.org/${PACKAGE}/-/${PACKAGE}-${version}.tgz`;
}

/** Replace each placeholder exactly once; anything else is a broken template. */
export function renderFormula(template, { version, sha256 }) {
  if (!STABLE.test(version || '')) throw new Error(`version must be x.y.z, got ${JSON.stringify(version)}`);
  if (!/^[0-9a-f]{64}$/.test(sha256 || '')) throw new Error('sha256 must be 64 lowercase hex characters');
  let out = template;
  for (const [token, value] of [['{{VERSION}}', version], ['{{SHA256}}', sha256]]) {
    const count = out.split(token).length - 1;
    if (count !== 1) throw new Error(`template must contain ${token} exactly once, found ${count}`);
    out = out.replace(token, value);
  }
  if (/\{\{[A-Z0-9_]+\}\}/.test(out)) throw new Error('template has an unknown placeholder');
  return out;
}

/** npm's dist.integrity is `sha512-<base64>`; verify the downloaded bytes match it. */
export function verifyIntegrity(bytes, integrity) {
  const m = /^sha512-([A-Za-z0-9+/=]+)$/.exec(String(integrity || '').trim());
  if (!m) throw new Error(`unsupported dist.integrity ${JSON.stringify(integrity)}`);
  const actual = createHash('sha512').update(bytes).digest('base64');
  if (actual !== m[1]) throw new Error('downloaded tarball does not match npm dist.integrity');
  return true;
}

export const sha256Of = bytes => createHash('sha256').update(bytes).digest('hex');

async function fetchPublished(version, waitSeconds, { fetchImpl = fetch, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const deadline = Date.now() + waitSeconds * 1000;
  for (;;) {
    const meta = await fetchImpl(`https://registry.npmjs.org/${PACKAGE}/${version}`);
    if (meta.ok) {
      const { dist } = await meta.json();
      const tgz = await fetchImpl(tarballUrl(version));
      if (tgz.ok) {
        const bytes = Buffer.from(await tgz.arrayBuffer());
        verifyIntegrity(bytes, dist?.integrity);
        return bytes;
      }
    }
    if (Date.now() >= deadline) throw new Error(`${PACKAGE}@${version} is not served by the npm registry after ${waitSeconds}s`);
    await sleep(15000);
  }
}

async function main(argv) {
  const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const version = opt('--version');
  const template = readFileSync(resolve(opt('--template') || 'packaging/homebrew/docguard.rb'), 'utf8');
  const bytes = await fetchPublished(version, Number(opt('--wait') || 900));
  const sha256 = sha256Of(bytes);
  const out = resolve(opt('--out') || 'docguard.rb');
  writeFileSync(out, renderFormula(template, { version, sha256 }));
  console.log(`Rendered ${out} for ${PACKAGE}@${version} (sha256 ${sha256}, verified against dist.integrity).`);
}

export { fetchPublished };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(`homebrew-formula: ${error.message}`);
    process.exitCode = 1;
  });
}
