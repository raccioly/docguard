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
import { resolve, join, relative, dirname, basename, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { isGitRepo } from '../shared-git.mjs';
import { walkFiles } from '../shared-ignore.mjs';
import { readScannable } from '../shared-source.mjs';

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

  // Bugfix / lightweight specs document a defect (symptom → root cause → fix),
  // not a feature (User Scenarios / Requirements / Success Criteria with FR/SC
  // IDs). The full feature template doesn't fit them — forcing it produces
  // ceremony, not clarity. Opt in with `<!-- docguard:spec-type bugfix -->`
  // and we validate the bugfix-appropriate shape instead: the spec must still
  // state a Root Cause and a Fix, so it's a narrower check, not a free pass.
  if (/<!--\s*docguard:spec-type\s+(?:bugfix|lightweight|patch)\b/i.test(content)) {
    const { missing } = checkSections(content, ['Root Cause', 'Fix']);
    for (const section of missing) {
      issues.push(`Bugfix spec missing "${section}" — a defect spec must state its root cause and fix`);
    }
    return issues;
  }

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

// ──── Phantom-Completion Detection (SPK008/SPK009, v0.30) ────
//
// A `- [x]` in tasks.md is a CLAIM that work landed. An agent (or human) that
// checks a task without landing the artifact corrupts the project's memory:
// every later session trusts the checkbox and skips the work. This check
// verifies the claim deterministically — "lie detection" for tasks.md.
//
// PRECISION-FIRST DESIGN — a false accusation of lying is worse than a miss:
//   • Only tasks that make a FALSIFIABLE artifact claim can be flagged: the
//     task line must name at least one repo-relative path (slashed, or with an
//     explicit trailing `/` for directories). Prose-only tasks ("Review the
//     approach"), bare filenames ("buildspec.yml" may describe the DOMAIN, not
//     a deliverable), and tasks whose only reference is a task ID are counted
//     as unverifiable and never flagged — flagging them is FP soup.
//   • A task is phantom only when EVERY evidence tier comes up empty:
//       a. any named path exists (project root or the feature dir);
//       b. a named basename exists anywhere in the repo (file was moved);
//       c. a backticked code symbol from the task line appears in source;
//       d. sibling plan.md/spec.md name an existing deliverable that the task
//          text also mentions;
//       e. the task ID (T001…) appears in a source/test file annotation;
//       f. the task ID appears in a git commit message (skipped silently when
//          the project is not a git repo or git is unavailable).
//     Evidence false-positives are SAFE (they suppress an accusation), so the
//     tiers are deliberately generous.

const CHECKED_TASK_RE = /^\s*-\s*\[[xX]\]\s*(T\d{3,4})?\s*(.+)$/;
const MAX_PHANTOM_FINDINGS = 10;

/** Code-ish extensions whose content can carry task-ID / symbol evidence. */
const EVIDENCE_CODE_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.go', '.rs', '.java', '.rb', '.php', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.sh', '.sql',
  '.yml', '.yaml', '.json', '.toml',
]);

/**
 * Parse checked tasks (`- [x] T001 …`) out of a tasks.md.
 * Returns [{ id, text, line }] with 1-based line numbers. The task ID is also
 * recovered from a leading bold/decorated form (`**T001**`) when the plain
 * position doesn't match.
 */
