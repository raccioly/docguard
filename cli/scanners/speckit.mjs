/**
 * Spec Kit Scanner — Detect, validate, and integrate with GitHub Spec Kit
 *
 * Auto-detects Spec Kit artifacts and validates their quality against
 * spec-kit standards (github.com/github/spec-kit).
 *
 * v0.9.5 — Aligned with spec-kit's actual file structure:
 *   .specify/                          → Project uses Spec Kit
 *   .specify/specs/NNN-feature/spec.md → Requirements (FR-IDs, User Scenarios)
 *   .specify/specs/NNN-feature/plan.md → Implementation plan (Technical Context)
 *   .specify/specs/NNN-feature/tasks.md → Task breakdown (Phased)
 *   .specify/memory/constitution.md    → Project governing principles
 *
 * Also supports legacy paths (pre-v3 spec-kit):
 *   specs/[name]/spec.md              → Legacy spec location
 *   constitution.md                   → Legacy constitution at root
 *   memory/                           → Legacy memory at root
 *
 * Credit: Integration with GitHub's Spec Kit framework
 *         (github.com/github/spec-kit)
 *
 * Zero NPM runtime dependencies — pure Node.js built-ins only.
 */

import { existsSync, readFileSync, readdirSync, statSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// ──── Spec Kit Mandatory Sections ────
// Based on spec-kit's spec-template.md, plan-template.md, tasks-template.md

const SPEC_MANDATORY_SECTIONS = [
  'User Scenarios',        // or "User Stories"
  'Requirements',          // must have FR-xxx IDs
  'Success Criteria',      // must have SC-xxx IDs
];

const PLAN_MANDATORY_SECTIONS = [
  'Summary',
  'Technical Context',
  'Project Structure',
];

const TASKS_MANDATORY_PATTERNS = [
  /Phase\s+\d/i,           // Must have phased breakdown
];

// ──── Safety Helper ────

/**
 * Create a .bak backup before overwriting existing files.
 */
function backupFile(filePath) {
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (content.trim().length > 0) {
        copyFileSync(filePath, filePath + '.bak');
      }
    } catch { /* non-fatal */ }
  }
}

function safeWrite(filePath, content) {
  backupFile(filePath);
  writeFileSync(filePath, content, 'utf-8');
}

// ──── Detection ────

/**
 * Scan a specs directory for feature spec folders.
 * Returns array of { name, hasSpec, hasPlan, hasTasks, specPath, planPath, tasksPath }.
 */
function scanSpecsDir(specsDir) {
  const specs = [];
  if (!existsSync(specsDir)) return specs;

  try {
    const features = readdirSync(specsDir);
    for (const feature of features) {
      const featureDir = join(specsDir, feature);
      try {
        if (!statSync(featureDir).isDirectory()) continue;
      } catch { continue; }

      const specFile = join(featureDir, 'spec.md');
      const planFile = join(featureDir, 'plan.md');
      const tasksFile = join(featureDir, 'tasks.md');

      if (existsSync(specFile) || existsSync(planFile) || existsSync(tasksFile)) {
        specs.push({
          name: feature,
          hasSpec: existsSync(specFile),
          hasPlan: existsSync(planFile),
          hasTasks: existsSync(tasksFile),
          specPath: existsSync(specFile) ? specFile : null,
          planPath: existsSync(planFile) ? planFile : null,
          tasksPath: existsSync(tasksFile) ? tasksFile : null,
        });
      }
    }
  } catch { /* ignore */ }

  return specs;
}

/**
 * Detect if a project uses Spec Kit.
 * Checks both spec-kit v3+ paths (.specify/) and legacy paths.
 *
 * @returns {{ detected, specifyDir, specs[], constitution, constitutionPath, memory, source }}
 */
export function detectSpecKit(projectDir) {
  const result = {
    detected: false,
    specifyDir: false,
    specs: [],
    constitution: false,
    constitutionPath: null,
    memory: false,
    source: null,  // 'specify' (v3+) or 'legacy'
  };

  // ── 1. Check for .specify/ directory (v3+ standard) ──
  const specifyDir = resolve(projectDir, '.specify');
  if (existsSync(specifyDir)) {
    result.detected = true;
    result.specifyDir = true;
    result.source = 'specify';

    // Specs under .specify/specs/ (v3 standard path)
    const v3Specs = scanSpecsDir(resolve(specifyDir, 'specs'));
    if (v3Specs.length > 0) {
      result.specs.push(...v3Specs);
    }

    // Constitution at .specify/memory/constitution.md (v3 standard)
    const v3Constitution = resolve(specifyDir, 'memory', 'constitution.md');
    if (existsSync(v3Constitution)) {
      result.constitution = true;
      result.constitutionPath = v3Constitution;
    }

    // Memory directory at .specify/memory/ (v3 standard)
    const v3Memory = resolve(specifyDir, 'memory');
    if (existsSync(v3Memory)) {
      result.memory = true;
    }
  }

  // ── 2. Legacy paths (fallback for pre-v3 or manual setups) ──
  // Only check legacy if not already detected via .specify/
  if (result.specs.length === 0) {
    const legacySpecs = scanSpecsDir(resolve(projectDir, 'specs'));
    if (legacySpecs.length > 0) {
      result.detected = true;
      result.source = result.source || 'legacy';
      result.specs.push(...legacySpecs);
    }
  }

  // Constitution at project root (legacy)
  if (!result.constitution) {
    const rootConstitution = resolve(projectDir, 'constitution.md');
    if (existsSync(rootConstitution)) {
      result.detected = true;
      result.constitution = true;
      result.constitutionPath = rootConstitution;
      result.source = result.source || 'legacy';
    }
  }

  // Memory at project root (legacy)
  if (!result.memory) {
    const rootMemory = resolve(projectDir, 'memory');
    if (existsSync(rootMemory)) {
      result.detected = true;
      result.memory = true;
      result.source = result.source || 'legacy';
    }
  }

  return result;
}

