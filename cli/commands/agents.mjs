/**
 * Agents Command — Generate agent-specific config files from AGENTS.md
 * Creates .cursor/rules/, .clinerules, .github/copilot-instructions.md, etc.
 *
 * v0.29 sync mode: AGENTS.md is the CANONICAL source; the generated family
 * (CLAUDE.md, .clinerules, copilot-instructions, …) carries a source-hash
 * marker. `--sync` regenerates every marked (or missing) variant; `--check`
 * is the CI staleness gate (exit 2 when a marked variant's hash no longer
 * matches AGENTS.md). Files that exist WITHOUT our marker are user content —
 * never overwritten without --force. This kills the hand-duplication drift
 * between agent files, which is exactly the failure class DocGuard exists for.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { c } from '../shared.mjs';

const AGENT_TARGETS = {
  cursor: {
    path: '.cursor/rules/cdd.mdc',
    name: 'Cursor',
    generate: generateCursorRules,
  },
  copilot: {
    path: '.github/copilot-instructions.md',
    name: 'GitHub Copilot',
    generate: generateCopilotInstructions,
  },
  cline: {
    path: '.clinerules',
    name: 'Cline',
    generate: generateClineRules,
  },
  windsurf: {
    path: '.windsurfrules',
    name: 'Windsurf',
    generate: generateWindsurfRules,
  },
  claude: {
    path: 'CLAUDE.md',
    name: 'Claude Code',
    generate: generateClaudeMd,
  },
  gemini: {
    path: '.gemini/settings.json',
    name: 'Gemini CLI',
    generate: generateGeminiSettings,
  },
};

// ── Sync markers (v0.29) ─────────────────────────────────────────────────────

const sourceHash = (content) => createHash('sha256').update(content).digest('hex').slice(0, 16);

/**
 * Stamp generated content with the sync marker. Text formats get HTML-comment
 * lines; JSON gets a `_docguardSync` field (comments would break parsing).
 * For frontmatter files (.mdc) the marker goes AFTER the closing `---` so the
 * frontmatter stays the first bytes, as Cursor requires.
 */
function stampMarker(content, hash, targetPath) {
  const marker = `<!-- docguard:agents-sync source=AGENTS.md hash=${hash} -->\n<!-- Do not edit — regenerate with: docguard agents --sync -->\n`;
  if (targetPath.endsWith('.json')) {
    try {
      const obj = JSON.parse(content);
      obj._docguardSync = { source: 'AGENTS.md', hash, note: 'Do not edit — regenerate with: docguard agents --sync' };
      return JSON.stringify(obj, null, 2);
    } catch { return content; }
  }
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---', 4);
    if (end !== -1) {
      const cut = end + 4;
      return content.slice(0, cut) + '\n' + marker + content.slice(cut);
    }
  }
  return marker + '\n' + content;
}

/** Extract the recorded source hash from a generated file, or null if unmarked. */
function extractMarkerHash(content, targetPath) {
  if (targetPath.endsWith('.json')) {
    try { return JSON.parse(content)._docguardSync?.hash ?? null; } catch { return null; }
  }
  const m = content.match(/docguard:agents-sync source=AGENTS\.md hash=([0-9a-f]{16})/);
  return m ? m[1] : null;
}

export function runAgents(projectDir, config, flags) {
  console.log(`${c.bold}🤖 DocGuard Agents — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}\n`);

  // Read AGENTS.md content
  const agentsPath = resolve(projectDir, 'AGENTS.md');
  if (!existsSync(agentsPath)) {
    console.log(`  ${c.red}❌ AGENTS.md not found. Run ${c.cyan}docguard init${c.red} first.${c.reset}\n`);
    process.exit(1);
  }

  const agentsContent = readFileSync(agentsPath, 'utf-8');

  // ── v0.29: --check — CI staleness gate for the synced family ──
  if (flags.check) {
    return runAgentsCheck(projectDir, agentsContent, flags);
  }
  // ── v0.29: --sync — regenerate marked/missing variants from AGENTS.md ──
  if (flags.sync) {
    return runAgentsSync(projectDir, config, agentsContent, flags);
  }

  // Parse which agents to generate for
  let targets = Object.keys(AGENT_TARGETS);
  const specificAgent = flags.agent;
  if (specificAgent) {
    if (!AGENT_TARGETS[specificAgent]) {
      console.log(`  ${c.red}Unknown agent: ${specificAgent}${c.reset}`);
      console.log(`  Available: ${targets.join(', ')}\n`);
      process.exit(1);
    }
    targets = [specificAgent];
  }

  let created = 0;
  let skipped = 0;

  for (const key of targets) {
    const target = AGENT_TARGETS[key];
    const targetPath = resolve(projectDir, target.path);

    if (existsSync(targetPath) && !flags.force) {
      console.log(`  ${c.dim}⏭️  ${target.name}: ${target.path} (exists, use --force to overwrite)${c.reset}`);
      skipped++;
      continue;
    }

    const content = target.generate(agentsContent, config);

    // Create directories
    const dir = dirname(targetPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(targetPath, content, 'utf-8');
    console.log(`  ${c.green}✅ ${target.name}${c.reset}: ${target.path}`);
    created++;
  }

  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);
  console.log(`  Created: ${created}  Skipped: ${skipped}\n`);
}

