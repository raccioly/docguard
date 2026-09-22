import { assertDefaultDocWrites } from '../shared-doc-roles.mjs';
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
import { execSync, execFileSync } from 'node:child_process';
import { applyAllMechanicalFixes } from './fix.mjs';
import { buildReadinessAssessment } from '../assessment.mjs';

// Map validator failures to the right fix --doc target
const VALIDATOR_TO_DOC = {
  'Structure':       null,       // structural — needs init, not doc fix
  'Doc Sections':    null,       // section-level — maps to specific doc
  'Docs-Sync':       null,       // cross-reference — needs manual review
  'Drift-Comments':  null,       // drift log maintenance
  'Changelog':       null,       // changelog maintenance
  'API-Surface':     'api-reference',
  'Test-Spec':       'test-spec',
  'Environment':     'environment',
  'Security':        'security',
  'Architecture':    'architecture',
  'Freshness':       null,       // freshness — maps to stale doc
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
  'Drift-Comments': {
    action: 'Update DRIFT-LOG.md',
    description: 'A // DRIFT: code comment has no matching DRIFT-LOG.md entry. Add the entry or remove the comment.',
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
    action: 'Review document evidence against relevant changes',
    description: 'Review signals do not establish incorrect documentation. Check whether the documentation or implementation needs a change; preserve approved intent.',
    autoFixable: false,
  },
  // ── Routed (Phase F): these used to fall through to a generic "Manual review needed" ──
  'Metrics-Consistency': {
    action: 'Update stale number(s) in docs',
    command: 'docguard fix --write',
    llmCommand: 'docguard fix --write',
    description: 'A doc claims a different count than the actual. Mechanical replace — no AI needed.',
    autoFixable: true,
  },
  'Metadata-Sync': {
    action: 'Update stale version reference(s)',
    command: 'docguard fix --write',
    llmCommand: 'docguard fix --write',
    description: 'Docs reference an older version than the manifest. Mechanical replace — no AI needed.',
    autoFixable: true,
  },
  'Docs-Sync': {
    action: 'Reference the route/service in a canonical doc',
    command: 'docguard fix --doc architecture',
    llmCommand: '/docguard.fix --doc architecture',
    description: 'A code file under routes/services is not referenced by any canonical doc. Add it (or its module) to ARCHITECTURE.md.',
    autoFixable: false,
  },
  'Docs-Diff': {
    action: 'Reconcile the documented vs. real surface',
    command: 'docguard diff',
    llmCommand: '/docguard.fix',
    description: 'Tech stack or test files documented but not found in code (or vice versa). Inspect with `docguard diff`.',
    autoFixable: false,
  },
  'Docs-Coverage': {
    action: 'Reference the missing config/dotfile/source dir in docs',
    command: 'docguard fix --doc architecture',
    llmCommand: '/docguard.fix --doc architecture',
    description: 'A project config/source dir is undocumented. Add a reference to the appropriate canonical doc.',
    autoFixable: false,
  },
  'Doc-Quality': {
    action: 'Improve readability / structure of the flagged doc',
    command: 'docguard fix --doc',
    llmCommand: '/docguard.fix --doc',
    description: 'Passive voice, low atomicity, or weak structure detected. Re-run fix --doc for the affected file.',
    autoFixable: false,
  },
  'TODO-Tracking': {
    action: 'Track or remove the TODO/FIXME',
    description: 'An untracked TODO/FIXME in source. Add it to ROADMAP.md / CURRENT-STATE.md, open an issue, or remove it.',
    autoFixable: false,
  },
  'Traceability': {
    action: 'Link the requirement ID to its test(s)',
    description: 'A documented requirement ID has no matching reference in any test file. Add `@req FR-XXX` to the test that verifies it.',
    autoFixable: false,
  },
  'Schema-Sync': {
    action: 'Document the model in DATA-MODEL.md',
    command: 'docguard fix --doc data-model',
    llmCommand: '/docguard.fix --doc data-model',
    description: 'A database model in code is not documented in DATA-MODEL.md. Add an Entity entry for it.',
    autoFixable: false,
  },
  'Spec-Kit': {
    action: 'Add the missing Spec Kit artifact / section',
    description: 'A Spec Kit artifact (spec.md / plan.md / tasks.md) is missing a required section, FR-ID, or phased task structure. Edit the spec to match the standard.',
    autoFixable: false,
  },
  'API-Surface': {
    action: 'Reconcile API-REFERENCE.md with the real API surface',
    command: 'docguard fix --write',
    llmCommand: 'docguard fix --write',
    description: 'Documented-but-absent endpoints can be deleted mechanically with `docguard fix --write`. Undocumented-in-code endpoints need an agent to write the request/response block (`/docguard.fix --doc api-reference`).',
    autoFixable: true,
  },
};

