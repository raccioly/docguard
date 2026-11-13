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
 *   2. README "N validators" matches the shipped `cli/validators/*.mjs`
 *      module count. Guard may emit multiple check results from one module;
 *      those are not extra public validator modules.
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

import { rootAgentDocs } from '../shared-agent-instructions.mjs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { countValidatorModules } from '../shared-validator-surface.mjs';
import { contractFields } from '../shared-result-contract.mjs';
import { explainPaddedEmpty } from '../shared-project-evidence.mjs';

/**
 * Does this kind of check belong to the project? Only DocGuard's own repository
 * has a surface for it to police: it applies when package.json names the
 * DocGuard package itself.
 *
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir) {
  const pkgPath = resolve(projectDir, 'package.json');
  if (!existsSync(pkgPath)) return { applies: false, evidence: 'no package.json, so the project is not the docguard-cli package' };
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')); } catch {
    // An unreadable package.json cannot show the project is something else.
    return { applies: true, evidence: 'package.json is unreadable, so it cannot be shown that the project is not the docguard-cli package' };
  }
  if (pkg.name !== 'docguard-cli') return { applies: false, evidence: `package.json names "${pkg.name ?? ''}", not the docguard-cli package whose own surface this validator polices` };
  return { applies: true, evidence: 'package.json names the docguard-cli package, so its README and agent documents describe a surface to check' };
}

/**
 * Validate that README count claims about DocGuard's surface match code-truth.
 * Returns N/A for non-DocGuard projects.
 *
 * @param {string} projectDir - Project root directory
 * @param {object} config - DocGuard config (unused but required by validator interface)
 * @param {Array} [guardResults] - Results array from runGuardInternal (optional but recommended)
 *
 * v0.29: migrated to structured findings (CSY001–CSY004). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings array at every return point.
 * @returns {{ errors: string[], warnings: string[], fixes: object[], passed: number, total: number, na?: boolean, naReason?: string }}
 */