// ── Sync + Check modes (v0.29) ───────────────────────────────────────────────

/**
 * `docguard agents --sync` — regenerate the agent-file family from AGENTS.md.
 *
 * Semantics per target:
 *   - missing            → generate (stamped with the current source hash)
 *   - exists, our marker → regenerate (marked files are OURS to update)
 *   - exists, unmarked   → SKIP with a warning (hand-written user content;
 *                          --force overrides, which is the only destructive
 *                          path and is explicit)
 */
function runAgentsSync(projectDir, config, agentsContent, flags) {
  const hash = sourceHash(agentsContent);
  let synced = 0, fresh = 0, skipped = 0;

  let targets = Object.keys(AGENT_TARGETS);
  if (flags.agent) {
    if (!AGENT_TARGETS[flags.agent]) {
      console.log(`  ${c.red}Unknown agent: ${flags.agent}${c.reset}`);
      console.log(`  Available: ${targets.join(', ')}\n`);
      process.exit(1);
    }
    targets = [flags.agent];
  }

  for (const key of targets) {
    const target = AGENT_TARGETS[key];
    const targetPath = resolve(projectDir, target.path);
    const exists = existsSync(targetPath);

    if (exists) {
      const current = readFileSync(targetPath, 'utf-8');
      const recorded = extractMarkerHash(current, target.path);
      if (recorded === null && !flags.force) {
        console.log(`  ${c.yellow}⚠️  ${target.name}: ${target.path} exists without a sync marker (hand-written?) — skipped. Use --force to adopt it.${c.reset}`);
        skipped++;
        continue;
      }
      if (recorded === hash) {
        console.log(`  ${c.dim}✓  ${target.name}: ${target.path} already in sync${c.reset}`);
        fresh++;
        continue;
      }
    }

    const content = stampMarker(target.generate(agentsContent, config), hash, target.path);
    const dir = dirname(targetPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(targetPath, content, 'utf-8');
    console.log(`  ${c.green}✅ ${target.name}${c.reset}: ${target.path} ${c.dim}(${exists ? 'resynced' : 'created'}, hash ${hash})${c.reset}`);
    synced++;
  }

  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);
  console.log(`  Synced: ${synced}  In sync: ${fresh}  Skipped (unmarked): ${skipped}`);
  console.log(`  ${c.dim}CI gate: ${c.cyan}docguard agents --check${c.dim} exits 2 when a variant goes stale.${c.reset}\n`);
}

/**
 * `docguard agents --check` — CI staleness gate. Only files that CARRY our
 * marker are judged (an unmarked or absent variant is the user's choice, not
 * drift). Stale marked file → warning + exit code 2 (matches guard's
 * warnings-exit contract). Uses process.exitCode, never process.exit, so
 * stdout always drains (bug-105 discipline).
 */
