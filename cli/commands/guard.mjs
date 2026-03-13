/**
 * Guard Command — Validate project against its canonical documentation
 * Runs all enabled validators and reports results.
 */

import { c } from '../specguard.mjs';
import { validateStructure, validateDocSections } from '../validators/structure.mjs';
import { validateDrift } from '../validators/drift.mjs';
import { validateChangelog } from '../validators/changelog.mjs';
import { validateTestSpec } from '../validators/test-spec.mjs';
import { validateEnvironment } from '../validators/environment.mjs';
import { validateSecurity } from '../validators/security.mjs';
import { validateDocsSync } from '../validators/docs-sync.mjs';
import { validateArchitecture } from '../validators/architecture.mjs';

export function runGuard(projectDir, config, flags) {
  console.log(`${c.bold}🛡️  SpecGuard Guard — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  const allResults = [];
  const validators = config.validators || {};

  // Run each enabled validator
  const validatorMap = [
    { key: 'structure', name: 'Structure', fn: () => validateStructure(projectDir, config) },
    { key: 'structure', name: 'Doc Sections', fn: () => validateDocSections(projectDir, config) },
    { key: 'docsSync', name: 'Docs-Sync', fn: () => validateDocsSync(projectDir, config) },
    { key: 'drift', name: 'Drift', fn: () => validateDrift(projectDir, config) },
    { key: 'changelog', name: 'Changelog', fn: () => validateChangelog(projectDir, config) },
    { key: 'testSpec', name: 'Test-Spec', fn: () => validateTestSpec(projectDir, config) },
    { key: 'environment', name: 'Environment', fn: () => validateEnvironment(projectDir, config) },
    { key: 'security', name: 'Security', fn: () => validateSecurity(projectDir, config) },
    { key: 'architecture', name: 'Architecture', fn: () => validateArchitecture(projectDir, config) },
  ];

  for (const { key, name, fn } of validatorMap) {
    if (validators[key] === false) {
      if (flags.verbose) {
        console.log(`  ${c.dim}⏭️  ${name} (disabled)${c.reset}`);
      }
      continue;
    }

    try {
      const result = fn();
      allResults.push(result);

      // Display result
      const hasErrors = result.errors.length > 0;
      const hasWarnings = result.warnings.length > 0;

      if (!hasErrors && !hasWarnings) {
        console.log(`  ${c.green}✅ ${name}${c.reset}${c.dim}      ${result.passed}/${result.total} checks passed${c.reset}`);
      } else if (hasErrors) {
        console.log(`  ${c.red}❌ ${name}${c.reset}${c.dim}      ${result.passed}/${result.total} checks passed${c.reset}`);
      } else {
        console.log(`  ${c.yellow}⚠️  ${name}${c.reset}${c.dim}      ${result.passed}/${result.total} checks passed${c.reset}`);
      }

      // Show details in verbose mode or for errors
      if (flags.verbose || hasErrors) {
        for (const err of result.errors) {
          console.log(`     ${c.red}✗ ${err}${c.reset}`);
        }
      }
      if (flags.verbose || hasWarnings) {
        for (const warn of result.warnings) {
          console.log(`     ${c.yellow}⚠ ${warn}${c.reset}`);
        }
      }
    } catch (err) {
      console.log(`  ${c.red}💥 ${name} — validator crashed: ${err.message}${c.reset}`);
      allResults.push({ name, errors: [err.message], warnings: [], passed: 0, total: 1 });
    }
  }

  // Summary
  const totalErrors = allResults.reduce((sum, r) => sum + r.errors.length, 0);
  const totalWarnings = allResults.reduce((sum, r) => sum + r.warnings.length, 0);
  const totalPassed = allResults.reduce((sum, r) => sum + r.passed, 0);
  const totalChecks = allResults.reduce((sum, r) => sum + r.total, 0);

  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);

  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(`  ${c.green}${c.bold}✅ PASS${c.reset} ${c.green}— All ${totalChecks} checks passed${c.reset}`);
  } else if (totalErrors === 0) {
    console.log(`  ${c.yellow}${c.bold}⚠️  WARN${c.reset} ${c.yellow}— ${totalPassed}/${totalChecks} passed, ${totalWarnings} warning(s)${c.reset}`);
  } else {
    console.log(`  ${c.red}${c.bold}❌ FAIL${c.reset} ${c.red}— ${totalPassed}/${totalChecks} passed, ${totalErrors} error(s), ${totalWarnings} warning(s)${c.reset}`);
  }

  console.log('');

  // Exit code
  if (totalErrors > 0) {
    process.exit(1);
  } else if (totalWarnings > 0) {
    process.exit(2);
  } else {
    process.exit(0);
  }
}
