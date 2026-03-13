/**
 * Audit Command — Scan project, report what CDD docs exist or are missing
 * Now uses the full documentTypes config to show ALL docs with categories.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { c } from '../docguard.mjs';

export function runAudit(projectDir, config, flags) {
  console.log(`${c.bold}📋 DocGuard Audit — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  const results = { found: 0, missing: 0, optional: 0, total: 0, details: [] };

  // Use documentTypes from config (all 16 doc types with required/optional)
  const docTypes = config.documentTypes || {};

  // Group by category
  const categories = {};
  for (const [filePath, meta] of Object.entries(docTypes)) {
    const cat = meta.category || 'other';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push({ filePath, ...meta });
  }

  // Category display names and order
  const categoryLabels = {
    canonical: '📘 Canonical Documentation (Design Intent)',
    implementation: '📗 Implementation Documentation (Current State)',
    agent: '🤖 Agent Instructions',
    tracking: '📑 Change Tracking',
  };

  const categoryOrder = ['canonical', 'implementation', 'agent', 'tracking'];

  for (const cat of categoryOrder) {
    const docs = categories[cat];
    if (!docs || docs.length === 0) continue;

    console.log(`${c.bold}  ${categoryLabels[cat] || cat}${c.reset}`);

    for (const doc of docs) {
      const fullPath = resolve(projectDir, doc.filePath);
      const exists = existsSync(fullPath);

      if (exists) {
        results.found++;
        results.total++;
        results.details.push({ file: doc.filePath, status: 'found', required: doc.required });
        console.log(`    ${c.green}✅${c.reset} ${doc.filePath} ${c.dim}— ${doc.description}${c.reset}`);
      } else if (doc.required) {
        results.missing++;
        results.total++;
        results.details.push({ file: doc.filePath, status: 'missing', required: true });
        console.log(`    ${c.red}❌${c.reset} ${doc.filePath} ${c.dim}— ${doc.description}${c.reset} ${c.red}(required)${c.reset}`);
      } else {
        results.optional++;
        results.details.push({ file: doc.filePath, status: 'optional', required: false });
        if (flags.verbose) {
          console.log(`    ${c.dim}○  ${doc.filePath} — ${doc.description} (optional)${c.reset}`);
        }
      }
    }
    console.log('');
  }

  // Score (only required files)
  const requiredTotal = results.found + results.missing;
  const pct = requiredTotal === 0 ? 100 : Math.round((results.found / requiredTotal) * 100);
  const scoreColor = pct >= 80 ? c.green : pct >= 50 ? c.yellow : c.red;

  console.log(`${c.bold}  ─────────────────────────────────────${c.reset}`);
  console.log(`  ${c.bold}Required:${c.reset} ${scoreColor}${results.found - (results.found - requiredTotal + results.missing)}/${requiredTotal} files (${pct}%)${c.reset}`);

  // Show optional count
  if (!flags.verbose && results.optional > 0) {
    console.log(`  ${c.dim}Optional: ${results.optional} not present (use --verbose to see all)${c.reset}`);
  }

  if (results.missing > 0) {
    console.log(`\n  ${c.yellow}💡 Run ${c.cyan}docguard init${c.yellow} to create missing docs from templates.${c.reset}`);
    console.log(`  ${c.yellow}💡 Run ${c.cyan}docguard generate${c.yellow} to auto-fill docs from your codebase.${c.reset}`);
  } else {
    console.log(`\n  ${c.green}🎉 All required CDD documentation present!${c.reset}`);
    console.log(`  ${c.dim}Run ${c.cyan}docguard guard${c.dim} to validate content alignment.${c.reset}`);
    console.log(`  ${c.dim}Run ${c.cyan}docguard score${c.dim} to check your CDD maturity.${c.reset}`);
  }

  console.log('');
  return results;
}