function runAgentsCheck(projectDir, agentsContent, flags) {
  const hash = sourceHash(agentsContent);
  const stale = [];
  let inSync = 0, unmanaged = 0;

  for (const [, target] of Object.entries(AGENT_TARGETS)) {
    const targetPath = resolve(projectDir, target.path);
    if (!existsSync(targetPath)) { unmanaged++; continue; }
    let recorded = null;
    try { recorded = extractMarkerHash(readFileSync(targetPath, 'utf-8'), target.path); } catch { /* unreadable → unmanaged */ }
    if (recorded === null) { unmanaged++; continue; }
    if (recorded === hash) inSync++;
    else stale.push(target.path);
  }

  if (stale.length > 0) {
    for (const p of stale) {
      console.log(`  ${c.yellow}⚠ ${p} is stale — AGENTS.md changed since it was generated.${c.reset}`);
    }
    console.log(`\n  ${c.yellow}${stale.length} agent file(s) out of sync.${c.reset} Fix: ${c.cyan}docguard agents --sync${c.reset}\n`);
    process.exitCode = 2;
    return;
  }

  console.log(`  ${c.green}✅ Agent-file family in sync${c.reset} ${c.dim}(${inSync} synced, ${unmanaged} unmanaged/absent — unmarked files are yours, not checked)${c.reset}\n`);
}

// ── Generator Functions ────────────────────────────────────────────────────

function getCddBlock(config) {
  return `## Canonical-Driven Development (CDD)

This project follows the CDD methodology. Documentation is the source of truth.

### Required Reading (Before Any Code Change)
- \`docs-canonical/ARCHITECTURE.md\` — System design and boundaries
- \`docs-canonical/DATA-MODEL.md\` — Database schemas
- \`docs-canonical/SECURITY.md\` — Auth and secrets rules
- \`docs-canonical/TEST-SPEC.md\` — Test requirements
- \`docs-canonical/ENVIRONMENT.md\` — Environment setup

### Rules
1. Read canonical docs BEFORE writing code
2. If code deviates from docs, add \`// DRIFT: reason\` comment
3. Log all drift in \`DRIFT-LOG.md\`
4. Update \`CHANGELOG.md\` for every change
5. Never modify canonical docs without team review`;
}

function generateCursorRules(agentsContent, config) {
  return `---
description: CDD rules for ${config.projectName}
globs: "**/*"
---

${getCddBlock(config)}

### Workflow
1. Check \`docs-canonical/\` before suggesting changes
2. Match existing code patterns
3. Add \`// DRIFT: reason\` if deviating from canonical docs
4. Update CHANGELOG.md for every meaningful change

### Original AGENTS.md Content
${agentsContent}
`;
}

function generateCopilotInstructions(agentsContent, config) {
  return `# GitHub Copilot Instructions — ${config.projectName}

${getCddBlock(config)}

### For Copilot
- Prioritize suggestions that align with canonical documentation
- When generating new files, follow the patterns in \`docs-canonical/ARCHITECTURE.md\`
- Always suggest tests that match \`docs-canonical/TEST-SPEC.md\` requirements

---

${agentsContent}
`;
}

function generateClineRules(agentsContent, config) {
  return `# Cline Rules — ${config.projectName}

${getCddBlock(config)}

### For Cline
- Always research docs-canonical/ before suggesting changes
- Show what docs you checked before proposing code
- Flag any drift from canonical docs

---

${agentsContent}
`;
}

function generateWindsurfRules(agentsContent, config) {
  return `# Windsurf Rules — ${config.projectName}

${getCddBlock(config)}

---

${agentsContent}
`;
}

function generateClaudeMd(agentsContent, config) {
  return `# CLAUDE.md — ${config.projectName}

${getCddBlock(config)}

### Pre-Implementation Checklist
Before suggesting any code changes:
\`\`\`
1. Docs reviewed: [which canonical docs you checked]
2. Existing patterns: [similar code found]
3. Proposed approach: [your plan]
4. Files to change: [list]
5. Risk level: LOW | MEDIUM | HIGH
\`\`\`

---

${agentsContent}
`;
}

function generateGeminiSettings(agentsContent, config) {
  return JSON.stringify({
    projectName: config.projectName,
    methodology: 'Canonical-Driven Development (CDD)',
    canonicalDocs: [
      'docs-canonical/ARCHITECTURE.md',
      'docs-canonical/DATA-MODEL.md',
      'docs-canonical/SECURITY.md',
      'docs-canonical/TEST-SPEC.md',
      'docs-canonical/ENVIRONMENT.md',
    ],
    rules: [
      'Read canonical docs before suggesting code changes',
      'Add // DRIFT: comments for deviations',
      'Update CHANGELOG.md for every change',
      'Log drift in DRIFT-LOG.md',
    ],
  }, null, 2);
}
