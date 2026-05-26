/**
 * Memory Command — v0.17-P2.
 *
 * `docguard memory` shows the documentation-memory accuracy headline that
 * already appears in `docguard score`, but adds a `--diff` mode that drills
 * into WHICH claims don't match code. Reported by a Python user:
 *
 *   "Memory accuracy 83% with no drill-down. The headline number was the
 *    only signal — there's no `docguard memory --diff` to show which doc
 *    claim doesn't match the code."
 *
 * The numbers are the same ones `score` shows; this command's value is
 * making them inspectable per-domain.
 *
 * Domains drilled into:
 *   - Endpoints: API-REFERENCE.md vs scanned routes
 *   - Entities:  DATA-MODEL.md vs scanned schemas
 *   - Env vars:  ENVIRONMENT.md vs process.env / import.meta.env usage
 *   - Tech:      ARCHITECTURE.md vs detected stack
 *
 * Zero NPM dependencies. Pure orchestration of existing diff helpers.
 */

import { c } from '../shared.mjs';
import { diffRoutes, diffEntities, diffEnvVars, diffTechStack } from './diff.mjs';

/**
 * Compute an accuracy score for a single domain. Returns:
 *   { matched, total, accuracy: 0..100, onlyInDocs, onlyInCode }
 * `null` when the domain isn't applicable (e.g. no API-REFERENCE.md).
 */
function _domainAccuracy(d) {
  if (!d) return null;
  const matched = (d.matched || []).length;
  const onlyDocs = (d.onlyInDocs || []).length;
  const onlyCode = (d.onlyInCode || []).length;
  const total = matched + onlyDocs + onlyCode;
  if (total === 0) return null;
  return {
    title: d.title,
    icon: d.icon,
    matched,
    onlyInDocs: d.onlyInDocs || [],
    onlyInCode: d.onlyInCode || [],
    total,
    accuracy: Math.round((matched / total) * 100),
  };
}

export function runMemory(projectDir, config, flags) {
  const isJson = flags.format === 'json';
  const wantsDiff = flags.diff || (flags.args || []).includes('--diff');

  const domains = {
    endpoints: _domainAccuracy(diffRoutes(projectDir, config)),
    entities:  _domainAccuracy(diffEntities(projectDir, config)),
    envVars:   _domainAccuracy(diffEnvVars(projectDir, config)),
    techStack: _domainAccuracy(diffTechStack(projectDir, config)),
  };

  // Roll up across applicable domains.
  let totalMatched = 0;
  let totalChecks = 0;
  for (const d of Object.values(domains)) {
    if (!d) continue;
    totalMatched += d.matched;
    totalChecks += d.total;
  }
  const overallAccuracy = totalChecks > 0
    ? Math.round((totalMatched / totalChecks) * 100)
    : 0;

  if (isJson) {
    console.log(JSON.stringify({
      project: config.projectName,
      accuracy: overallAccuracy,
      domains,
      totals: { matched: totalMatched, checks: totalChecks },
      timestamp: new Date().toISOString(),
    }, null, 2));
    return;
  }

  // ── Text output ──
  console.log(`${c.bold}🧠 DocGuard Memory${c.reset} ${c.dim}— ${config.projectName}${c.reset}\n`);

  const accColor = overallAccuracy >= 90 ? c.green : overallAccuracy >= 70 ? c.yellow : c.red;
  console.log(`  ${c.bold}Accuracy:${c.reset} ${accColor}${overallAccuracy}%${c.reset} ${c.dim}(${totalMatched}/${totalChecks} doc claims match code)${c.reset}\n`);

  if (totalChecks === 0) {
    console.log(`  ${c.dim}No applicable domains found — add canonical docs (API-REFERENCE.md, DATA-MODEL.md, ENVIRONMENT.md) and rerun.${c.reset}`);
    return;
  }

  // Per-domain breakdown
  console.log(`  ${c.bold}By domain:${c.reset}`);
  for (const [name, d] of Object.entries(domains)) {
    if (!d) continue;
    const domainColor = d.accuracy >= 90 ? c.green : d.accuracy >= 70 ? c.yellow : c.red;
    console.log(`     ${d.icon} ${c.cyan}${d.title.padEnd(22)}${c.reset} ${domainColor}${String(d.accuracy).padStart(3)}%${c.reset}  ${c.dim}${d.matched}/${d.total} matched${c.reset}`);
  }

  if (!wantsDiff) {
    if (overallAccuracy < 100) {
      console.log(`\n  ${c.dim}Run ${c.cyan}docguard memory --diff${c.dim} to see WHICH claims don't match.${c.reset}`);
    }
    return;
  }

  // --diff mode: detail per domain
  console.log(`\n  ${c.bold}── Drill-down ──${c.reset}`);
  let anyShown = false;
  for (const [_, d] of Object.entries(domains)) {
    if (!d) continue;
    if (d.onlyInDocs.length === 0 && d.onlyInCode.length === 0) continue;
    anyShown = true;
    console.log(`\n  ${d.icon} ${c.bold}${d.title}${c.reset} ${c.dim}(${d.accuracy}%)${c.reset}`);

    if (d.onlyInDocs.length > 0) {
      console.log(`     ${c.red}✗ In docs but missing from code${c.reset} ${c.dim}(${d.onlyInDocs.length}):${c.reset}`);
      for (const item of d.onlyInDocs.slice(0, 10)) {
        console.log(`         ${c.red}-${c.reset} ${item}`);
      }
      if (d.onlyInDocs.length > 10) console.log(`         ${c.dim}... ${d.onlyInDocs.length - 10} more${c.reset}`);
    }

    if (d.onlyInCode.length > 0) {
      console.log(`     ${c.yellow}⚠ In code but missing from docs${c.reset} ${c.dim}(${d.onlyInCode.length}):${c.reset}`);
      for (const item of d.onlyInCode.slice(0, 10)) {
        console.log(`         ${c.yellow}+${c.reset} ${item}`);
      }
      if (d.onlyInCode.length > 10) console.log(`         ${c.dim}... ${d.onlyInCode.length - 10} more${c.reset}`);
    }
  }

  if (!anyShown) {
    console.log(`\n  ${c.green}✅ All claims match — nothing to drill into.${c.reset}`);
  } else {
    console.log(`\n  ${c.dim}Fix options:${c.reset}`);
    console.log(`    ${c.dim}• Removed-from-code items: ${c.cyan}docguard fix --write${c.dim} (deletes documented-but-absent endpoints)${c.reset}`);
    console.log(`    ${c.dim}• Missing-from-docs items: ${c.cyan}/docguard.fix --doc <name>${c.dim} (AI fills in the gap)${c.reset}`);
  }
}
