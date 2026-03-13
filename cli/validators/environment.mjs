/**
 * Environment Validator — Checks ENVIRONMENT.md docs and .env.example
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function validateEnvironment(projectDir, config) {
  const results = { name: 'environment', errors: [], warnings: [], passed: 0, total: 0 };

  const envDocPath = resolve(projectDir, 'docs-canonical/ENVIRONMENT.md');
  if (!existsSync(envDocPath)) {
    return results; // Structure validator catches missing files
  }

  const content = readFileSync(envDocPath, 'utf-8');

  // Check for required sections
  results.total++;
  if (content.includes('## Environment Variables')) {
    results.passed++;
  } else {
    results.warnings.push('ENVIRONMENT.md: missing "## Environment Variables" section');
  }

  results.total++;
  if (content.includes('## Setup Steps')) {
    results.passed++;
  } else {
    results.warnings.push('ENVIRONMENT.md: missing "## Setup Steps" section');
  }

  // Check if .env.example is referenced
  if (content.includes('.env.example')) {
    results.total++;
    if (existsSync(resolve(projectDir, '.env.example'))) {
      results.passed++;
    } else {
      results.warnings.push(
        'ENVIRONMENT.md references .env.example but the file does not exist'
      );
    }
  }

  // Check if any .env file exists but no .env.example is provided
  results.total++;
  const hasEnvFile = ['.env', '.env.local', '.env.development'].some(f =>
    existsSync(resolve(projectDir, f))
  );
  const hasEnvExample = existsSync(resolve(projectDir, '.env.example'));

  if (hasEnvFile && !hasEnvExample) {
    results.warnings.push(
      '.env file exists but no .env.example template — new contributors won\'t know what vars to set'
    );
  } else {
    results.passed++;
  }

  return results;
}
