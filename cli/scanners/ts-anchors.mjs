/**
 * The opt-in tree-sitter tier (FR-009): precise spans and an exact
 * fingerprint for symbols the pattern tier found, in the languages it reads.
 *
 * Spec: specs/070-requirement-anchors (FR-009, research P7).
 *
 * Safety, in order:
 *   1. Only when `anchors.treeSitter.artifacts` names the files. Nothing is
 *      ever auto-detected, and a project's node_modules is never searched.
 *   2. Each named file is read once, and its sha256 must equal the hash
 *      schemas/docguard-anchor-treesitter.manifest.json pins for it.
 *   3. Those same verified bytes are written to `.docguard/ts/<sha256>/`, and
 *      the parser process imports that copy by absolute file URL. There is no
 *      bare specifier, so module resolution never runs.
 *   4. Parsing happens in one child process per run, with content on stdin,
 *      no environment, `--no-addons`, and a timeout. Extraction stays
 *      synchronous for its callers, like the batched `python3` tier.
 *
 * A missing, unreadable or mismatched artifact, or a failed child, makes the
 * tier unavailable with a reason (ANC010), and the pattern tier answers.
 *
 * @implements docguard.requirement-anchors#FR-009
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureStateDir, STATE_DIR } from '../writers/state-dir.mjs';

const MANIFEST_URL = new URL('../../schemas/docguard-anchor-treesitter.manifest.json', import.meta.url);
const CHILD = fileURLToPath(new URL('./ts-anchors-child.mjs', import.meta.url));
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;

let manifestCache = null;
/** The shipped manifest of loadable artifacts. */
export function treeSitterManifest() {
  if (!manifestCache) manifestCache = JSON.parse(readFileSync(MANIFEST_URL, 'utf8'));
  return manifestCache;
}

/** `anchors.treeSitter.artifacts`, or null: the tier exists only when configured. */
export function treeSitterSettings(config = {}) {
  const artifacts = config.anchors?.treeSitter?.artifacts;
  if (!artifacts || typeof artifacts !== 'object') return null;
  return artifacts;
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Read a configured artifact once and check it against the pinned hash. */
function verified(projectDir, path, expected, label) {
  if (typeof path !== 'string' || !path) return { error: `${label} is not configured` };
  const abs = isAbsolute(path) ? path : resolve(projectDir, path);
  let bytes;
  try {
    const stat = lstatSync(abs);
    if (!stat.isFile() && !stat.isSymbolicLink()) return { error: `${label} (${path}) is not a file` };
    bytes = readFileSync(abs);
  } catch { return { error: `${label} (${path}) cannot be read` }; }
  if (bytes.length > MAX_ARTIFACT_BYTES) return { error: `${label} (${path}) is larger than ${MAX_ARTIFACT_BYTES} bytes` };
  const actual = sha256(bytes);
  if (actual !== expected) return { error: `${label} (${path}) has sha256 ${actual.slice(0, 12)}…, which the manifest does not pin (expected ${expected.slice(0, 12)}…)` };
  return { bytes, sha: actual };
}

/** Write verified bytes to `.docguard/ts/<sha256>/<name>` and return the copy's path. */
function copyOf(projectDir, item, name) {
  const dir = join(projectDir, STATE_DIR, 'ts', item.sha);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, item.bytes, { mode: 0o600 });
  return path;
}

/**
 * Verify and stage the configured artifacts.
 * @returns {{ ok: boolean, reason?: string, tier?: string, languages?: string[], runtime?: object, grammars?: object }}
 */
export function prepareTreeSitter(projectDir, config = {}, options = {}) {
  const artifacts = treeSitterSettings(config);
  if (!artifacts) return { ok: false, configured: false };
  const manifest = options.manifest || treeSitterManifest();
  const runtimeJs = verified(projectDir, artifacts.runtime, manifest.runtime.files['web-tree-sitter.js'], 'anchors.treeSitter.artifacts.runtime');
  if (runtimeJs.error) return { ok: false, configured: true, reason: runtimeJs.error };
  const runtimeWasm = verified(projectDir, artifacts.runtimeWasm, manifest.runtime.files['web-tree-sitter.wasm'], 'anchors.treeSitter.artifacts.runtimeWasm');
  if (runtimeWasm.error) return { ok: false, configured: true, reason: runtimeWasm.error };
  const grammars = {};
  const problems = [];
  for (const [lang, path] of Object.entries(artifacts.grammars || {})) {
    const pinned = manifest.grammars[lang];
    if (!pinned) { problems.push(`no grammar is pinned for ${lang}`); continue; }
    const g = verified(projectDir, path, pinned.sha256, `anchors.treeSitter.artifacts.grammars.${lang}`);
    if (g.error) { problems.push(g.error); continue; }
    grammars[lang] = g;
  }
  if (!Object.keys(grammars).length) return { ok: false, configured: true, reason: problems[0] || 'no grammar is configured' };
  if (!ensureStateDir(projectDir)) return { ok: false, configured: true, reason: `${STATE_DIR}/ is not a writable directory, so the verified artifacts cannot be staged` };
  const tierHash = sha256([runtimeJs.sha, runtimeWasm.sha, ...Object.entries(grammars).sort(([a], [b]) => (a < b ? -1 : 1)).map(([l, g]) => `${l}:${g.sha}`)].join('|'));
  return {
    ok: true, configured: true, problems,
    tier: `treesitter@${tierHash.slice(0, 8)}`,
    languages: Object.keys(grammars).sort(),
    runtime: { js: copyOf(projectDir, runtimeJs, 'web-tree-sitter.js'), wasm: copyOf(projectDir, runtimeWasm, 'web-tree-sitter.wasm') },
    grammars: Object.fromEntries(Object.entries(grammars).map(([lang, g]) => [lang, copyOf(projectDir, g, basename(String(artifacts.grammars[lang])) || `${lang}.wasm`)])),
  };
}

/**
 * Parse files in one child process.
 * @param {{ key: string, lang: string, content: string }[]} files
 * @returns {{ ok: boolean, reason?: string, files?: Record<string, { symbols: object[] }> }}
 */
export function treeSitterBatch(prepared, files) {
  if (!prepared?.ok || !files.length) return { ok: false, reason: 'the tree-sitter tier is not prepared' };
  const input = JSON.stringify({ runtime: prepared.runtime, grammars: prepared.grammars, files });
  const timeout = 30_000 + Math.ceil(input.length / 65_536) * 1_000;
  const r = spawnSync(process.execPath, ['--no-addons', '--no-warnings', CHILD], {
    input, encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024, env: {}, cwd: resolve(prepared.runtime.js, '..'),
  });
  if (r.error || r.status !== 0) return { ok: false, reason: `the tree-sitter process failed (${r.error?.code || `exit ${r.status}`}${r.stderr ? `: ${r.stderr.trim().split('\n').pop()}` : ''})` };
  try {
    const out = JSON.parse(r.stdout);
    return out.ok ? { ok: true, files: out.files } : { ok: false, reason: out.error || 'the tree-sitter process reported a failure' };
  } catch { return { ok: false, reason: 'the tree-sitter process wrote unreadable output' }; }
}