// ──── Quality Validation ────

/**
 * Check if a markdown file contains specific section headings.
 *
 * @param {string} content - File content
 * @param {string[]} sections - Required section heading texts
 * @returns {{ found: string[], missing: string[] }}
 */
function checkSections(content, sections) {
  const found = [];
  const missing = [];

  for (const section of sections) {
    // Match both "## Requirements" and "### Functional Requirements"
    const pattern = new RegExp(`^#{1,4}\\s+.*${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'im');
    if (pattern.test(content)) {
      found.push(section);
    } else {
      missing.push(section);
    }
  }

  return { found, missing };
}

/**
 * Validate the quality of a spec.md file against spec-kit standards.
 *
 * Checks:
 *   - Has mandatory sections (User Scenarios, Requirements, Success Criteria)
 *   - Has FR-xxx requirement IDs
 *   - Has acceptance scenarios (Given/When/Then)
 */
function validateSpecQuality(specPath) {
  const issues = [];
  const content = readFileSync(specPath, 'utf-8');

  // Check mandatory sections
  const { missing } = checkSections(content, SPEC_MANDATORY_SECTIONS);
  for (const section of missing) {
    issues.push(`Missing mandatory section: "${section}" (spec-kit spec-template.md)`);
  }

  // Check for FR-xxx or FR-NNN requirement IDs
  const hasFRIds = /\b(FR|REQ|NFR)-\d{2,4}\b/.test(content);
  if (!hasFRIds) {
    issues.push('No requirement IDs found (expected FR-001, REQ-001, etc.)');
  }

  // Check for SC-xxx success criteria IDs
  const hasSCIds = /\bSC-\d{2,4}\b/.test(content);
  if (!hasSCIds) {
    issues.push('No success criteria IDs found (expected SC-001, SC-002, etc.)');
  }

  return issues;
}

/**
 * Validate the quality of a plan.md file.
 */
function validatePlanQuality(planPath) {
  const issues = [];
  const content = readFileSync(planPath, 'utf-8');

  const { missing } = checkSections(content, PLAN_MANDATORY_SECTIONS);
  for (const section of missing) {
    issues.push(`Missing mandatory section: "${section}" (spec-kit plan-template.md)`);
  }

  return issues;
}

/**
 * Validate the quality of a tasks.md file.
 */
function validateTasksQuality(tasksPath) {
  const issues = [];
  const content = readFileSync(tasksPath, 'utf-8');

  // Must have phased breakdown
  const hasPhases = TASKS_MANDATORY_PATTERNS.some(p => p.test(content));
  if (!hasPhases) {
    issues.push('No phased task breakdown found (expected "Phase 1:", "Phase 2:", etc.)');
  }

  // Must have task IDs
  const hasTaskIds = /\bT\d{3}\b/.test(content);
  if (!hasTaskIds) {
    issues.push('No task IDs found (expected T001, T002, etc.)');
  }

  return issues;
}

// ──── CDD Mapping ────

const SPECKIT_CDD_MAP = {
  'spec.md': { cddDoc: 'REQUIREMENTS.md', section: 'Requirements', type: 'requirement' },
  'plan.md': { cddDoc: 'ARCHITECTURE.md', section: 'Design Decisions', type: 'design' },
  'tasks.md': { cddDoc: 'ROADMAP.md', section: 'Task Backlog', type: 'roadmap' },
};

// ──── Generate from Spec Kit ────

/**
 * Generate CDD canonical docs from Spec Kit artifacts.
 * Used by `docguard generate --from-speckit`.
 */
export function generateFromSpecKit(projectDir, config, flags) {
  const results = { generated: [], skipped: [], errors: [] };

  const speckit = detectSpecKit(projectDir);
  if (!speckit.detected) {
    results.errors.push('No Spec Kit artifacts detected. Run `specify init` to initialize, or install via: uv tool install specify-cli --from git+https://github.com/github/spec-kit.git');
    return results;
  }

  // ── Generate REQUIREMENTS.md from spec.md files ──
  if (speckit.specs.some(s => s.hasSpec)) {
    const reqPath = resolve(projectDir, 'REQUIREMENTS.md');
    if (existsSync(reqPath) && !flags.force) {
      results.skipped.push('REQUIREMENTS.md already exists (use --force to overwrite)');
    } else {
      const lines = [
        '# Requirements',
        '',
        '> Auto-generated from Spec Kit spec.md files by DocGuard',
        '',
      ];

      for (const spec of speckit.specs) {
        if (!spec.hasSpec) continue;
        const content = readFileSync(spec.specPath, 'utf-8');

        lines.push(`## ${spec.name}`);
        lines.push('');
        lines.push(content.trim());
        lines.push('');
        lines.push('---');
        lines.push('');
      }

      lines.push(`<!-- Generated by DocGuard from Spec Kit artifacts on ${new Date().toISOString().split('T')[0]} -->`);

      safeWrite(reqPath, lines.join('\n'));
      results.generated.push('REQUIREMENTS.md');
    }
  }

  // ── Map constitution.md to AGENTS.md context ──
  if (speckit.constitution) {
    const agentsPath = resolve(projectDir, 'AGENTS.md');

    if (existsSync(agentsPath)) {
      const agentsContent = readFileSync(agentsPath, 'utf-8');
      if (!agentsContent.includes('constitution.md') && !agentsContent.includes('Constitution')) {
        results.skipped.push('AGENTS.md exists but does not reference constitution.md — consider adding a reference');
      } else {
        results.skipped.push('AGENTS.md already references constitution.md');
      }
    }
  }

  // ── Map memory/ to DRIFT-LOG.md ──
  if (speckit.memory) {
    results.skipped.push('memory/ directory detected — maps conceptually to DRIFT-LOG.md');
  }

  return results;
}