export function runDiagnose(projectDir, config, flags) {
  if (flags.auto) assertDefaultDocWrites(config);
  // ── Step 0: Detect agent mode (LLM-first) ──
  const agentMode = detectAgentMode(projectDir);

  // ── Step 1: Run guard internally ──
  let guardData = runGuardInternal(projectDir, config);
  let scoreData = runScoreInternal(projectDir, config);

  // ── Step 2: Collect issues ──
  let issues = collectIssues(guardData);

  // ── Step 3: Auto-fix (only with --auto flag) or suggest fixes ──
  const shouldAutoFix = flags.auto && flags.format !== 'json';
  // Mechanical fixes = deterministic, no-LLM edits (e.g. remove a documented
  // endpoint the spec confirms is gone). Surfaced by the API-Surface validator.
  const mechanicalCount = countMechanicalFixes(guardData);
  if (issues.length > 0) {
    const autoFixable = issues.filter(i => i.autoFixable);
    const hasStructural = issues.some(i => i.validator === 'Structure');

    if (shouldAutoFix && (hasStructural || autoFixable.length > 0 || mechanicalCount > 0)) {
      // 1. init — create missing files
      try {
        const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docguard.mjs');
        execFileSync(process.execPath, [cliPath, 'init', '--dir', projectDir], { encoding: 'utf-8', stdio: 'pipe' });
      } catch { /* init may partially succeed */ }

      // 2. generate — fill MISSING content only (never --force; won't overwrite existing docs)
      try {
        const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docguard.mjs');
        execFileSync(process.execPath, [cliPath, 'generate', '--dir', projectDir], { encoding: 'utf-8', stdio: 'pipe' });
      } catch { /* generate may partially succeed */ }

      // 3. mechanical fixes — apply ALL deterministic edits (no LLM):
      // endpoint removal, stale counts, stale versions, changelog header.
      let mechApplied = 0;
      try {
        const r = applyAllMechanicalFixes(projectDir, config, { force: flags.force });
        mechApplied = r.applied.length;
      } catch { /* best-effort */ }

      // Re-run guard to see what's still broken
      guardData = runGuardInternal(projectDir, config);
      scoreData = runScoreInternal(projectDir, config);
      issues = collectIssues(guardData);

      if (!flags.format || flags.format === 'text') {
        const fixedCount = autoFixable.length - issues.filter(i => i.autoFixable).length;
        if (fixedCount > 0) {
          console.log(`  ${c.green}⚡ Auto-fixed ${fixedCount} issue(s)${c.reset} (created/regenerated docs)`);
        }
        if (mechApplied > 0) {
          console.log(`  ${c.green}⚡ Applied ${mechApplied} mechanical fix(es)${c.reset} (removed stale API endpoints)`);
        }
        if (fixedCount > 0 || mechApplied > 0) console.log('');
      }
    } else if (!shouldAutoFix && (!flags.format || flags.format === 'text')) {
      // Suggest-only mode — be accurate about what each path does.
      if (mechanicalCount > 0) {
        console.log(`  ${c.green}🔧 ${mechanicalCount} issue(s) are mechanically fixable — no AI needed.${c.reset} Apply with:`);
        console.log(`     ${c.cyan}docguard fix --write${c.reset}${c.dim}  (removes stale documented endpoints)${c.reset}`);
      }
      if (hasStructural || autoFixable.length > 0) {
        console.log(`  ${c.yellow}💡 ${autoFixable.length + (hasStructural ? 1 : 0)} issue(s) can be scaffolded/regenerated.${c.reset} Run ${c.cyan}docguard diagnose --auto${c.reset} (creates missing docs + applies mechanical fixes), or:`);
        if (agentMode === 'llm') {
          if (hasStructural) console.log(`     ${c.dim}/docguard.init${c.reset}`);
          if (autoFixable.length > 0) console.log(`     ${c.dim}/docguard.fix${c.reset}`);
        } else {
          if (hasStructural) console.log(`     ${c.dim}docguard init --dir .${c.reset}`);
          if (autoFixable.length > 0) console.log(`     ${c.dim}docguard generate --dir . --force${c.reset}`);
        }
      }
      if (mechanicalCount > 0 || hasStructural || autoFixable.length > 0) console.log('');
    }
  }

  // ── Step 4: Output ──
  const assessment = buildReadinessAssessment(guardData, scoreData);
  if (flags.format === 'json') {
    outputJSON(guardData, scoreData, issues, assessment);
  } else if (flags.format === 'prompt') {
    outputPrompt(projectDir, guardData, scoreData, issues, flags, agentMode, assessment);
  } else {
    outputText(projectDir, guardData, scoreData, issues, flags, agentMode, assessment);
  }
}

