/**
 * Spec-Kit Validator — Validates Spec Kit artifacts (specs/, plans/, tasks/, constitution).
 *
 * v0.19-D: Architectural move. The validation logic still lives in
 * `scanners/speckit.mjs` (where the spec-kit data is scanned), but the
 * validator entry-point now lives here in `validators/` so the file count
 * matches the validator count. This also makes the canonical-sync validator's
 * truth source (`ls cli/validators/*.mjs`) align with what `guard` reports.
 *
 * Re-exports `validateSpecKitIntegration` from the scanner. Importers should
 * use this path (`validators/spec-kit.mjs`) going forward.
 *
 * v0.29: the validator emits structured findings (SPK001–SPK007); the
 * migration lives in `scanners/speckit.mjs` alongside the validation logic.
 */

export { validateSpecKitIntegration } from '../scanners/speckit.mjs';
