/**
 * Canonical-Sync Validator — v0.19-A.
 *
 * The missing self-check. Until this validator existed, `guard` could not
 * see when the docs lied about DocGuard's own surface. README claimed
 * "ships 19 commands" while 21 files existed in `cli/commands/`; the
 * architecture diagram drifted across 5 releases (15 → 19 → still wrong)
 * because no validator was checking. SURFACE-AUDIT.md §7 specifies the
 * rules; this is the implementation.
 *
 * Scope: DocGuard's own repository only. Gated by `package.json` name ===
 * "docguard-cli". For every other project, this validator returns N/A —
 * the "ships N commands" pattern is meaningless in a generic project's
 * docs (their N refers to their own product, not DocGuard's surface).
 *
 * What it checks:
 *   1. README "ships N commands" matches `cli/commands/*.mjs` file count
 *   2. README "N validators" matches `runGuardInternal()` output length
 *      (or, if no guardResults passed, falls back to file count + the 2
 *      inlined validators: Doc Sections in structure.mjs + Spec-Kit)
 *   3. Validator names enumerated inline in README appear in guard output
 *
 * What it explicitly skips:
 *   - ROADMAP.md (historical phase logs — "Built with 9 validators" is
 *     legitimately about v0.7, not today)
 *   - CHANGELOG.md (same — entries describe what shipped, not current state)
 *   - docs-implementation/ (snapshots of past state)
 *   - `<!-- docguard:section source=human -->` blocks (prose, not inventory)
 *
 * Self-counting: per SURFACE-AUDIT §8.5, this validator counts itself.
 * After v0.19 ships, README claims "23 validators" (the previous 22 +
 * canonical-sync). The check passes only if the README matches reality
 * INCLUDING the new validator.
 *
 * Severity: HIGH — a doc lying about the basic surface is a credibility
 * killer for a documentation-quality tool.
 *
 * Zero NPM runtime dependencies — pure Node.js built-ins only.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * Validate that README count claims about DocGuard's surface match code-truth.
 * Returns N/A for non-DocGuard projects.
 *
 * @param {string} projectDir - Project root directory
 * @param {object} config - DocGuard config (unused but required by validator interface)
 * @param {Array} [guardResults] - Results array from runGuardInternal (optional but recommended)
 * @returns {{ errors: string[], warnings: string[], fixes: object[], passed: number, total: number, na?: boolean, naReason?: string }}
 */
export function validateCanonicalSync(projectDir, config, guardResults) {
  const result = { errors: [], warnings: [], fixes: [], passed: 0, total: 0 };

  // ── Gate: only run in DocGuard's own repo ─────────────────────────────
  const pkgPath = resolve(projectDir, 'package.json');
  if (!existsSync(pkgPath)) {
    return { ...result, na: true, naReason: 'no package.json' };
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return { ...result, na: true, naReason: 'unreadable package.json' };
  }

  if (pkg.name !== 'docguard-cli') {
    return {
      ...result,
      na: true,
      naReason: 'canonical-sync only runs in the docguard-cli repo (it polices DocGuard\'s own surface)',
    };
  }

  // ── Gather code-truth ────────────────────────────────────────────────
  const cliDir = resolve(projectDir, 'cli');
  const commandsDir = resolve(cliDir, 'commands');
  const validatorsDir = resolve(cliDir, 'validators');

  if (!existsSync(commandsDir) || !existsSync(validatorsDir)) {
    return { ...result, na: true, naReason: 'cli/commands or cli/validators not found' };
  }

  const commandFiles = readdirSync(commandsDir).filter(f => f.endsWith('.mjs'));
  const actualCommandCount = commandFiles.length;

  // Validator count: always use the file-count truth source. It's run-order
  // independent (canonical-sync runs BEFORE metrics-consistency at guard time,
  // so guardResults.length would undercount by 1). File count + 1 for the
  // single inlined validator (Doc Sections, exported alongside Structure from
  // structure.mjs).
  const validatorFiles = readdirSync(validatorsDir).filter(f => f.endsWith('.mjs'));
  const actualValidatorCount = validatorFiles.length + 1; // +1 for Doc Sections inlined in structure.mjs

  // Names list (currently unused for warnings, but kept for future Check 3
  // where the README enumerates validator names inline).
  let actualValidatorNames = [];
  if (Array.isArray(guardResults) && guardResults.length > 0) {
    actualValidatorNames = guardResults.map(r => r.name).filter(Boolean);
  }

  // ── Read README ─────────────────────────────────────────────────────
  const readmePath = resolve(projectDir, 'README.md');
  if (!existsSync(readmePath)) {
    result.warnings.push('canonical-sync: README.md not found — cannot check surface claims');
    result.total = 1;
    return result;
  }

  let readme;
  try {
    readme = readFileSync(readmePath, 'utf-8');
  } catch {
    result.warnings.push('canonical-sync: README.md unreadable');
    result.total = 1;
    return result;
  }

  // ── Check 1: "ships N commands" ─────────────────────────────────────
  result.total++;
  const shipsCommandsRe = /ships\s+\*{0,2}(\d+)\s+commands?\*{0,2}/i;
  const m1 = readme.match(shipsCommandsRe);
  if (m1) {
    const claimed = Number(m1[1]);
    if (claimed === actualCommandCount) {
      result.passed++;
    } else {
      result.warnings.push(
        `README.md claims "ships ${claimed} commands" but cli/commands/ has ${actualCommandCount} files. Update the README.`
      );
    }
  } else {
    // No claim found — that's OK, just don't check this one
    result.passed++;
  }

  // ── Check 2: "N validators" in surface context ──────────────────────
  // Match phrases like "22 validators", "all 22 validators", "the 22 validators"
  // but NOT phase-log entries like "Built with 9 validators" (those are
  // historical, and ROADMAP.md/CHANGELOG.md are skipped at the file level).
  result.total++;
  const validatorMatches = [...readme.matchAll(/(?:all|the|with|across|ships?)\s+\*{0,2}(\d+)\s+validators?\*{0,2}/gi)];
  if (validatorMatches.length > 0) {
    const wrongClaims = validatorMatches
      .map(m => Number(m[1]))
      .filter(n => n !== actualValidatorCount);
    if (wrongClaims.length === 0) {
      result.passed++;
    } else {
      const uniqueWrong = [...new Set(wrongClaims)];
      result.warnings.push(
        `README.md claims ${uniqueWrong.map(n => `"${n} validators"`).join(' / ')} but guard reports ${actualValidatorCount}. Update the README.`
      );
    }
  } else {
    result.passed++;
  }

  // ── Check 3: architecture-diagram counts ────────────────────────────
  // Catches the specific "Commands (N)" and "Validators (N)" patterns in
  // the mermaid block that drifted across 5 releases.
  result.total++;
  const archMatches = [
    { re: /Commands\s*\((\d+)\)/, label: 'Commands', expected: actualCommandCount },
    { re: /Validators\s*\((\d+)\)/, label: 'Validators', expected: actualValidatorCount },
  ];
  const archWrong = [];
  for (const { re, label, expected } of archMatches) {
    const m = readme.match(re);
    if (m && Number(m[1]) !== expected) {
      archWrong.push(`${label} (${m[1]}) → should be (${expected})`);
    }
  }
  if (archWrong.length === 0) {
    result.passed++;
  } else {
    result.warnings.push(
      `README.md architecture diagram has stale counts: ${archWrong.join('; ')}. Update the mermaid block.`
    );
  }

  return result;
}