/** Count deterministic (no-LLM) fixes available across guard results. */
function countMechanicalFixes(guardData) {
  let n = 0;
  for (const v of guardData.validators) {
    if (Array.isArray(v.fixes)) n += v.fixes.length;
  }
  return n;
}

/**
 * A documented-but-absent endpoint is MECHANICALLY fixable (deterministic
 * removal via `docguard fix --write`) — distinct from drift that needs an agent.
 */
function isMechanicalMessage(validator, message) {
  return validator === 'API-Surface' && /not found in code/i.test(message);
}

/**
 * An issue whose `disposition` is `escalate` is NOT something to fix. Diagnose
 * exists to turn guard output into fix prompts, so it is the one command where
 * conflating the two is actively harmful: an agent handed "13 code commits
 * since the document was reviewed" as a defect will edit the document until
 * the message disappears, which is precisely the wrong action.
 *
 * `null` means the emitting validator still returns legacy strings and carries
 * no channel — unknown, not `act`. Those keep the pre-channel treatment rather
 * than being asserted as defects DocGuard established.
 *
 * See `docguard.calibrated-finding-channels` FR-001/FR-002 for the contract.
 */
function isEscalation(issue) {
  return issue.disposition === 'escalate';
}

/**
 * Collect issues from guard results with fix metadata.
 *
 * Prefers the validator's structured findings when it emits them, exactly as
 * `guard`'s renderer does, so each issue carries its channels. `resultFromFindings`
 * derives `errors`/`warnings` from the same array, so the issue COUNT is
 * identical either way — only the metadata is richer.
 */
function collectIssues(guardData) {
  const issues = [];
  for (const v of guardData.validators) {
    if (v.status === 'skipped' || v.status === 'pass' || v.status === 'na') continue;

    const fixInfo = FIX_INSTRUCTIONS[v.name] || { action: `Review ${v.name}`, description: 'Manual review needed.', autoFixable: false };
    const docTarget = VALIDATOR_TO_DOC[v.name];

    const mkIssue = (severity, message, finding) => {
      const mechanical = isMechanicalMessage(v.name, message);
      return {
        severity,
        validator: v.name,
        message,
        code: finding?.code || null,
        // The three channels, kept distinct. `severity` above answers "does CI
        // block"; these answer "who decides", "how sure is the detector of the
        // observation", "has this code ever been measured", "which analyzer saw it".
        disposition: finding?.disposition || null,
        confidence: finding?.confidence || null,
        evidenceStatus: finding?.evidence?.status || null,
        parserTier: finding?.parserTier || null,
        // The detector's own words. For an escalation this is what the reader
        // must decide — strictly better than the validator-level fix verb in
        // FIX_INSTRUCTIONS, which assumes there is something to fix.
        suggestionText: finding?.suggestion?.text || null,
        action: mechanical ? 'Remove stale endpoint from API-REFERENCE.md' : fixInfo.action,
        // Mechanical fixes point at the deterministic CLI applier, not an LLM.
        command: mechanical ? 'docguard fix --write' : (fixInfo.command || null),
        llmCommand: mechanical ? null : (fixInfo.llmCommand || null),
        mechanical,
        docTarget: mechanical ? null : docTarget,
        autoFixable: fixInfo.autoFixable || false,
      };
    };

    if (Array.isArray(v.findings) && v.findings.length > 0) {
      // Legacy severity mapping preserved: `resultFromFindings` puts every
      // non-error finding in `warnings`, so `info` stays a warning here too.
      for (const f of v.findings) {
        issues.push(mkIssue(f.severity === 'error' ? 'error' : 'warning', f.message, f));
      }
      continue;
    }
    for (const err of v.errors) issues.push(mkIssue('error', err, null));
    for (const warn of v.warnings) issues.push(mkIssue('warning', warn, null));
  }
  return issues;
}

