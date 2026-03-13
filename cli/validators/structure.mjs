/**
 * Structure Validator — Checks that all required CDD files exist
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function validateStructure(projectDir, config) {
  const results = { name: 'structure', errors: [], warnings: [], passed: 0, total: 0 };

  // Check canonical docs
  for (const file of config.requiredFiles.canonical) {
    results.total++;
    const fullPath = resolve(projectDir, file);
    if (existsSync(fullPath)) {
      results.passed++;
    } else {
      results.errors.push(`Missing required file: ${file}`);
    }
  }

  // Check agent file (any one is fine)
  results.total++;
  const agentFileFound = config.requiredFiles.agentFile.some(f =>
    existsSync(resolve(projectDir, f))
  );
  if (agentFileFound) {
    results.passed++;
  } else {
    results.errors.push(`Missing agent file: ${config.requiredFiles.agentFile.join(' or ')}`);
  }

  // Check changelog
  results.total++;
  if (existsSync(resolve(projectDir, config.requiredFiles.changelog))) {
    results.passed++;
  } else {
    results.errors.push(`Missing required file: ${config.requiredFiles.changelog}`);
  }

  // Check drift log
  results.total++;
  if (existsSync(resolve(projectDir, config.requiredFiles.driftLog))) {
    results.passed++;
  } else {
    results.errors.push(`Missing required file: ${config.requiredFiles.driftLog}`);
  }

  return results;
}

/**
 * Check that canonical doc files contain required sections
 */
export function validateDocSections(projectDir, config) {
  const results = { name: 'doc-sections', errors: [], warnings: [], passed: 0, total: 0 };

  const requiredSections = {
    'docs-canonical/ARCHITECTURE.md': ['## System Overview', '## Component Map', '## Tech Stack'],
    'docs-canonical/DATA-MODEL.md': ['## Entities'],
    'docs-canonical/SECURITY.md': ['## Authentication', '## Secrets Management'],
    'docs-canonical/TEST-SPEC.md': ['## Test Categories', '## Coverage Rules'],
    'docs-canonical/ENVIRONMENT.md': ['## Environment Variables', '## Setup Steps'],
  };

  for (const [file, sections] of Object.entries(requiredSections)) {
    const fullPath = resolve(projectDir, file);
    if (!existsSync(fullPath)) continue; // Structure validator handles missing files

    const content = readFileSync(fullPath, 'utf-8');

    for (const section of sections) {
      results.total++;
      if (content.includes(section)) {
        results.passed++;
      } else {
        results.warnings.push(`${file}: missing section "${section}"`);
      }
    }
  }

  return results;
}
