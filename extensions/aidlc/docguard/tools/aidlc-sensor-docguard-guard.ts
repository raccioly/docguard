// aidlc-sensor-docguard-guard.ts — AI-DLC sensor wrapper for DocGuard
// (docguard plugin). Thin by design: every decision is made by the DocGuard
// CLI (`docguard sensor --aidlc`), which DocGuard's own Node test suite covers.
// This file only runs it with the dispatcher's arguments and passes its output
// through. It never exits 127: AI-DLC records 127 as a pass ("tool-unavailable"),
// and a missing DocGuard must read as "could not run".
import { spawnSync } from "node:child_process";

const bin = process.env.DOCGUARD_BIN || "docguard";
const result = spawnSync(bin, ["sensor", "--aidlc", ...process.argv.slice(2)], {
  encoding: "utf-8",
  maxBuffer: 16 * 1024 * 1024,
});

if (result.error) {
  process.stderr.write(
    `aidlc-sensor-docguard-guard: could not start "${bin}" (${(result.error as NodeJS.ErrnoException).code ?? result.error.message}). Install DocGuard: npm install -g docguard-cli\n`,
  );
  process.exit(1);
}
if (result.stderr) process.stderr.write(result.stderr);
process.stdout.write(result.stdout ?? "");
const status = result.status ?? 1;
process.exit(status === 127 ? 1 : status);
