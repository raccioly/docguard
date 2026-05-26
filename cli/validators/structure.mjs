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

  // Check agent file (any one is fine) — defensive: tolerate missing config
  // shapes (B-5 class of safety net: never let a config gap leak as a
  // ReferenceError / TypeError into the user's guard output).
  const agentFiles = Array.isArray(config.requiredFiles?.agentFile)
    ? config.requiredFiles.agentFile
    : (typeof config.requiredFiles?.agentFile === 'string' ? [config.requiredFiles.agentFile] : []);
  if (agentFiles.length > 0) {
    results.total++;
    const agentFileFound = agentFiles.some(f =>
      existsSync(resolve(projectDir, f))
    );
    if (agentFileFound) {
      results.passed++;
    } else {
      results.errors.push(`Missing agent file: ${agentFiles.join(' or ')}`);
    }
  }

  // Check changelog — same defensive pattern.
  const changelogPath = config.requiredFiles?.changelog;
  if (changelogPath) {
    results.total++;
    if (existsSync(resolve(projectDir, changelogPath))) {
      results.passed++;
    } else {
      results.errors.push(`Missing required file: ${changelogPath}`);
    }
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
  const ptc = config.projectTypeConfig || {};

  const requiredSections = {
    'docs-canonical/ARCHITECTURE.md': ['## System Overview', '## Component Map', '## Tech Stack'],
    'docs-canonical/DATA-MODEL.md': ptc.needsDatabase !== false
      ? ['## Entities']
      : [], // CLI/library projects don't need entity docs
    'docs-canonical/SECURITY.md': ['## Authentication', '## Secrets Management'],
    'docs-canonical/TEST-SPEC.md': ['## Test Categories', '## Coverage Rules'],
    'docs-canonical/ENVIRONMENT.md': ptc.needsEnvVars !== false
      ? ['## Environment Variables', '## Setup Steps']
      : ['## Setup Steps'], // Always need setup steps, env vars optional
  };

  for (const [file, sections] of Object.entries(requiredSections)) {
    const fullPath = resolve(projectDir, file);
    if (!existsSync(fullPath)) continue;

    const content = readFileSync(fullPath, 'utf-8');

    for (const section of sections) {
      results.total++;
      // Match an actual heading at line start (any level), not a substring that
      // could appear in a table-of-contents link or a code block.
      const headingText = section.replace(/^#+\s*/, '');
      const escapedHeading = headingText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const headingRe = new RegExp('^#{2,6}\\s+' + escapedHeading + '\\b', 'm');
      // v0.16-P7: N/A marker. A project can declare a required section as
      // "not applicable" via an HTML comment instead of writing boilerplate
      // "Absent by design" prose. Format:
      //   <!-- docguard:section authentication n/a — JWT not used; we're a CLI -->
      // The section name in the marker is matched case-insensitively against
      // the heading slug (lowercase, hyphenated). Requires a reason after `—`
      // or `--` so it's not a silent opt-out.
      const slug = headingText.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');
      // Reason must start with an actual letter or digit (not `>` from `-->`
      // and not whitespace). This makes sure `<!-- ... n/a -->` (no reason)
      // is rejected, while `<!-- ... n/a — CLI tool -->` is accepted.
      const naRe = new RegExp(
        '<!--\\s*docguard:section\\s+' + slug.replace(/-/g, '[-_]') + '\\s+n/a\\s*[—-]+\\s*[A-Za-z0-9]',
        'i'
      );
      if (headingRe.test(content)) {
        results.passed++;
      } else if (naRe.test(content)) {
        // v0.16-P7: explicit N/A — counts as passed (the project has owned
        // the absence) and doesn't pollute the warnings list.
        results.passed++;
      } else {
        results.warnings.push(
          `${file}: missing section "${section}". ` +
          `If genuinely not applicable, add: <!-- docguard:section ${slug} n/a — your reason -->`
        );
      }
    }
  }

  return results;
}
