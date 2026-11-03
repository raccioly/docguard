// aidlc-sensor-docguard-guard.ts — AI-DLC sensor wrapper for DocGuard
// (docguard plugin). Thin by design: every decision is made by the DocGuard
// CLI (`docguard sensor --aidlc`), which DocGuard's own Node test suite covers.
// This file only runs it with the dispatcher's arguments and passes its output
// through. It never exits 127: AI-DLC records 127 as a pass ("tool-unavailable"),
// and a missing DocGuard must read as "could not run".
//
// AI-DLC's sensor contract: export main(argv). A native install imports this
// file in-process and calls main with the sensor's arguments, where
// process.argv holds the engine's own; run directly (bun …), import.meta.main
// is true and main gets process.argv.
import { spawnSync } from "node:child_process";

export function main(argv: string[]): void {
  const bin = process.env.DOCGUARD_BIN || "docguard";
  const result = spawnSync(bin, ["sensor", "--aidlc", ...argv], {
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
}

if (import.meta.main) main(process.argv.slice(2));
