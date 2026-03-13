/**
 * Agents Command — Generate agent-specific config files from AGENTS.md
 * Creates .cursor/rules/, .clinerules, .github/copilot-instructions.md, etc.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { c } from '../docguard.mjs';

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
