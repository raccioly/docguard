/**
 * Structure Validator — Checks that all required CDD files exist
 *
 * v0.29: migrated to structured findings (STR001–STR003). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings, so counts, exit codes, and
 * existing tests are unaffected; guard just renders richer output.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { docHasSection } from '../shared.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';

export function validateStructure(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;

  const missingFile = (file) => mkFinding({
    code: 'STR001',
    validator: 'structure',
    severity: 'error',
    message: `Missing required file: ${file}`,
    location: file,
    suggestion: { kind: 'fix', text: 'Create it from the professional template', command: 'docguard init' },
  });

  // Check canonical docs
  for (const file of config.requiredFiles.canonical) {
    total++;
    const fullPath = resolve(projectDir, file);
    if (existsSync(fullPath)) {
      passed++;
    } else {
      findings.push(missingFile(file));
    }
  }

  // Check agent file (any one is fine) — defensive: tolerate missing config
  // shapes (B-5 class of safety net: never let a config gap leak as a
  // ReferenceError / TypeError into the user's guard output).
  const agentFiles = Array.isArray(config.requiredFiles?.agentFile)
    ? config.requiredFiles.agentFile
    : (typeof config.requiredFiles?.agentFile === 'string' ? [config.requiredFiles.agentFile] : []);
  if (agentFiles.length > 0) {
    total++;
    const agentFileFound = agentFiles.some(f =>
      existsSync(resolve(projectDir, f))
    );
    if (agentFileFound) {
      passed++;
    } else {
      findings.push(mkFinding({
        code: 'STR002',
        validator: 'structure',
        severity: 'error',
        message: `Missing agent file: ${agentFiles.join(' or ')}`,
        location: agentFiles[0],
        suggestion: { kind: 'fix', text: 'Create the agent instructions file', command: 'docguard init' },
      }));
    }
  }

  // Check changelog — same defensive pattern.
  const changelogPath = config.requiredFiles?.changelog;
  if (changelogPath) {
    total++;
    if (existsSync(resolve(projectDir, changelogPath))) {
      passed++;
    } else {
      findings.push(missingFile(changelogPath));
    }
  }

  // Check drift log
  total++;
  if (existsSync(resolve(projectDir, config.requiredFiles.driftLog))) {
    passed++;
  } else {
    findings.push(missingFile(config.requiredFiles.driftLog));
  }

  return { name: 'structure', ...resultFromFindings(findings, { passed, total }) };
}

/**
 * Check that canonical doc files contain required sections
 */
export function validateDocSections(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;
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
      total++;
      // Match a real heading (H2–H6), not a substring in a TOC link or code
      // block. v0.24: synonym- and section-number-tolerant via docHasSection, so
      // arc42/C4 docs ("## 5.4 Layer boundaries", "## Building Block View")
      // count instead of being told to add a section they already have.
      const headingText = section.replace(/^#+\s*/, '');
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
      if (docHasSection(content, section)) {
        passed++;
      } else if (naRe.test(content)) {
        // v0.16-P7: explicit N/A — counts as passed (the project has owned
        // the absence) and doesn't pollute the warnings list.
        passed++;
      } else {
        findings.push(mkFinding({
          code: 'STR003',
          validator: 'structure',
          severity: 'warn',
          message: `${file}: missing section "${section}". ` +
            `If genuinely not applicable, add: <!-- docguard:section ${slug} n/a — your reason -->`,
          location: file,
          suggestion: {
            kind: 'suppress',
            text: 'Add the section, or own the absence with the inline N/A marker',
            pragma: `<!-- docguard:section ${slug} n/a — your reason -->`,
          },
        }));
      }
    }
  }

  return { name: 'doc-sections', ...resultFromFindings(findings, { passed, total }) };
}