export function parseCheckedTasks(content) {
  const tasks = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(CHECKED_TASK_RE);
    if (!m) continue;
    const text = m[2].trim();
    let id = m[1] || null;
    if (!id) {
      const decorated = text.match(/^[*_~[(]*\s*(T\d{3,4})\b/);
      if (decorated) id = decorated[1];
    }
    tasks.push({ id, text, line: i + 1 });
  }
  return tasks;
}

/**
 * Extract path-like tokens from a task line.
 *
 * `claims` — slashed paths (or explicit `dir/` syntax): falsifiable
 *   deliverable claims. Only these can convict.
 * `soft` — bare filenames (`CHANGELOG.md`) and extension-less slashed tokens
 *   (`cli/commands`): positive evidence ONLY, never grounds for flagging —
 *   prose mentions of foreign/domain filenames (and "and/or"-style prose
 *   slashes, which the charset+extension rules reject as claims) must not
 *   convict.
 *
 * Rejected outright (unverifiable or unsafe to resolve): tokens with spaces,
 * globs/placeholders, absolute paths (URL routes like `/api/users` are not
 * repo files), and `..` segments (never resolve outside the project).
 */
export function extractPathTokens(text) {
  const claims = new Set();
  const soft = new Set();
  const consider = (tokRaw) => {
    let tok = tokRaw.trim().replace(/^\.\//, '').replace(/:\d+(?::\d+)?$/, '');
    if (!tok || tok.length > 200 || /\s/.test(tok)) return;
    if (/[*?{}<>|]/.test(tok)) return;
    if (tok.startsWith('/')) return;
    if (/(^|\/)\.\.(\/|$)/.test(tok)) return;
    const isDirSyntax = tok.endsWith('/');
    tok = tok.replace(/\/+$/, '');
    if (!tok || !/^\.?[\w@][\w@./-]*$/.test(tok)) return;
    if (tok.includes('/')) {
      const last = tok.slice(tok.lastIndexOf('/') + 1);
      if (/\.[A-Za-z]\w{0,9}$/.test(last) || isDirSyntax) claims.add(tok);
      else soft.add(tok);
    } else if (/\.[A-Za-z]\w{0,9}$/.test(tok)) {
      soft.add(tok); // bare filename — rejects version numbers like `18.0`
    }
  };
  for (const m of text.matchAll(/`([^`]+)`/g)) consider(m[1]);
  for (const m of text.matchAll(/(?:^|[\s("'[])((?:[\w@.-]+\/)+[\w@.-]+\/?)/g)) consider(m[1]);
  return { claims, soft };
}

/**
 * Backticked identifier-like tokens (`globMatch(relPath, patterns)` → globMatch,
 * `IGNORE_DIRS` → IGNORE_DIRS). Used as an evidence tier: a task that names a
 * function/constant that exists in source was plainly not skipped. Min length 4
 * keeps trivially-common words from being extracted at all (an over-match here
 * only suppresses an accusation, so the filter is intentionally loose).
 */
export function extractSymbolTokens(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([^`]+)`/g)) {
    const tok = m[1].trim();
    const call = tok.match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (call && call[1].length >= 4) { out.add(call[1]); continue; }
    if (/^[A-Za-z_$][\w$]*$/.test(tok) && tok.length >= 4) out.add(tok);
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does any of the named tokens exist relative to root or the feature dir? */
function anyPathExists(projectDir, featureDir, tokens) {
  for (const tok of tokens) {
    if (existsSync(resolve(projectDir, tok))) return true;
    if (featureDir && existsSync(resolve(featureDir, tok))) return true;
  }
  return false;
}

/**
 * Existing deliverable paths named by the feature's sibling plan.md/spec.md.
 * Returns { paths: Set<string>, basenames: Set<string> } — only tokens that
 * exist on disk count (a plan mentioning a path is design, not evidence;
 * a plan mentioning an EXISTING path ties the deliverable to reality).
 */
function collectSiblingArtifacts(projectDir, spec) {
  const paths = new Set();
  const basenames = new Set();
  const featureDir = spec.tasksPath ? dirname(spec.tasksPath) : null;
  for (const p of [spec.planPath, spec.specPath]) {
    if (!p) continue;
    let content;
    try { content = readFileSync(p, 'utf-8'); } catch { continue; }
    const { claims, soft } = extractPathTokens(content);
    for (const tok of [...claims, ...soft]) {
      if (existsSync(resolve(projectDir, tok)) || (featureDir && existsSync(resolve(featureDir, tok)))) {
        paths.add(tok);
        const base = basename(tok);
        if (base.length >= 5) basenames.add(base); // ≥5 avoids `a.ts`-scale collisions
      }
    }
  }
  return { paths, basenames };
}

/**
 * ONE repo walk that resolves every deferred needle at once: basenames of
 * needed files (any extension, so a moved deliverable still evidences), and
 * task-IDs / code symbols inside code-ish files. Dot-entries are skipped
 * (so specs' own markdown never self-evidences) except .github, whose
 * workflows are legitimate deliverables.
 */
function scanRepoForEvidence(projectDir, needles) {
  const found = { basenames: new Set(), symbols: new Set(), ids: new Set() };
  const symbolRes = new Map();
  for (const sym of needles.symbols) symbolRes.set(sym, new RegExp(`\\b${escapeRe(sym)}\\b`));
  const wantContent = needles.ids.size > 0 || symbolRes.size > 0;
  walkFiles(projectDir, (absPath) => {
    const base = basename(absPath);
    if (needles.basenames.has(base)) found.basenames.add(base);
    if (!wantContent) return;
    if (!EVIDENCE_CODE_EXTS.has(extname(absPath).toLowerCase())) return;
    if (found.ids.size === needles.ids.size && found.symbols.size === symbolRes.size) return;
    const content = readScannable(absPath);
    if (!content) return;
    if (needles.ids.size > found.ids.size) {
      for (const m of content.matchAll(/\bT\d{3,4}\b/g)) {
        if (needles.ids.has(m[0])) found.ids.add(m[0]);
      }
    }
    for (const [sym, re] of symbolRes) {
      if (!found.symbols.has(sym) && re.test(content)) found.symbols.add(sym);
    }
  }, { keepDot: (entry) => entry === '.github' });
  return found;
}

/**
 * Is the task ID referenced in a commit message? `--grep` narrows in git;
 * the JS word-boundary re-check drops substring hits (T001 vs T0010).
 * `--format=%B` (not --oneline) so a body-only mention still counts.
 * Fails closed to `false` — a missing git binary or empty history just
 * means this tier contributes no evidence.
 */
function taskIdInGitLog(projectDir, id) {
  try {
    const out = execFileSync(
      'git',
      ['log', `--grep=${id}`, '--format=%B'],
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 }
    );
    return new RegExp(`\\b${id}(?!\\d)`).test(out);
  } catch {
    return false;
  }
}

/**
 * Run phantom-completion detection across all detected features.
 *
 * Two passes: cheap per-task tiers first (named paths on disk, sibling
 * artifacts); tasks still unevidenced go into ONE batched repo scan
 * (basenames + symbols + task-ID annotations), then a per-ID git-log lookup
 * (cached; skipped silently when not a git repo).
 *
 * @returns {Array<{spec, relPath, checkedCount, unverifiableCount,
 *                  phantoms: Array<{id, text, line, tiers: string[]}>}>}
 */
export function detectPhantomCompletions(projectDir, specs) {
  const results = [];
  const pending = [];
  const siblingCache = new Map();

  for (const spec of specs) {
    if (!spec.hasTasks || !spec.tasksPath) continue;
    let content;
    try { content = readFileSync(spec.tasksPath, 'utf-8'); } catch { continue; } // SPK006 covers unreadable
    const tasks = parseCheckedTasks(content);
    const entry = {
      spec,
      relPath: relative(projectDir, spec.tasksPath),
      checkedCount: tasks.length,
      unverifiableCount: 0,
      phantoms: [],
    };
    results.push(entry);
    if (tasks.length === 0) continue;

    const featureDir = dirname(spec.tasksPath);
    for (const task of tasks) {
      const { claims, soft } = extractPathTokens(task.text);
      if (claims.size === 0) { entry.unverifiableCount++; continue; } // no falsifiable claim
      // Tier a: any named path exists (claims convict; soft tokens only evidence)
      if (anyPathExists(projectDir, featureDir, claims) || anyPathExists(projectDir, featureDir, soft)) continue;
      // Tier d: sibling plan/spec name an existing deliverable this task mentions
      if (!siblingCache.has(featureDir)) siblingCache.set(featureDir, collectSiblingArtifacts(projectDir, spec));
      const sibling = siblingCache.get(featureDir);
      const hasSiblingDocs = Boolean(spec.planPath || spec.specPath);
      let rescued = false;
      for (const p of sibling.paths) { if (task.text.includes(p)) { rescued = true; break; } }
      if (!rescued) for (const b of sibling.basenames) { if (task.text.includes(b)) { rescued = true; break; } }
      if (rescued) continue;
      // Defer tiers b/c/e/f to the batched repo scan + git lookup
      pending.push({
        entry, task, hasSiblingDocs,
        basenames: new Set([...claims].map((t) => basename(t)).concat([...soft].filter((t) => !t.includes('/')))),
        symbols: extractSymbolTokens(task.text),
      });
    }
  }

  if (pending.length > 0) {
    const needles = { basenames: new Set(), symbols: new Set(), ids: new Set() };
    for (const p of pending) {
      for (const b of p.basenames) needles.basenames.add(b);
      for (const s of p.symbols) needles.symbols.add(s);
      if (p.task.id) needles.ids.add(p.task.id);
    }
    const found = scanRepoForEvidence(projectDir, needles);
    let repo = null; // lazy: only shell out when an ID actually needs the git tier
    const gitCache = new Map();
    for (const p of pending) {
      if ([...p.basenames].some((b) => found.basenames.has(b))) continue; // tier b: moved file
      if ([...p.symbols].some((s) => found.symbols.has(s))) continue;     // tier c: symbol landed
      if (p.task.id && found.ids.has(p.task.id)) continue;                // tier e: source annotation
      let gitTierRan = false;
      if (p.task.id) {
        if (repo === null) repo = isGitRepo(projectDir);
        if (repo) {
          gitTierRan = true;
          if (!gitCache.has(p.task.id)) gitCache.set(p.task.id, taskIdInGitLog(projectDir, p.task.id));
          if (gitCache.get(p.task.id)) continue;                          // tier f: commit trail
        }
      }
      const tiers = ['named paths', 'repo file names'];
      if (p.hasSiblingDocs) tiers.push('plan/spec artifacts');
      if (p.symbols.size > 0) tiers.push('code symbols');
      if (p.task.id) tiers.push('task-ID in source');
      if (gitTierRan) tiers.push('git log');
      p.entry.phantoms.push({ id: p.task.id, text: p.task.text, line: p.task.line, tiers });
    }
  }

  return results;
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
 *
 * v0.29: migrated to structured findings (SPK001–SPK007). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings, so counts, exit codes, and
 * existing tests are unaffected; guard just renders richer output.
 *
 * v0.30: adds phantom-completion detection (SPK008, elision SPK009) — tasks
 * marked [x] whose named deliverables don't exist and have no other
 * implementation evidence (see the Phantom-Completion Detection section
 * above for the tier design). Opt out per-project with
 * `"specKit": { "phantomCheck": false }` in .docguard.json.
 */
export function validateSpecKitIntegration(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;

  const speckit = detectSpecKit(projectDir);

  // If no Spec Kit detected, suggest it
  if (!speckit.detected) {
    total++;
    findings.push(mkFinding({
      code: 'SPK001',
      validator: 'specKit',
      severity: 'warn',
      message: 'No Spec Kit artifacts detected. Consider `specify init` for spec-driven development (github.com/github/spec-kit)',
      location: null,
      suggestion: { kind: 'review', text: 'Adopt spec-driven development by initializing Spec Kit', command: 'specify init' },
    }));
    return resultFromFindings(findings, { passed, total });
  }

  // ── Check 1: .specify/ directory exists ──
  total++;
  if (speckit.specifyDir) {
    passed++;
  } else {
    findings.push(mkFinding({
      code: 'SPK002',
      validator: 'specKit',
      severity: 'warn',
      message: 'Spec Kit artifacts found but .specify/ directory missing. Run `specify init` to create standard structure',
      location: '.specify',
      suggestion: { kind: 'fix', text: 'Create the standard Spec Kit structure', command: 'specify init' },
    }));
  }

  // ── Check 2: Validate each spec's quality ──
  for (const spec of speckit.specs) {
    // 2a: spec.md quality
    if (spec.hasSpec && spec.specPath) {
      total++;
      const loc = relative(projectDir, spec.specPath);
      try {
        const issues = validateSpecQuality(spec.specPath);
        if (issues.length === 0) {
          passed++;
        } else {
          for (const issue of issues) {
            findings.push(mkFinding({
              code: 'SPK003',
              validator: 'specKit',
              severity: 'warn',
              message: `specs/${spec.name}/spec.md: ${issue}`,
              location: loc,
              suggestion: { kind: 'fix', text: 'Bring the spec up to the spec-kit spec-template.md shape (sections, FR-/SC- IDs)' },
            }));
          }
        }
      } catch {
        findings.push(mkFinding({
          code: 'SPK006',
          validator: 'specKit',
          severity: 'warn',
          message: `specs/${spec.name}/spec.md: Could not read file`,
          location: loc,
          suggestion: { kind: 'review', text: 'Check the file exists and is readable (permissions/encoding)' },
        }));
      }
    }

    // 2b: plan.md quality
    if (spec.hasPlan && spec.planPath) {
      total++;
      const loc = relative(projectDir, spec.planPath);
      try {
        const issues = validatePlanQuality(spec.planPath);
        if (issues.length === 0) {
          passed++;
        } else {
          for (const issue of issues) {
            findings.push(mkFinding({
              code: 'SPK004',
              validator: 'specKit',
              severity: 'warn',
              message: `specs/${spec.name}/plan.md: ${issue}`,
              location: loc,
              suggestion: { kind: 'fix', text: 'Add the missing section per spec-kit plan-template.md' },
            }));
          }
        }
      } catch {
        findings.push(mkFinding({
          code: 'SPK006',
          validator: 'specKit',
          severity: 'warn',
          message: `specs/${spec.name}/plan.md: Could not read file`,
          location: loc,
          suggestion: { kind: 'review', text: 'Check the file exists and is readable (permissions/encoding)' },
        }));
      }
    }

    // 2c: tasks.md quality
    if (spec.hasTasks && spec.tasksPath) {
      total++;
      const loc = relative(projectDir, spec.tasksPath);
      try {
        const issues = validateTasksQuality(spec.tasksPath);
        if (issues.length === 0) {
          passed++;
        } else {
          for (const issue of issues) {
            findings.push(mkFinding({
              code: 'SPK005',
              validator: 'specKit',
              severity: 'warn',
              message: `specs/${spec.name}/tasks.md: ${issue}`,
              location: loc,
              suggestion: { kind: 'fix', text: 'Add a phased breakdown with T-IDs per spec-kit tasks-template.md' },
            }));
          }
        }
      } catch {
        findings.push(mkFinding({
          code: 'SPK006',
          validator: 'specKit',
          severity: 'warn',
          message: `specs/${spec.name}/tasks.md: Could not read file`,
          location: loc,
          suggestion: { kind: 'review', text: 'Check the file exists and is readable (permissions/encoding)' },
        }));
      }
    }
  }

  // ── Check 2d: Phantom completions — tasks checked [x] with no implementation evidence ──
  // Opt out with `"specKit": { "phantomCheck": false }` in .docguard.json.
  // Each tasks.md with at least one checked task counts as one check.
  if (config?.specKit?.phantomCheck !== false) {
    const phantomResults = detectPhantomCompletions(projectDir, speckit.specs);
    const flagged = [];
    for (const r of phantomResults) {
      if (r.checkedCount === 0) continue;
      total++;
      if (r.phantoms.length === 0) { passed++; continue; }
      for (const ph of r.phantoms) flagged.push({ r, ph });
    }
    for (const { r, ph } of flagged.slice(0, MAX_PHANTOM_FINDINGS)) {
      const text = ph.text.length > 80 ? ph.text.slice(0, 77) + '...' : ph.text;
      const label = ph.id ? `${ph.id} marked [x]` : 'task marked [x]';
      findings.push(mkFinding({
        code: 'SPK008',
        validator: 'specKit',
        severity: 'warn',
        confidence: 'low',
        message: `specs/${r.spec.name}/tasks.md: ${label} with no implementation evidence — "${text}" (checked: ${ph.tiers.join(', ')})`,
        location: `${r.relPath}:${ph.line}`,
        suggestion: { kind: 'review', text: 'Uncheck the task or land the implementation it claims — a checked task with no artifact is memory corruption for agents' },
      }));
    }
    if (flagged.length > MAX_PHANTOM_FINDINGS) {
      findings.push(mkFinding({
        code: 'SPK009',
        validator: 'specKit',
        severity: 'warn',
        message: `...and ${flagged.length - MAX_PHANTOM_FINDINGS} more checked tasks with no implementation evidence`,
        location: null,
        suggestion: { kind: 'review', text: 'Fix or uncheck the tasks above and re-run guard to surface the rest — or set specKit.phantomCheck=false in .docguard.json to disable' },
      }));
    }
  }

  // ── Check 3: Constitution → AGENTS.md mapping ──
  if (speckit.constitution) {
    total++;
    const agentsPath = resolve(projectDir, 'AGENTS.md');
    if (existsSync(agentsPath)) {
      passed++;
    } else {
      findings.push(mkFinding({
        code: 'SPK007',
        validator: 'specKit',
        severity: 'warn',
        message: 'constitution.md exists but no AGENTS.md found. Create one for AI agent rules',
        location: 'AGENTS.md',
        suggestion: { kind: 'fix', text: 'Create an AGENTS.md that references the constitution', command: 'docguard init' },
      }));
    }
  }

  return resultFromFindings(findings, { passed, total });
}
