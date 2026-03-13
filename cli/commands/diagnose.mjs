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

import { c } from '../docguard.mjs';
import { runGuardInternal } from './guard.mjs';
import { runScoreInternal } from './score.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

// Actionable fix instructions per validator
const FIX_INSTRUCTIONS = {
  'Structure': {
    action: 'Create missing files',
    command: 'docguard init',
    description: 'Run init to create missing documentation templates.',
  },
  'Doc Sections': {
    action: 'Fill document sections',
    command: 'docguard fix --doc',
    description: 'Documents exist but have missing or placeholder sections. Use fix --doc to generate AI content prompts.',
  },
  'Docs-Sync': {
    action: 'Sync documentation references',
    command: 'docguard fix --doc architecture',
    description: 'Documentation references are out of sync with code. Review and update component maps.',
  },
  'Drift': {
    action: 'Update DRIFT-LOG.md',
    description: 'Code deviates from canonical docs without logged reasons. Add DRIFT entries or update the canonical docs.',
  },
  'Changelog': {
    action: 'Update CHANGELOG.md',
    description: 'CHANGELOG.md is missing or has no [Unreleased] section. Add recent changes.',
  },
  'Test-Spec': {
    action: 'Update TEST-SPEC.md',
    command: 'docguard fix --doc test-spec',
    description: 'Test documentation needs updating to match actual test structure.',
  },
  'Environment': {
    action: 'Update ENVIRONMENT.md',
    command: 'docguard fix --doc environment',
    description: 'Environment documentation is missing or incomplete.',
  },
  'Security': {
    action: 'Update SECURITY.md',
    command: 'docguard fix --doc security',
    description: 'Security documentation needs updating.',
  },
  'Architecture': {
    action: 'Update ARCHITECTURE.md',
    command: 'docguard fix --doc architecture',
    description: 'Architecture documentation doesn\'t match the codebase.',
  },
  'Freshness': {
    action: 'Review stale documents',
    description: 'Documents haven\'t been reviewed since recent code changes. Re-run fix --doc for each stale doc.',
  },
};

export function runDiagnose(projectDir, config, flags) {
  // ── Step 1: Run guard internally ──
  const guardData = runGuardInternal(projectDir, config);
  const scoreData = runScoreInternal(projectDir, config);

  // ── Step 2: Collect issues ──
  const issues = [];
  for (const v of guardData.validators) {
    if (v.status === 'skipped' || v.status === 'pass') continue;

    const fixInfo = FIX_INSTRUCTIONS[v.name] || { action: `Review ${v.name}`, description: 'Manual review needed.' };
    const docTarget = VALIDATOR_TO_DOC[v.name];

    for (const err of v.errors) {
      issues.push({
        severity: 'error',
        validator: v.name,
        message: err,
        action: fixInfo.action,
        command: fixInfo.command || null,
        docTarget,
      });
    }
    for (const warn of v.warnings) {
      issues.push({
        severity: 'warning',
        validator: v.name,
        message: warn,
        action: fixInfo.action,
        command: fixInfo.command || null,
        docTarget,
      });
    }
  }

  // Detect stale docs from freshness and map to specific fix --doc targets
  for (const issue of issues) {
    if (issue.validator === 'Freshness' && !issue.docTarget) {
      // Try to extract doc name from warning message
      const match = issue.message.match(/([\w-]+\.md)/i);
      if (match) {
        const docName = match[1].toLowerCase().replace('.md', '');
        const docMap = { 'architecture': 'architecture', 'data-model': 'data-model', 'security': 'security', 'test-spec': 'test-spec', 'environment': 'environment' };
        issue.docTarget = docMap[docName] || null;
        if (issue.docTarget) {
          issue.command = `docguard fix --doc ${issue.docTarget}`;
        }
      }
    }
  }

  // ── Step 3: Output ──
  if (flags.format === 'json') {
    outputJSON(guardData, scoreData, issues);
  } else if (flags.format === 'prompt') {
    outputPrompt(projectDir, guardData, scoreData, issues);
  } else {
    outputText(projectDir, guardData, scoreData, issues);
  }
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

function outputText(projectDir, guardData, scoreData, issues) {
  console.log(`${c.bold}🔍 DocGuard Diagnose — ${guardData.project}${c.reset}`);
  console.log(`${c.dim}   Profile: ${guardData.profile} | Score: ${scoreData.score}/100 (${scoreData.grade})${c.reset}`);
  console.log(`${c.dim}   Guard:   ${guardData.passed}/${guardData.total} passed | Status: ${guardData.status}${c.reset}\n`);

  if (issues.length === 0) {
    console.log(`  ${c.green}${c.bold}✅ All clear!${c.reset} No issues found.\n`);
    console.log(`  ${c.dim}Your documentation is healthy. Run \`docguard score --tax\` to see maintenance estimate.${c.reset}\n`);
    return;
  }

  // Group by severity
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  if (errors.length > 0) {
    console.log(`  ${c.red}${c.bold}Errors (${errors.length}):${c.reset}`);
    for (const e of errors) {
      console.log(`  ${c.red}✗${c.reset} [${e.validator}] ${e.message}`);
      if (e.command) console.log(`    ${c.dim}Fix: ${e.command}${c.reset}`);
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log(`  ${c.yellow}${c.bold}Warnings (${warnings.length}):${c.reset}`);
    for (const w of warnings) {
      console.log(`  ${c.yellow}⚠${c.reset} [${w.validator}] ${w.message}`);
      if (w.command) console.log(`    ${c.dim}Fix: ${w.command}${c.reset}`);
    }
    console.log('');
  }

  // ── Remediation Plan ──
  const commands = [...new Set(issues.filter(i => i.command).map(i => i.command))];
  if (commands.length > 0) {
    console.log(`  ${c.bold}📋 Remediation Plan:${c.reset}`);
    for (let i = 0; i < commands.length; i++) {
      console.log(`  ${c.cyan}${i + 1}. ${commands[i]}${c.reset}`);
    }
    console.log(`  ${c.cyan}${commands.length + 1}. docguard guard${c.reset} ${c.dim}← verify fixes${c.reset}`);
    console.log('');
  }

  // ── AI Prompt (always shown in text mode for easy copy) ──
  console.log(`  ${c.bold}🤖 AI-Ready Prompt:${c.reset}`);
  console.log(`  ${c.dim}Copy everything below and paste to your AI agent:${c.reset}\n`);
  outputPrompt(undefined, guardData, scoreData, issues);
}

function outputPrompt(projectDir, guardData, scoreData, issues) {
  if (issues.length === 0) {
    console.log('No issues to fix. Documentation is healthy.');
    return;
  }

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
    for (const msg of group.issues) {
      lines.push(`   - ${msg}`);
    }
    step++;
  }

  lines.push('');
  lines.push('VALIDATION:');
  lines.push('After making all fixes, run: docguard guard');
  lines.push('Expected result: All checks pass (0 errors, 0 warnings)');
  lines.push(`Target score: ≥${scoreData.score + 5}/100`);

  console.log(lines.join('\n'));
}
