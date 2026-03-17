/**
 * Diagnose Command — The AI Orchestrator
 *
 * Chains guard → fix in a single command.
 * Runs guard internally, maps every failure to an AI-actionable
 * fix prompt, and outputs them as one combined remediation plan.
 *
 * This is the command AI agents run to self-heal a project's docs.
 *
 * Output modes:
 *   --format text    Summary with fix instructions (default)
 *   --format json    Structured {issues, fixPrompts} for automation
 *   --format prompt  Full AI-ready prompt (all issues combined)
 */

import { c } from '../shared.mjs';
import { runGuardInternal } from './guard.mjs';
import { runScoreInternal } from './score.mjs';
import { detectAgentMode, isSpecKitInitialized } from '../ensure-skills.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

// Map validator failures to the right fix --doc target
const VALIDATOR_TO_DOC = {
  'Structure':     null,       // structural — needs init, not doc fix
  'Doc Sections':  null,       // section-level — maps to specific doc
  'Docs-Sync':     null,       // cross-reference — needs manual review
  'Drift':         null,       // drift log maintenance
  'Changelog':     null,       // changelog maintenance
  'Test-Spec':     'test-spec',
  'Environment':   'environment',
  'Security':      'security',
  'Architecture':  'architecture',
  'Freshness':     null,       // freshness — maps to stale doc
};

// Actionable fix instructions per validator (LLM-first: includes both skill and CLI commands)
const FIX_INSTRUCTIONS = {
  'Structure': {
    action: 'Create missing files',
    command: 'docguard init',
    llmCommand: '/docguard.init',
    description: 'Run init to create missing documentation templates.',
    autoFixable: true,
  },
  'Doc Sections': {
    action: 'Fill document sections',
    command: 'docguard fix --doc',
    llmCommand: '/docguard.fix --doc',
    description: 'Documents exist but have missing or placeholder sections. Use the docguard-fix skill to generate content.',
    autoFixable: false,
  },
  'Docs-Sync': {
    action: 'Sync documentation references',
    command: 'docguard fix --doc architecture',
    llmCommand: '/docguard.fix --doc architecture',
    description: 'Documentation references are out of sync with code. Review and update component maps.',
    autoFixable: false,
  },
  'Drift': {
    action: 'Update DRIFT-LOG.md',
    description: 'Code deviates from canonical docs without logged reasons. Add DRIFT entries or update the canonical docs.',
    autoFixable: false,
  },
  'Changelog': {
    action: 'Update CHANGELOG.md',
    description: 'CHANGELOG.md is missing or has no [Unreleased] section. Add recent changes.',
    autoFixable: false,
  },
  'Test-Spec': {
    action: 'Update TEST-SPEC.md',
    command: 'docguard fix --doc test-spec',
    llmCommand: '/docguard.fix --doc test-spec',
    description: 'Test documentation needs updating to match actual test structure.',
    autoFixable: false,
  },
  'Environment': {
    action: 'Update ENVIRONMENT.md',
    command: 'docguard fix --doc environment',
    llmCommand: '/docguard.fix --doc environment',
    description: 'Environment documentation is missing or incomplete.',
    autoFixable: false,
  },
  'Security': {
    action: 'Update SECURITY.md',
    command: 'docguard fix --doc security',
    llmCommand: '/docguard.fix --doc security',
    description: 'Security documentation needs updating.',
    autoFixable: false,
  },
  'Architecture': {
    action: 'Update ARCHITECTURE.md',
    command: 'docguard fix --doc architecture',
    llmCommand: '/docguard.fix --doc architecture',
    description: 'Architecture documentation doesn\'t match the codebase.',
    autoFixable: false,
  },
  'Freshness': {
    action: 'Review stale documents',
    command: 'docguard fix --doc',
    llmCommand: '/docguard.fix --doc',
    description: 'Documents haven\'t been reviewed since recent code changes. Re-run fix --doc for each stale doc.',
    autoFixable: false,
  },
};