export function validateCanonicalSync(projectDir, config, guardResults) {
  const findings = [];
  const fixes = [];
  let passed = 0;
  let total = 0;
  // Claim kinds the surface documents actually state. `total` counts every check, claim or not,
  // so `performed` is the count that matters: a check with no claim to compare made no comparison.
  let claimed = 0;
  // Compose the legacy result shape (plus findings) at every return point.
  const compose = (extra, why = {}) => ({
    ...resultFromFindings(findings, { passed, total }), fixes, ...extra,
    ...explainPaddedEmpty(contractFields({
      performed: claimed,
      found: findings.length > 0,
      ran: `${claimed} surface claim kind(s) compared with the code`,
      decide: () => applies(projectDir),
      empty: d => (d.applies
        ? { emptyCause: why.cause || 'needs-content', note: why.note || 'Canonical-Sync found no surface claim to compare in README.md or the agent-instruction documents.', howToConfigure: why.how || 'README.md and the root agent-instruction documents state none of the counts this validator compares. State one: "ships N commands" or "all N commands", "N validators", or the diagram labels `Commands (N)` and `Validators (N)`; the validator then compares each with the code.' }
        : { emptyCause: 'nothing-of-this-kind', note: `Canonical-Sync checks only the docguard-cli package: ${d.evidence}.`, howToConfigure: 'Nothing to configure: Canonical-Sync polices the surface of the docguard-cli repository (its README claims against cli/commands and cli/validators) and applies to no other project.' }),
    })),
  });

  // ── Gate: only run in DocGuard's own repo ─────────────────────────────
  const pkgPath = resolve(projectDir, 'package.json');
  if (!existsSync(pkgPath)) {
    return compose({ na: true, naReason: 'no package.json' });
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  } catch {
    return compose({ na: true, naReason: 'unreadable package.json' }, { cause: 'layout-not-recognized', note: 'Canonical-Sync could not read package.json, so it could not tell whether this is the docguard-cli package.', how: 'package.json is not valid JSON. Fix it so that Canonical-Sync can read the package name.' });
  }

  if (pkg.name !== 'docguard-cli') {
    return compose({
      na: true,
      naReason: 'canonical-sync only runs in the docguard-cli repo (it polices DocGuard\'s own surface)',
    });
  }

  // ── Gather code-truth ────────────────────────────────────────────────
  const cliDir = resolve(projectDir, 'cli');
  const commandsDir = resolve(cliDir, 'commands');
  const validatorsDir = resolve(cliDir, 'validators');

  if (!existsSync(commandsDir) || !existsSync(validatorsDir)) {
    return compose({ na: true, naReason: 'cli/commands or cli/validators not found' }, { cause: 'layout-not-recognized', note: 'Canonical-Sync found the docguard-cli package but not its cli/commands and cli/validators directories.', how: 'Canonical-Sync counts cli/commands/*.mjs and cli/validators/*.mjs. Run it from the root of the docguard-cli repository, where both directories exist.' });
  }

  const commandFiles = readdirSync(commandsDir).filter(f => f.endsWith('.mjs'));
  const actualCommandFileCount = commandFiles.length;

  // v0.20: the user-facing command count is what shows up in --help's "Daily 5"
  // and "Tools" sections — NOT the file count, since deprecation aliases dispatch
  // through the same files. Parse cli/docguard.mjs to find names in those
  // sections so the README claim and code-truth stay in lockstep across renames.
  const cliEntry = resolve(cliDir, 'docguard.mjs');
  let actualUserFacingCount = actualCommandFileCount; // fallback if parse fails
  if (existsSync(cliEntry)) {
    try {
      const cliSrc = readFileSync(cliEntry, 'utf-8');
      // Match `${c.green}<name>${c.reset}` inside the Daily 5 / Tools blocks.
      // Anything in init --with / Deprecation aliases sections uses c.dim, so
      // they're naturally excluded.
      const helpBlock = cliSrc.match(/The Daily 5[\s\S]*?Deprecation aliases/);
      if (helpBlock) {
        const greenNames = [...helpBlock[0].matchAll(/\$\{c\.green\}(\w+)\$\{c\.reset\}/g)]
          .map(m => m[1]);
        // Unique names (init shows up only once)
        actualUserFacingCount = [...new Set(greenNames)].length;
      }
    } catch { /* fall through to file-count fallback */ }
  }
  const actualCommandCount = actualUserFacingCount;

  // Validator count is the package capability count used by
  // Metrics-Consistency too. It is run-order independent and excludes extra
  // sub-check results emitted by a validator module (for example, Doc Sections
  // from structure.mjs), which are checks rather than shipped validators.
  const actualValidatorCount = countValidatorModules(validatorsDir);
  if (actualValidatorCount === null) {
    return compose({ na: true, naReason: 'cli/validators could not be read' }, { cause: 'layout-not-recognized', note: 'Canonical-Sync could not read cli/validators to count the shipped validator modules.', how: 'cli/validators exists but could not be read; check its permissions so the validator modules can be counted.' });
  }

  // ── Read surface docs (README.md + AGENTS.md) ──────────────────────
  // Both carry "N commands / N validators" surface claims. Scanning only the
  // README is why AGENTS.md's counts ("Commands (15 total)", "24 validators")
  // drifted unchecked for releases — close that gap by checking both.
  // docguard.agent-instruction-role#FR-002: README plus the role's root-level documents.
  const surfaceFiles = ['README.md', ...rootAgentDocs(projectDir)];
  let readme = '';
  let readAny = false;
  for (const f of surfaceFiles) {
    const p = resolve(projectDir, f);
    if (!existsSync(p)) continue;
    try { readme += readFileSync(p, 'utf-8') + '\n'; readAny = true; } catch { /* skip unreadable */ }
  }
  if (!readAny) {
    findings.push(mkFinding({
      code: 'CSY001',
      validator: 'canonicalSync',
      severity: 'warn',
      message: 'canonical-sync: no README.md or AGENTS.md found — cannot check surface claims',
      location: 'README.md',
      suggestion: { kind: 'review', text: 'Add a README.md (or AGENTS.md) so DocGuard can police its own surface claims' },
    }));
    total = 1;
    return compose();
  }

  // ── Check 1: "ships N commands" ─────────────────────────────────────
  // Check ALL claims (matchAll), not just the first: with README + AGENTS.md
  // concatenated, a correct claim in one file must not mask a stale claim in
  // the other (the same first-match-masking trap the secret scanner had).
  // The phrase set is every way the surface docs have stated the total:
  // "ships N commands", "covers all N CLI commands", "all N commands",
  // "supports N commands". "Covers all 15 CLI commands" sat in the README for
  // 92 releases because only the first shape was matched.
  total++;
  const cmdMatches = [...readme.matchAll(/\b(?:ships|covers(?:\s+all)?|supports(?:\s+all)?|all)\s+\*{0,2}(\d+)\s+(?:CLI\s+)?commands?\*{0,2}/gi)];
  if (cmdMatches.length > 0) {
    claimed++;
    const wrong = [...new Set(cmdMatches.filter(m => Number(m[1]) !== actualCommandCount).map(m => m[0].replace(/\*/g, '')))];
    if (wrong.length === 0) {
      passed++;
    } else {
      const detail = actualUserFacingCount !== actualCommandFileCount
        ? `${actualCommandCount} user-facing commands in --help (${actualCommandFileCount} files including deprecation aliases)`
        : `${actualCommandCount} command file(s)`;
      findings.push(mkFinding({
        code: 'CSY002',
        validator: 'canonicalSync',
        severity: 'warn',
        message: `A surface doc (README.md/AGENTS.md) claims ${wrong.map(p => `"${p}"`).join(' / ')} but the real count is ${detail}. Update it.`,
        location: null,
        suggestion: { kind: 'fix', text: 'Update the command-count claim in README.md/AGENTS.md to the real count' },
      }));
    }
  } else {
    // No claim found — that's OK, just don't check this one
    passed++;
  }

  // ── Check 2: "N validators" in surface context ──────────────────────
  // Match phrases like "22 validators", "all 22 validators", "the 22 validators"
  // but NOT phase-log entries like "Built with 9 validators" (those are
  // historical, and ROADMAP.md/CHANGELOG.md are skipped at the file level).
  total++;
  const validatorMatches = [...readme.matchAll(/(?:all|the|with|across|ships?)\s+\*{0,2}(\d+)\s+validators?\*{0,2}/gi)];
  if (validatorMatches.length > 0) {
    claimed++;
    const wrongClaims = validatorMatches
      .map(m => Number(m[1]))
      .filter(n => n !== actualValidatorCount);
    if (wrongClaims.length === 0) {
      passed++;
    } else {
      const uniqueWrong = [...new Set(wrongClaims)];
      findings.push(mkFinding({
        code: 'CSY003',
        validator: 'canonicalSync',
        severity: 'warn',
        message: `A surface doc (README.md/AGENTS.md) claims ${uniqueWrong.map(n => `"${n} validators"`).join(' / ')} but DocGuard ships ${actualValidatorCount} validator modules. Update it.`,
        location: null,
        suggestion: { kind: 'fix', text: 'Update the "N validators" claim in README.md/AGENTS.md to match DocGuard\'s shipped validator modules' },
      }));
    }
  } else {
    passed++;
  }

  // ── Check 3: architecture-diagram counts ────────────────────────────
  // Catches the specific "Commands (N)" and "Validators (N)" patterns in
  // the mermaid block that drifted across 5 releases.
  total++;
  const archMatches = [
    { re: /Commands\s*\((\d+)\)/, label: 'Commands', expected: actualCommandCount },
    { re: /Validators\s*\((\d+)\)/, label: 'Validators', expected: actualValidatorCount },
  ];
  const archWrong = [];
  for (const { re, label, expected } of archMatches) {
    const m = readme.match(re);
    if (m) claimed++;
    if (m && Number(m[1]) !== expected) {
      archWrong.push(`${label} (${m[1]}) → should be (${expected})`);
    }
  }
  if (archWrong.length === 0) {
    passed++;
  } else {
    findings.push(mkFinding({
      code: 'CSY004',
      validator: 'canonicalSync',
      severity: 'warn',
      message: `README.md architecture diagram has stale counts: ${archWrong.join('; ')}. Update the mermaid block.`,
      location: 'README.md',
      suggestion: { kind: 'fix', text: 'Update the Commands (N) / Validators (N) labels in the README mermaid block' },
    }));
  }

  return compose();
}