function outputJSON(guardData, scoreData, issues, assessment) {
  // Structured, deterministic fix actions an agent or `--write` can apply directly.
  const mechanicalFixes = [];
  for (const v of guardData.validators) {
    if (Array.isArray(v.fixes)) {
      for (const f of v.fixes) mechanicalFixes.push({ validator: v.name, ...f });
    }
  }

  const result = {
    project: guardData.project,
    profile: guardData.profile,
    status: guardData.status,
    score: scoreData.score,
    grade: scoreData.grade,
    scoreKind: scoreData.scoreKind,
    assurance: scoreData.assurance,
    assessment,
    checkCoverage: guardData.checkCoverage,
    issueCount: issues.length,
    // The split an automated consumer must respect before it edits anything.
    // `unclassified` is a legacy string-only validator, not a licence to fix.
    dispositionCounts: {
      act: issues.filter(i => i.disposition === 'act').length,
      escalate: issues.filter(isEscalation).length,
      unclassified: issues.filter(i => i.disposition === null).length,
    },
    issues: issues.map(i => ({
      severity: i.severity,
      validator: i.validator,
      code: i.code,
      message: i.message,
      // Orthogonal to `severity`: a blocking error can still be an escalation.
      disposition: i.disposition,
      confidence: i.confidence,
      evidenceStatus: i.evidenceStatus,
      parserTier: i.parserTier,
      action: i.action,
      command: i.command,
      // 'mechanical' = deterministic CLI fix (docguard fix --write);
      // 'agent' = needs an AI agent to write content;
      // 'review' = an escalation — no fix exists, a human decides.
      fixKind: isEscalation(i) ? 'review' : i.mechanical ? 'mechanical' : 'agent',
      docTarget: i.docTarget,
    })),
    // Deterministic actions consumable by `docguard fix --write` or an agent.
    mechanicalFixes,
    // Unique fix commands for automation. Escalations are excluded on purpose:
    // running a fix command to clear a signal a human has not judged is the
    // failure this channel exists to prevent.
    fixCommands: [...new Set(issues.filter(i => i.command && !isEscalation(i)).map(i => i.command))],
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify(result, null, 2));
}