// ──── Guard Validator ────

/**
 * Validate Spec Kit integration quality.
 *
 * When spec-kit is NOT detected:
 *   - Shows 1 informational warning suggesting spec-kit
 *
 * When spec-kit IS detected:
 *   - Validates spec.md quality (mandatory sections, FR-IDs, SC-IDs)
 *   - Validates plan.md quality (mandatory sections)
 *   - Validates tasks.md quality (phased breakdown, T-IDs)
 *   - Checks constitution → AGENTS.md mapping
 *
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateSpecKitIntegration(projectDir, config) {
  const results = { errors: [], warnings: [], passed: 0, total: 0 };

  const speckit = detectSpecKit(projectDir);

  // If no Spec Kit detected, suggest it
  if (!speckit.detected) {
    results.total++;
    results.warnings.push(
      'No Spec Kit artifacts detected. Consider `specify init` for spec-driven development (github.com/github/spec-kit)'
    );
    return results;
  }

  // ── Check 1: .specify/ directory exists ──
  results.total++;
  if (speckit.specifyDir) {
    results.passed++;
  } else {
    results.warnings.push(
      'Spec Kit artifacts found but .specify/ directory missing. Run `specify init` to create standard structure'
    );
  }

  // ── Check 2: Validate each spec's quality ──
  for (const spec of speckit.specs) {
    // 2a: spec.md quality
    if (spec.hasSpec && spec.specPath) {
      results.total++;
      try {
        const issues = validateSpecQuality(spec.specPath);
        if (issues.length === 0) {
          results.passed++;
        } else {
          for (const issue of issues) {
            results.warnings.push(`specs/${spec.name}/spec.md: ${issue}`);
          }
        }
      } catch {
        results.warnings.push(`specs/${spec.name}/spec.md: Could not read file`);
      }
    }

    // 2b: plan.md quality
    if (spec.hasPlan && spec.planPath) {
      results.total++;
      try {
        const issues = validatePlanQuality(spec.planPath);
        if (issues.length === 0) {
          results.passed++;
        } else {
          for (const issue of issues) {
            results.warnings.push(`specs/${spec.name}/plan.md: ${issue}`);
          }
        }
      } catch {
        results.warnings.push(`specs/${spec.name}/plan.md: Could not read file`);
      }
    }

    // 2c: tasks.md quality
    if (spec.hasTasks && spec.tasksPath) {
      results.total++;
      try {
        const issues = validateTasksQuality(spec.tasksPath);
        if (issues.length === 0) {
          results.passed++;
        } else {
          for (const issue of issues) {
            results.warnings.push(`specs/${spec.name}/tasks.md: ${issue}`);
          }
        }
      } catch {
        results.warnings.push(`specs/${spec.name}/tasks.md: Could not read file`);
      }
    }
  }

  // ── Check 3: Constitution → AGENTS.md mapping ──
  if (speckit.constitution) {
    results.total++;
    const agentsPath = resolve(projectDir, 'AGENTS.md');
    if (existsSync(agentsPath)) {
      results.passed++;
    } else {
      results.warnings.push('constitution.md exists but no AGENTS.md found. Create one for AI agent rules');
    }
  }

  return results;
}
