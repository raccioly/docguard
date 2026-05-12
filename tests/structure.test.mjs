import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateStructure, validateDocSections } from '../cli/validators/structure.mjs';

describe('validateStructure', () => {
  it('should pass when all required files are present', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-structure-pass-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });

    // Create required canonical docs
    fs.writeFileSync(join(tempDir, 'docs-canonical', 'ARCHITECTURE.md'), '');
    fs.writeFileSync(join(tempDir, 'docs-canonical', 'DATA-MODEL.md'), '');
    fs.writeFileSync(join(tempDir, 'AGENTS.md'), '');
    fs.writeFileSync(join(tempDir, 'CHANGELOG.md'), '');
    fs.writeFileSync(join(tempDir, 'DRIFT.md'), '');

    const config = {
      requiredFiles: {
        canonical: [
          'docs-canonical/ARCHITECTURE.md',
          'docs-canonical/DATA-MODEL.md'
        ],
        agentFile: ['AGENTS.md', '.cursorrules'],
        changelog: 'CHANGELOG.md',
        driftLog: 'DRIFT.md'
      }
    };

    try {
      const results = validateStructure(tempDir, config);
      assert.equal(results.name, 'structure');
      assert.equal(results.total, 5); // 2 canonical + 1 agent + 1 changelog + 1 drift
      assert.equal(results.passed, 5);
      assert.equal(results.errors.length, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should fail when files are missing', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-structure-fail-'));
    // Do not create any files

    const config = {
      requiredFiles: {
        canonical: [
          'docs-canonical/ARCHITECTURE.md',
          'docs-canonical/DATA-MODEL.md'
        ],
        agentFile: ['AGENTS.md', '.cursorrules'],
        changelog: 'CHANGELOG.md',
        driftLog: 'DRIFT.md'
      }
    };

    try {
      const results = validateStructure(tempDir, config);
      assert.equal(results.total, 5);
      assert.equal(results.passed, 0);
      assert.equal(results.errors.length, 5);
      assert.ok(results.errors.some(e => e.includes('Missing required file: docs-canonical/ARCHITECTURE.md')));
      assert.ok(results.errors.some(e => e.includes('Missing required file: docs-canonical/DATA-MODEL.md')));
      assert.ok(results.errors.some(e => e.includes('Missing agent file: AGENTS.md or .cursorrules')));
      assert.ok(results.errors.some(e => e.includes('Missing required file: CHANGELOG.md')));
      assert.ok(results.errors.some(e => e.includes('Missing required file: DRIFT.md')));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('validateDocSections', () => {
  it('should pass when required sections are present', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-sections-pass-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });

    // Create file with sections
    fs.writeFileSync(join(tempDir, 'docs-canonical', 'ARCHITECTURE.md'), '## System Overview\n## Component Map\n## Tech Stack');
    fs.writeFileSync(join(tempDir, 'docs-canonical', 'DATA-MODEL.md'), '## Entities');
    fs.writeFileSync(join(tempDir, 'docs-canonical', 'SECURITY.md'), '## Authentication\n## Secrets Management');
    fs.writeFileSync(join(tempDir, 'docs-canonical', 'TEST-SPEC.md'), '## Test Categories\n## Coverage Rules');
    fs.writeFileSync(join(tempDir, 'docs-canonical', 'ENVIRONMENT.md'), '## Environment Variables\n## Setup Steps');


    const config = {
      projectTypeConfig: {
        needsDatabase: true,
        needsEnvVars: true
      }
    };

    try {
      const results = validateDocSections(tempDir, config);
      assert.equal(results.name, 'doc-sections');
      assert.equal(results.total, 10);
      assert.equal(results.passed, 10);
      assert.equal(results.warnings.length, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate warnings for missing sections', () => {
    const tempDir = fs.mkdtempSync(join(tmpdir(), 'docguard-test-sections-fail-'));
    fs.mkdirSync(join(tempDir, 'docs-canonical'), { recursive: true });

    // Create file with NO sections
    fs.writeFileSync(join(tempDir, 'docs-canonical', 'ARCHITECTURE.md'), 'Some text');

    const config = {
      projectTypeConfig: {
        needsDatabase: false,
        needsEnvVars: false
      }
    };

    try {
      const results = validateDocSections(tempDir, config);
      // Data Model shouldn't be checked for sections if needsDatabase is false
      // Environment should only check Setup Steps
      assert.equal(results.total, 3); // 3 in ARCHITECTURE
      assert.equal(results.passed, 0);
      assert.equal(results.warnings.length, 3);
      assert.ok(results.warnings.some(w => w.includes('ARCHITECTURE.md: missing section "## System Overview"')));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