function outputText(projectDir, guardData, scoreData, issues, flags, agentMode = 'llm', assessment) {
  console.log(`${c.bold}🔍 DocGuard Diagnose — ${guardData.project}${c.reset}`);
  console.log(`${c.dim}   Profile: ${guardData.profile} | Structural Maturity: ${scoreData.score}/100 (${scoreData.grade}) | Mode: ${agentMode.toUpperCase()}${c.reset}`);
  console.log(`${c.dim}   Guard:   ${guardData.passed}/${guardData.total} passed | Status: ${guardData.status}${c.reset}\n`);
  const readinessColor = assessment.status === 'READY' ? c.green : assessment.status === 'ATTENTION' ? c.yellow : c.red;
  console.log(`  ${c.bold}Readiness:${c.reset} ${readinessColor}${c.bold}${assessment.status}${c.reset} ${c.dim}— ${assessment.summary}${c.reset}\n`);

  if (issues.length === 0) {
    console.log(`  ${c.green}${c.bold}✅ All clear!${c.reset} No issues found.\n`);
    if (agentMode === 'llm') {
      console.log(`  ${c.dim}Your documentation is healthy. Use ${c.cyan}/docguard.guard${c.dim} to re-validate after changes.${c.reset}\n`);
    } else {
      console.log(`  ${c.dim}Your documentation is healthy. Run \`docguard score --tax\` to see maintenance estimate.${c.reset}\n`);
    }
    return;
  }

  // Act vs escalate, stated before the severity listing below, because the two
  // answer different questions and only one of them is a work instruction.
  const actCount = issues.filter(i => i.disposition === 'act').length;
  const escalateCount = issues.filter(isEscalation).length;
  if (actCount > 0 || escalateCount > 0) {
    const parts = [];
    if (actCount > 0) parts.push(`${c.cyan}${actCount} to fix${c.reset}${c.dim}`);
    if (escalateCount > 0) parts.push(`${c.yellow}${escalateCount} to review${c.reset}${c.dim}`);
    console.log(`  ${c.dim}${parts.join(' · ')}${c.reset}${c.dim} (fix = DocGuard names the correction; review = the judgement is yours)${c.reset}\n`);
  }

  // Group by severity
  const errors = issues.filter(i => i.severity === 'error');
  const warnings = issues.filter(i => i.severity === 'warning');

  // Per-issue annotations, same vocabulary as `guard`: `low confidence` means
  // the detector may have misread its input; `review` means it read the input
  // correctly and the judgement is the reader's.
  const annotate = (i) => {
    const conf = i.confidence === 'low' ? ` ${c.dim}(low confidence — possible false positive)${c.reset}` : '';
    const disp = isEscalation(i) && i.confidence !== 'low' ? ` ${c.dim}(review — signal, not a verdict)${c.reset}` : '';
    return `${conf}${disp}`;
  };
  // An escalation has no fix. Printing "Fix: <cmd>" beside one invites exactly
  // the edit-until-it-disappears behaviour the disposition channel rules out.
  const fixLine = (i) => {
    if (isEscalation(i)) return `    ${c.dim}Decide: ${i.suggestionText || 'read the code and the document, then state which side is wrong.'}${c.reset}`;
    const cmd = agentMode === 'llm' && i.llmCommand ? i.llmCommand : i.command;
    return cmd ? `    ${c.dim}Fix: ${cmd}${c.reset}` : null;
  };

  if (errors.length > 0) {
    console.log(`  ${c.red}${c.bold}Errors (${errors.length}):${c.reset}`);
    for (const e of errors) {
      console.log(`  ${c.red}✗${c.reset} [${e.validator}] ${e.message}${annotate(e)}`);
      const line = fixLine(e);
      if (line) console.log(line);
    }
    console.log('');
  }

  if (warnings.length > 0) {
    console.log(`  ${c.yellow}${c.bold}Warnings (${warnings.length}):${c.reset}`);
    for (const w of warnings) {
      console.log(`  ${c.yellow}⚠${c.reset} [${w.validator}] ${w.message}${annotate(w)}`);
      const line = fixLine(w);
      if (line) console.log(line);
    }
    console.log('');
  }

  // ── Remediation Plan (LLM-first) ──
  // Escalations contribute no commands — see `fixCommands` in outputJSON.
  const commands = [...new Set(issues.filter(i => i.command && !isEscalation(i)).map(i => i.command))];
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
    outputDebatePrompt(projectDir, guardData, scoreData, issues, agentMode, assessment);
  } else {
    console.log(`  ${c.bold}🤖 AI-Ready Prompt:${c.reset}`);
    console.log(`  ${c.dim}Copy everything below and paste to your AI agent:${c.reset}\n`);
    outputPrompt(undefined, guardData, scoreData, issues, flags, agentMode, assessment);
  }
}

/**
 * The per-issue caveats a prompt must carry, in plain text (no ANSI — this
 * output is pasted into another agent). Two distinct facts, never merged:
 * `confidence: low` says the detector may have misread its input; a degraded
 * `parserTier` says no syntax tree was available, so ABSENCE of a finding in
 * those files proves nothing.
 */
function promptCaveat(issue) {
  const parts = [];
  if (issue.confidence === 'low') parts.push('low confidence — verify before acting');
  if (issue.parserTier === 'regex-fallback' || issue.parserTier === 'mixed') {
    parts.push(`parser: ${issue.parserTier} — read the file, not just this message`);
  }
  return parts.length ? ` (${parts.join('; ')})` : '';
}