export function runDiagnose(projectDir, config, flags) {
  // ── Step 0: Detect agent mode (LLM-first) ──
  const agentMode = detectAgentMode(projectDir);

  // ── Step 1: Run guard internally ──
  let guardData = runGuardInternal(projectDir, config);
  const scoreData = runScoreInternal(projectDir, config);

  // ── Step 2: Collect issues ──
  let issues = collectIssues(guardData);

  // ── Step 3: Auto-fix (only with --auto flag) or suggest fixes ──
  const shouldAutoFix = flags.auto && flags.format !== 'json';
  if (issues.length > 0) {
    const autoFixable = issues.filter(i => i.autoFixable);
    const hasStructural = issues.some(i => i.validator === 'Structure');

    if (shouldAutoFix && (hasStructural || autoFixable.length > 0)) {
      // Run init to create missing files
      try {
        const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docguard.mjs');
        execSync(`node "${cliPath}" init --dir "${projectDir}"`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch { /* init may partially succeed */ }

      // Run generate to fill in MISSING content only (never --force, which would overwrite existing docs)
      try {
        const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docguard.mjs');
        execSync(`node "${cliPath}" generate --dir "${projectDir}"`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch { /* generate may partially succeed */ }

      // Re-run guard to see what's still broken
      guardData = runGuardInternal(projectDir, config);
      issues = collectIssues(guardData);

      if (!flags.format || flags.format === 'text') {
        const fixedCount = autoFixable.length - issues.filter(i => i.autoFixable).length;
        if (fixedCount > 0) {
          console.log(`  ${c.green}⚡ Auto-fixed ${fixedCount} issue(s)${c.reset} (created/regenerated docs)\n`);
        }
      }
    } else if (!shouldAutoFix && (hasStructural || autoFixable.length > 0) && (!flags.format || flags.format === 'text')) {
      // Suggest-only mode: tell user what they can do (LLM-first)
      console.log(`  ${c.yellow}💡 ${autoFixable.length + (hasStructural ? 1 : 0)} issue(s) can be auto-fixed.${c.reset} Run with ${c.cyan}--auto${c.reset} to create/regenerate docs, or manually:`);
      if (agentMode === 'llm') {
        if (hasStructural) console.log(`     ${c.dim}/docguard.init${c.reset}`);
        if (autoFixable.length > 0) console.log(`     ${c.dim}/docguard.fix${c.reset}`);
      } else {
        if (hasStructural) console.log(`     ${c.dim}docguard init --dir .${c.reset}`);
        if (autoFixable.length > 0) console.log(`     ${c.dim}docguard generate --dir . --force${c.reset}`);
      }
      console.log('');
    }
  }

  // Detect stale docs from freshness and map to specific fix --doc targets
  for (const issue of issues) {
    if (issue.validator === 'Freshness' && !issue.docTarget) {
      const match = issue.message.match(/([\w-]+\.md)/i);
      if (match) {
        const docName = match[1].toLowerCase().replace('.md', '');
        const docMap = { 'architecture': 'architecture', 'data-model': 'data-model', 'security': 'security', 'test-spec': 'test-spec', 'environment': 'environment' };
        issue.docTarget = docMap[docName] || null;
        if (issue.docTarget) {
          issue.command = agentMode === 'llm'
            ? `/docguard.fix --doc ${issue.docTarget}`
            : `docguard fix --doc ${issue.docTarget}`;
        }
      }
    }
  }

  // ── Step 4: Output ──
  if (flags.format === 'json') {
    outputJSON(guardData, scoreData, issues);
  } else if (flags.format === 'prompt') {
    outputPrompt(projectDir, guardData, scoreData, issues, flags, agentMode);
  } else {
    outputText(projectDir, guardData, scoreData, issues, flags, agentMode);
  }
}

/**
 * Collect issues from guard results with fix metadata.
 */
function collectIssues(guardData) {
  const issues = [];
  for (const v of guardData.validators) {
    if (v.status === 'skipped' || v.status === 'pass') continue;

    const fixInfo = FIX_INSTRUCTIONS[v.name] || { action: `Review ${v.name}`, description: 'Manual review needed.', autoFixable: false };
    const docTarget = VALIDATOR_TO_DOC[v.name];

    for (const err of v.errors) {
      issues.push({
        severity: 'error',
        validator: v.name,
        message: err,
        action: fixInfo.action,
        command: fixInfo.command || null,
        llmCommand: fixInfo.llmCommand || null,
        docTarget,
        autoFixable: fixInfo.autoFixable || false,
      });
    }
    for (const warn of v.warnings) {
      issues.push({
        severity: 'warning',
        validator: v.name,
        message: warn,
        action: fixInfo.action,
        command: fixInfo.command || null,
        llmCommand: fixInfo.llmCommand || null,
        docTarget,
        autoFixable: fixInfo.autoFixable || false,
      });
    }
  }
  return issues;
}

function outputJSON(guardData, scoreData, issues) {
  const result = {
    project: guardData.project,
    profile: guardData.profile,
    status: guardData.status,
    score: scoreData.score,
    grade: scoreData.grade,
    issueCount: issues.length,
    issues: issues.map(i => ({
      severity: i.severity,
      validator: i.validator,
      message: i.message,
      action: i.action,
      command: i.command,
      docTarget: i.docTarget,
    })),
    // Unique fix commands for automation
    fixCommands: [...new Set(issues.filter(i => i.command).map(i => i.command))],
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
}

function outputText(projectDir, guardData, scoreData, issues, flags, agentMode = 'llm') {
  console.log(`${c.bold}🔍 DocGuard Diagnose — ${guardData.project}${c.reset}`);
  console.log(`${c.dim}   Profile: ${guardData.profile} | Score: ${scoreData.score}/100 (${scoreData.grade}) | Mode: ${agentMode.toUpperCase()}${c.reset}`);
  console.log(`${c.dim}   Guard:   ${guardData.passed}/${guardData.total} passed | Status: ${guardData.status}${c.reset}\n`);

  if (issues.length === 0) {
    console.log(`  ${c.green}${c.bold}✅ All clear!${c.reset} No issues found.\n`);
    if (agentMode === 'llm') {
      console.log(`  ${c.dim}Your documentation is healthy. Use ${c.cyan}/docguard.guard${c.dim} to re-validate after changes.${c.reset}\n`);
    } else {
      console.log(`  ${c.dim}Your documentation is healthy. Run \`docguard score --tax\` to see maintenance estimate.${c.reset}\n`);
    }
    return;
  }

  // Group by severity
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (errors.length > 0) {
    console.log(`  ${c.red}${c.bold}Errors (${errors.length}):${c.reset}`);
    for (const e of errors) {
      console.log(`  ${c.red}✗${c.reset} [${e.validator}] ${e.message}`);
      const cmd = agentMode === 'llm' && e.llmCommand ? e.llmCommand : e.command;
      if (cmd) console.log(`    ${c.dim}Fix: ${cmd}${c.reset}`);
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log(`  ${c.yellow}${c.bold}Warnings (${warnings.length}):${c.reset}`);
    for (const w of warnings) {
      console.log(`  ${c.yellow}⚠${c.reset} [${w.validator}] ${w.message}`);
      const cmd = agentMode === 'llm' && w.llmCommand ? w.llmCommand : w.command;
      if (cmd) console.log(`    ${c.dim}Fix: ${cmd}${c.reset}`);
    }
    console.log('');
  }

  // ── Remediation Plan (LLM-first) ──
  const commands = [...new Set(issues.filter(i => i.command).map(i => i.command))];
  if (commands.length > 0) {
    console.log(`  ${c.bold}📋 Remediation Plan:${c.reset}`);
    for (let i = 0; i < commands.length; i++) {
      console.log(`  ${c.cyan}${i + 1}. ${commands[i]}${c.reset}`);
    }
    const verifyCmd = agentMode === 'llm' ? '/docguard.guard' : 'docguard guard';
    console.log(`  ${c.cyan}${commands.length + 1}. ${verifyCmd}${c.reset} ${c.dim}← verify fixes${c.reset}`);
    console.log('');
  }

  // ── AI Prompt (always shown in text mode for easy copy) ──
  if (flags && flags.debate) {
    // Multi-perspective debate prompts (AITPG/TRACE-inspired)
    console.log(`  ${c.bold}🤖 Multi-Perspective AI Debate Prompt:${c.reset}`);
    console.log(`  ${c.dim}Copy everything below and paste to your AI agent:${c.reset}\n`);
    outputDebatePrompt(projectDir, guardData, scoreData, issues, agentMode);
  } else {
    console.log(`  ${c.bold}🤖 AI-Ready Prompt:${c.reset}`);
    console.log(`  ${c.dim}Copy everything below and paste to your AI agent:${c.reset}\n`);
    outputPrompt(undefined, guardData, scoreData, issues, flags, agentMode);
  }
}

function outputPrompt(projectDir, guardData, scoreData, issues, flags, agentMode = 'llm') {
  if (issues.length === 0) {
    console.log('No issues to fix. Documentation is healthy.');
    return;
  }

  // Detect agent capability for prompt complexity (inspired by CJE equalizer effect, TRACE 2026)
  const agentTier = detectAgentTier(projectDir || '.');

  const lines = [];
  lines.push(`TASK: Fix ${issues.length} documentation issue(s) in project "${guardData.project}"`);
  lines.push(`Profile: ${guardData.profile} | Score: ${scoreData.score}/100 | Guard: ${guardData.status}`);
  lines.push('');
  lines.push('ISSUES FOUND:');

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    lines.push(`${i + 1}. [${issue.severity.toUpperCase()}] [${issue.validator}] ${issue.message}`);
  }

  lines.push('');
  lines.push('REMEDIATION STEPS:');

  // Group by unique fix commands
  const fixGroups = {};
  for (const issue of issues) {
    const key = issue.command || issue.action;
    if (!fixGroups[key]) {
      fixGroups[key] = { action: issue.action, command: issue.command, docTarget: issue.docTarget, issues: [] };
    }
    fixGroups[key].issues.push(issue.message);
  }

  let step = 1;
  for (const [key, group] of Object.entries(fixGroups)) {
    lines.push(`${step}. ${group.action}`);
    if (group.command) {
      lines.push(`   Run: ${group.command}`);
    }
    if (group.docTarget) {
      lines.push(`   Then research the codebase and write real content for this document.`);
    }
    // Agent-aware: add extra detail for smaller models
    if (agentTier === 'basic') {
      lines.push(`   NOTE: Review the codebase file by file. Look for patterns matching this issue.`);
      lines.push(`   Check docs-canonical/ for the expected format. Compare against existing docs.`);
    }
    for (const msg of group.issues) {
      lines.push(`   - ${msg}`);
    }
    step++;
  }

  lines.push('');
  lines.push('VALIDATION:');
  if (agentMode === 'llm') {
    lines.push('After making all fixes, use the /docguard.guard skill to verify');
  } else {
    lines.push('After making all fixes, run: docguard guard');
  }
  lines.push('Expected result: All checks pass (0 errors, 0 warnings)');
  lines.push(`Target score: ≥${Math.min(scoreData.score + 5, 100)}/100`);

  // Agent-aware: add explicit checklist for basic-tier agents
  if (agentTier === 'basic') {
    lines.push('');
    lines.push('VERIFICATION CHECKLIST (complete each step):');
    lines.push('□ Read each file in docs-canonical/ before editing');
    if (agentMode === 'llm') {
      lines.push('□ Run /docguard.guard after each file change');
      lines.push('□ Confirm 0 errors before moving to next issue');
      lines.push('□ Run /docguard.score to confirm improvement');
    } else {
      lines.push('□ Run `docguard guard` after each file change');
      lines.push('□ Confirm 0 errors before moving to next issue');
      lines.push('□ Run `docguard score` to confirm improvement');
    }
  }

  console.log(lines.join('\n'));
}

/**
 * Generate multi-perspective debate prompts.
 * Inspired by AITPG multi-agent role specialization (Positive/Negative/Edge + Critic)
 * and TRACE adversarial debate (Advocate/Challenger/Mediator/Explainer).
 * Lopez et al., IEEE TSE/TMLCN 2026.
 */
function outputDebatePrompt(projectDir, guardData, scoreData, issues, agentMode = 'llm') {
  const lines = [];

  lines.push('═══════════════════════════════════════════════════════');
  lines.push('MULTI-PERSPECTIVE DOCUMENTATION ANALYSIS');
  lines.push(`Project: "${guardData.project}" | Score: ${scoreData.score}/100 | Issues: ${issues.length}`);
  lines.push('Methodology: Multi-agent debate (Lopez et al., AITPG/TRACE, IEEE 2026)');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');

  // Issue context
  lines.push('CONTEXT — Current Issues:');
  for (let i = 0; i < issues.length; i++) {
    lines.push(`  ${i + 1}. [${issues[i].severity.toUpperCase()}] [${issues[i].validator}] ${issues[i].message}`);
  }
  lines.push('');

  // ── Agent 1: Advocate ──
  lines.push('───────────────────────────────────────────────────────');
  lines.push('PERSPECTIVE 1: ADVOCATE (What is working well)');
  lines.push('───────────────────────────────────────────────────────');
  lines.push('Role: You are the Advocate agent. Your job is to identify what the project');
  lines.push('documentation is doing RIGHT and which patterns should be PRESERVED.');
  lines.push('');
  lines.push('Instructions:');
  lines.push('1. Read all files in docs-canonical/');
  lines.push('2. Identify which documents are well-structured and complete');
  lines.push('3. Note which naming conventions, section formats, and patterns are consistent');
  lines.push('4. List 3-5 strengths that must be preserved during remediation');
  lines.push('');

  // ── Agent 2: Challenger ──
  lines.push('───────────────────────────────────────────────────────');
  lines.push('PERSPECTIVE 2: CHALLENGER (What is broken or risky)');
  lines.push('───────────────────────────────────────────────────────');
  lines.push('Role: You are the Challenger agent. Your job is to STRESS-TEST the documentation');
  lines.push('and identify gaps, inconsistencies, and risks that the issues list might miss.');
  lines.push('');
  lines.push('Instructions:');
  lines.push('1. For each issue listed above, explain WHY it matters and what the root cause is');
  lines.push('2. Identify any ADDITIONAL issues not caught by docguard guard');
  lines.push('3. Check: Are there undocumented API routes? Missing env vars? Stale references?');
  lines.push('4. Rank all issues by business impact (P0 = blocks deployment, P1 = degrades quality, P2 = cosmetic)');
  lines.push('');

  // ── Agent 3: Synthesizer ──
  lines.push('───────────────────────────────────────────────────────');
  lines.push('PERSPECTIVE 3: SYNTHESIZER (Prioritized remediation plan)');
  lines.push('───────────────────────────────────────────────────────');
  lines.push('Role: You are the Synthesizer agent. Given the Advocate\'s strengths and the');
  lines.push('Challenger\'s gaps, produce a PRIORITIZED and ACTIONABLE remediation plan.');
  lines.push('');
  lines.push('Instructions:');
  lines.push('1. Preserve the patterns the Advocate identified as strengths');
  lines.push('2. Address the Challenger\'s issues in priority order (P0 → P1 → P2)');
  lines.push('3. For each fix, specify:');
  lines.push('   a. Which file to edit');
  lines.push('   b. What section to add or modify');
  lines.push('   c. What content to write (be specific, not vague)');
  const verifyCmd = agentMode === 'llm' ? '/docguard.guard' : 'docguard guard';
  lines.push(`4. After all fixes, verify with: ${verifyCmd}`);
  lines.push(`5. Target score: ≥${Math.min(scoreData.score + 10, 100)}/100`);
  lines.push('');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('Execute all three perspectives in sequence, then implement the Synthesizer\'s plan.');
  lines.push('═══════════════════════════════════════════════════════');

  console.log(lines.join('\n'));
}

/**
 * Detect the AI agent tier from AGENTS.md or .docguard.json.
 * Returns 'advanced' (concise prompts) or 'basic' (verbose step-by-step).
 * Inspired by CJE equalizer effect (Lopez et al., TRACE, IEEE TMLCN 2026).
 */
function detectAgentTier(projectDir) {
  // Check .docguard.json for explicit agent config
  const configPath = resolve(projectDir, '.docguard.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (config.agentTier) return config.agentTier;
    } catch { /* ignore */ }
  }

  // Check AGENTS.md for known agent names
  const agentFiles = ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md'];
  for (const file of agentFiles) {
    const agentPath = resolve(projectDir, file);
    if (existsSync(agentPath)) {
      const content = readFileSync(agentPath, 'utf-8').toLowerCase();
      // Advanced agents: Claude, GPT-4, Gemini Pro
      const advancedMarkers = ['claude', 'gpt-4', 'gemini pro', 'gemini 2', 'opus', 'sonnet'];
      if (advancedMarkers.some(m => content.includes(m))) {
        return 'advanced';
      }
    }
  }

  // Default to advanced (most users run modern models)
  return 'advanced';
}
