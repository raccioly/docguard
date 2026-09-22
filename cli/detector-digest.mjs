/**
 * Content digest of the detectors that produce findings.
 *
 * Benchmark evidence was stamped with a tool VERSION, so `explain` told users
 * "Measured on DocGuard 0.41.7; you are running 0.42.0" whenever the numbers
 * lagged a release -- true, and useless: it reports that two builds are numbered
 * differently, while the question is whether the measured number still applies
 * to the code that just ran. A release that changes only docs or the CLI shell
 * leaves every detector byte-identical and every measurement exactly as valid.
 *
 * Comparing git revisions cannot answer it either: `package.json` ships `cli/`
 * but `.npmignore` excludes `.git/` and `benchmarks/` is unpublished, so an
 * installed user has no DocGuard repository to diff. Hashing the SHIPPED
 * detector sources works everywhere the CLI runs.
 *
 * Deliberately one digest over the whole detector set, not per code: a per-code
 * map would be more precise but must be maintained as detectors move, and a
 * stale entry would silently claim calibration a code no longer has. Coarse and
 * correct beats precise and rotting.
 *
 * @implements docguard.precision-evidence-loop#FR-019
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_DIR = dirname(fileURLToPath(import.meta.url));

/** Directories holding the code that emits findings, relative to `cli/`. */
export const DETECTOR_DIRS = Object.freeze(['validators', 'scanners']);

/**
 * sha256 over every detector module's relative path and bytes, in sorted path
 * order. Paths are hashed too, so adding or removing a detector changes the
 * digest even when no surviving file is edited.
 *
 * Returns null rather than throwing when the tree cannot be read: an unknown
 * digest must degrade to the old version-string wording, never to a false claim
 * that the detectors are unchanged.
 *
 * Measured at ~1.2ms over 53 files, and callers only reach it when the version
 * strings already disagree -- so the matching path stays free.
 */
export function computeDetectorsDigest(cliDir = CLI_DIR) {
  try {
    const files = [];
    for (const dir of DETECTOR_DIRS) {
      for (const name of readdirSync(join(cliDir, dir))) {
        if (name.endsWith('.mjs')) files.push(`${dir}/${name}`);
      }
    }
    if (files.length === 0) return null;
    const hash = createHash('sha256');
    for (const relative of files.sort()) {
      hash.update(relative);
      hash.update('\0');
      hash.update(readFileSync(join(cliDir, relative)));
    }
    return `sha256:${hash.digest('hex')}`;
  } catch {
    return null;
  }
}
