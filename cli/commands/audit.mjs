/**
 * Audit Command — Scan project, report what CDD docs exist or are missing
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { c } from '../specguard.mjs';

export function runAudit(projectDir, config, flags) {
  console.log(`${c.bold}📋 SpecGuard Audit — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  const results = { found: 0, missing: 0, total: 0, details: [] };

  // Check canonical docs
  console.log(`${c.bold}  Canonical Documentation:${c.reset}`);
  for (const file of config.requiredFiles.canonical) {
    const fullPath = resolve(projectDir, file);
    const exists = existsSync(fullPath);
    results.total++;
    if (exists) {
      results.found++;
      results.details.push({ file, status: 'found' });
      console.log(`    ${c.green}✅${c.reset} ${file}`);
    } else {
      results.missing++;
      results.details.push({ file, status: 'missing' });
      console.log(`    ${c.red}❌${c.reset} ${file}`);
    }
  }

  // Check agent file (any of the options)
  console.log(`\n${c.bold}  Agent Instructions:${c.reset}`);
  const agentFileFound = config.requiredFiles.agentFile.some(f =>
    existsSync(resolve(projectDir, f))
  );
  results.total++;
  if (agentFileFound) {
    results.found++;
    const foundFile = config.requiredFiles.agentFile.find(f =>
      existsSync(resolve(projectDir, f))
    );
    results.details.push({ file: foundFile, status: 'found' });
    console.log(`    ${c.green}✅${c.reset} ${foundFile}`);
  } else {
    results.missing++;
    results.details.push({
      file: config.requiredFiles.agentFile.join(' or '),
      status: 'missing',
    });
    console.log(
      `    ${c.red}❌${c.reset} ${config.requiredFiles.agentFile.join(' or ')}`
    );
  }

  // Check changelog
  console.log(`\n${c.bold}  Change Tracking:${c.reset}`);
  const changelogPath = resolve(projectDir, config.requiredFiles.changelog);
  results.total++;
  if (existsSync(changelogPath)) {
    results.found++;
    results.details.push({ file: config.requiredFiles.changelog, status: 'found' });
    console.log(`    ${c.green}✅${c.reset} ${config.requiredFiles.changelog}`);
  } else {
    results.missing++;
    results.details.push({ file: config.requiredFiles.changelog, status: 'missing' });
    console.log(`    ${c.red}❌${c.reset} ${config.requiredFiles.changelog}`);
  }

  // Check drift log
  const driftPath = resolve(projectDir, config.requiredFiles.driftLog);
  results.total++;
  if (existsSync(driftPath)) {
    results.found++;
    results.details.push({ file: config.requiredFiles.driftLog, status: 'found' });
    console.log(`    ${c.green}✅${c.reset} ${config.requiredFiles.driftLog}`);
  } else {
    results.missing++;
    results.details.push({ file: config.requiredFiles.driftLog, status: 'missing' });
    console.log(`    ${c.red}❌${c.reset} ${config.requiredFiles.driftLog}`);
  }

  // Score
  const pct = Math.round((results.found / results.total) * 100);
  const scoreColor = pct >= 80 ? c.green : pct >= 50 ? c.yellow : c.red;

  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);
  console.log(
    `  ${c.bold}Score:${c.reset} ${scoreColor}${results.found}/${results.total} required files (${pct}%)${c.reset}`
  );

  if (results.missing > 0) {
    console.log(
      `\n  ${c.yellow}💡 Run ${c.cyan}specguard init${c.yellow} to create missing docs from templates.${c.reset}`
    );
  } else {
    console.log(`\n  ${c.green}🎉 All CDD documentation present!${c.reset}`);
    console.log(
      `  ${c.dim}Run ${c.cyan}specguard guard${c.dim} to validate content alignment.${c.reset}`
    );
  }

  console.log('');

  // Check optional recommended files
  if (flags.verbose) {
    console.log(`${c.bold}  Recommended (Optional):${c.reset}`);
    const recommended = [
      'docs-canonical/FEATURES.md',
      'docs-canonical/MESSAGE-FLOWS.md',
      'docs-canonical/DEPLOYMENT.md',
      'docs-canonical/ADR.md',
      'docs-canonical/ERROR-CODES.md',
      'docs-canonical/API-REFERENCE.md',
      'docs-implementation/CURRENT-STATE.md',
      'docs-implementation/TROUBLESHOOTING.md',
      'docs-implementation/RUNBOOKS.md',
      'docs-implementation/MIGRATION-GUIDE.md',
      'AGENT-REFERENCE.md',
      'CONTRIBUTING.md',
    ];

    for (const file of recommended) {
      const exists = existsSync(resolve(projectDir, file));
      console.log(
        `    ${exists ? `${c.green}✅` : `${c.dim}○`}${c.reset} ${file}`
      );
    }
    console.log('');
  }

  return results;
}