function outputPrompt(projectDir, guardData, scoreData, issues, flags, agentMode = 'llm', assessment) {
  if (issues.length === 0) {
    console.log('No issues to fix. Documentation is healthy.');
    return;
  }

  // Detect agent capability for prompt complexity (inspired by CJE equalizer effect, TRACE 2026)
  const agentTier = detectAgentTier(projectDir || '.');

  // The split the prompt is built around. An escalation is not a task; handing
  // it to an agent under "ISSUES FOUND: fix these" produces a document edited
  // until the message stops printing, which destroys the signal and fixes nothing.
  const toFix = issues.filter(i => !isEscalation(i));
  const toReview = issues.filter(isEscalation);

  const lines = [];
  lines.push(`TASK: Resolve ${toFix.length} documentation defect(s) in project "${guardData.project}"${toReview.length ? `, and report on ${toReview.length} review signal(s)` : ''}`);
  lines.push(`Readiness: ${assessment.status} | Guard: ${guardData.status} | Structural Maturity: ${scoreData.score}/100 (${scoreData.grade})`);
  lines.push(assessment.summary);

  if (toFix.length > 0) {
    lines.push('');
    lines.push('DEFECTS TO FIX — DocGuard asserts each of these and names the correction:');
    for (let i = 0; i < toFix.length; i++) {
      const issue = toFix[i];
      lines.push(`${i + 1}. [${issue.severity.toUpperCase()}] [${issue.validator}] ${issue.message}${promptCaveat(issue)}`);
    }
  }

  if (toReview.length > 0) {
    lines.push('');
    lines.push('SIGNALS TO REVIEW — DocGuard observed these; the judgement is YOURS:');
    lines.push('Do NOT edit a document to make one of these disappear. Read the code and the');
    lines.push('document, decide which side is wrong, and say so. If neither is wrong, say that.');
    for (let i = 0; i < toReview.length; i++) {
      const issue = toReview[i];
      lines.push(`${i + 1}. [${issue.severity.toUpperCase()}] [${issue.validator}] ${issue.message}${promptCaveat(issue)}`);
      lines.push(`   Decide: ${issue.suggestionText || 'read the code and the document, then state which side is wrong.'}`);
    }
  }

  lines.push('');
  // When every issue is an escalation there is nothing to remediate. Printing
  // an empty "REMEDIATION STEPS:" header invites an agent to invent one.
  lines.push(toFix.length > 0
    ? 'REMEDIATION STEPS:'
    : 'REMEDIATION STEPS: none — every issue above is a review signal, not a defect.');

  // Group by unique fix command — defects only; a signal has no remediation.
  const fixGroups = {};
  for (const issue of toFix) {
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
  lines.push('Expected result: Resolve verified defects; explain remaining review signals and unsupported checks. Do not rewrite correct documents merely to remove warnings.');
  if (toReview.length > 0) {
    // Without this an agent treats a non-zero count as failure and keeps
    // editing. A judged-and-left signal is the CORRECT outcome, not a miss.
    lines.push(`The ${toReview.length} review signal(s) above will STILL PRINT after a correct run. Judging one and leaving it in place is success; reaching zero is not the goal.`);
  }
  lines.push(`Structural baseline: ${scoreData.score}/100. Resolve evidenced defects; verify material claims separately.`);
  lines.push('Preserve approved requirements when implementation disagrees. A higher score is not proof of factual correctness.');

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
function outputDebatePrompt(projectDir, guardData, scoreData, issues, agentMode = 'llm', assessment) {
  const lines = [];

  lines.push('═══════════════════════════════════════════════════════');
  lines.push('MULTI-PERSPECTIVE DOCUMENTATION ANALYSIS');
  lines.push(`Project: "${guardData.project}" | Readiness: ${assessment.status} | Guard: ${guardData.status} | Structural Maturity: ${scoreData.score}/100 (${scoreData.grade}) | Issues: ${issues.length}`);
  lines.push('Methodology: Multi-agent debate (Lopez et al., AITPG/TRACE, IEEE 2026)');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');

  // Issue context. `[fix]` / `[review]` is the disposition channel: `fix`
  // means DocGuard asserts a defect and names the correction; `review` means
  // it observed a signal and the judgement belongs to the reader. Orthogonal
  // to severity — a blocking error can still be a `review`.
  lines.push('CONTEXT — Current Issues ([fix] = DocGuard names the correction; [review] = the judgement is yours):');
  for (let i = 0; i < issues.length; i++) {
    const tag = isEscalation(issues[i]) ? 'review' : 'fix';
    lines.push(`  ${i + 1}. [${issues[i].severity.toUpperCase()}] [${tag}] [${issues[i].validator}] ${issues[i].message}${promptCaveat(issues[i])}`);
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
  lines.push('   Plan an EDIT only for a [fix] issue. For a [review] issue, plan a DECISION:');
  lines.push('   which source you will read, and what finding would make the doc wrong vs right.');
  lines.push('3. For each fix, specify:');
  lines.push('   a. Which file to edit');
  lines.push('   b. What section to add or modify');
  lines.push('   c. What content to write (be specific, not vague)');
  const verifyCmd = agentMode === 'llm' ? '/docguard.guard' : 'docguard guard';
  lines.push(`4. After all fixes, verify with: ${verifyCmd}`);
  lines.push('5. Verify repaired claims against their evidence and retain unresolved uncertainty. Structural score is a proxy.');
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
