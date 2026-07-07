/**
 * Verify Command — `docguard verify` (LLM field reports #5, #11).
 *
 * Two modes, same division of labour (DocGuard does the deterministic
 * discovery; the LLM does the judgment — like `docguard agent`):
 *
 *   --semantic (default)  Surface the semantic claims in the canonical docs
 *                         (documented numbers, limits, enums) as a verification
 *                         task list for the agent to check against the code.
 *
 *   --instructions        Audit the agent instruction files themselves
 *                         (AGENTS.md, CLAUDE.md) for drift: duplicate rules,
 *                         direct never/always contradictions, stale file
 *                         pointers, and unknown docguard commands are found
 *                         deterministically; topically-clustered rule pairs
 *                         become agent tasks ("do these contradict in
 *                         practice?"). Inspired by spec-kit's MemoryLint.
 *
 * Read-only. JSON is the machine artifact (the agent-executable task list);
 * text is the human summary.
 *
 *   docguard verify [--semantic | --instructions] [--format json]
 */

import { basename } from 'node:path';
import { c } from '../shared.mjs';
import { detectAgentMode } from '../ensure-skills.mjs';
import { extractSemanticClaims, buildSemanticVerifyTasks } from '../scanners/semantic-claims.mjs';
import { auditInstructions } from '../scanners/instruction-audit.mjs';
import { isGitRepo, getDiffText } from '../shared-git.mjs';
import { parseUnifiedDiff, activityLabeledDiff } from '../shared-diff.mjs';

const CHANGE_CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift|scala|dart)$/;

/**
 * Structured change context for staged agent tasks (feat 6). When `--since` is
 * given, decompose the code diff into activity-labeled spans (ordered
 * replace/delete/add) — the CARL-CCI representation shown to beat raw-text
 * diffs (arXiv 2512.19883). The agent judging a claim then sees WHAT changed,
 * not just the claim. Returns null when there's no ref / git / diff.
 *
 * Bounded: caps files and per-activity lines so the JSON stays agent-sized.
 */
function buildChangeContext(projectDir, since, { maxFiles = 40, maxLines = 6 } = {}) {
  if (!since || !isGitRepo(projectDir)) return null;
  const files = parseUnifiedDiff(getDiffText(projectDir, since))
    .filter(f => f.newPath && CHANGE_CODE_EXT.test(f.newPath) && f.status !== 'deleted');
  if (files.length === 0) return null;
  const clip = (arr) => arr.slice(0, maxLines).map(s => s.length > 200 ? s.slice(0, 200) + '…' : s);
  const activities = files.slice(0, maxFiles).map(f => ({
    file: f.newPath,
    activities: activityLabeledDiff(f).map(a => ({
      type: a.type,
      ...(a.del ? { del: clip(a.del) } : {}),
      ...(a.add ? { add: clip(a.add) } : {}),
    })),
  }));
  return { since, changedFiles: files.map(f => f.newPath), activities };
}

// Best-effort: is this semantic-verify task about code that just changed?
function taskTouchesChange(task, changedSet, changedBasenames) {
  const cite = task.citedCode || '';
  if (!cite) return false;
  if (changedSet.has(cite)) return true;
  const b = basename(cite);
  return changedBasenames.has(b) || [...changedSet].some(p => cite.includes(p) || p.includes(cite));
}

export function runVerify(projectDir, config, flags) {
  if (flags.instructions) {
    runInstructionAudit(projectDir, config, flags);
    return;
  }

  const isJson = flags.format === 'json';
  const claims = extractSemanticClaims(projectDir, config);
  const tasks = buildSemanticVerifyTasks(claims);

  // Change-aware staging (feat 6): if --since given, attach the structured diff
  // and flag which claims are about just-changed code (verify those first).
  const changeContext = buildChangeContext(projectDir, flags.since);
  if (changeContext) {
    const changedSet = new Set(changeContext.changedFiles);
    const changedBasenames = new Set(changeContext.changedFiles.map(f => basename(f)));
    for (const t of tasks) t.aboutChangedCode = taskTouchesChange(t, changedSet, changedBasenames);
    // Prioritize changed-code claims first.
    tasks.sort((a, b) => (b.aboutChangedCode ? 1 : 0) - (a.aboutChangedCode ? 1 : 0));
  }

  if (isJson) {
    console.log(JSON.stringify({
      command: 'verify --semantic',
      project: config.projectName,
      claimCount: tasks.length,
      // How to act on this: each task is a claim to confirm against the code.
      howToVerify: changeContext
        ? 'Claims flagged aboutChangedCode are about code that changed since the ref — verify those FIRST using changeContext.activities (the ordered replace/delete/add spans show exactly what changed). For each task, read the cited code, compare to the documented value, report mismatches with both values.'
        : 'For each task, read the cited code (or grep for the constant/config), compare it to the documented value, and report any mismatch with both values. DocGuard cannot judge these — they require reading the code.',
      ...(changeContext ? { changeContext } : {}),
      tasks,
    }, null, 2));
    return;
  }

  console.log(`${c.bold}🔬 DocGuard Verify — semantic claims${c.reset}`);
  console.log(`${c.dim}   ${config.projectName} · documented numbers / limits / enums to check against code${c.reset}\n`);

  if (tasks.length === 0) {
    console.log(`  ${c.green}✅ No semantic claims found in the canonical docs.${c.reset}`);
    console.log(`  ${c.dim}(Looks for numbers with units — days/ms/req-s/GSIs/roles/… — and status/enum lists.)${c.reset}\n`);
    return;
  }

  // Group by doc for a readable summary.
  const byDoc = new Map();
  for (const t of tasks) {
    if (!byDoc.has(t.doc)) byDoc.set(t.doc, []);
    byDoc.get(t.doc).push(t);
  }

  console.log(`  ${c.yellow}${tasks.length} claim(s) to verify against the code:${c.reset}\n`);
  if (changeContext) {
    const nChanged = tasks.filter(t => t.aboutChangedCode).length;
    console.log(`  ${c.cyan}⚡ ${nChanged} claim(s) are about code changed since ${flags.since}${c.reset} ${c.dim}— verify these first (structured diff in --format json).${c.reset}\n`);
  }
  for (const [doc, ts] of byDoc) {
    console.log(`  ${c.bold}${doc}${c.reset}`);
    for (const t of ts) {
      const val = t.kind === 'enum' ? `enum ${t.value}` : `${t.value}${t.unit ? ` ${t.unit}` : ''}`;
      const cited = t.citedCode ? `${c.cyan}${t.citedCode}${c.reset}` : `${c.dim}(no cited code — grep for it)${c.reset}`;
      console.log(`    ${c.yellow}•${c.reset} L${t.line} ${c.dim}${t.section ? `[${t.section}] ` : ''}${c.reset}${c.bold}${val}${c.reset} → check ${cited}`);
    }
    console.log('');
  }

  const mode = detectAgentMode(projectDir);
  const cmd = mode === 'llm' ? '/docguard.verify' : 'docguard verify --semantic --format json';
  console.log(`  ${c.dim}This is the highest-value bug class and DocGuard can't judge it — an agent must.${c.reset}`);
  console.log(`  ${c.dim}Get the machine task list: ${c.cyan}${cmd}${c.dim}, then read each cited file and confirm the value.${c.reset}\n`);
}

// ── verify --instructions: agent-instruction drift/conflict audit ───────────

function runInstructionAudit(projectDir, config, flags) {
  const isJson = flags.format === 'json';
  const { rules, deterministic, tasks } = auditInstructions(projectDir, config);
  const { duplicates, negations, stalePointers, staleCommands } = deterministic;
  const findingCount = duplicates.length + negations.length + stalePointers.length + staleCommands.length;
  // Structured change context helps the agent judge whether a rule about code
  // has been invalidated by a recent change (feat 6).
  const changeContext = buildChangeContext(projectDir, flags.since);

  if (isJson) {
    console.log(JSON.stringify({
      command: 'verify --instructions',
      project: config.projectName,
      ruleCount: rules.length,
      findingCount,
      findings: deterministic,
      taskCount: tasks.length,
      // How to act on this: findings are proven; tasks need judgment.
      howToVerify: 'The findings are deterministic — fix them directly (delete the duplicate copy, resolve the negation in favour of one rule, repoint or remove stale paths/commands). For each task, read both rules in context and judge whether they contradict in practice; if so, report which should win, why, and which file to edit. DocGuard cannot judge the tasks — they require understanding intent.',
      ...(changeContext ? { changeContext } : {}),
      tasks,
    }, null, 2));
    return;
  }

  console.log(`${c.bold}🔬 DocGuard Verify — instruction audit${c.reset}`);
  console.log(`${c.dim}   ${config.projectName} · duplicate / contradictory / stale rules in AGENTS.md + CLAUDE.md${c.reset}\n`);

  if (rules.length === 0) {
    console.log(`  ${c.green}✅ No instruction rules found (no AGENTS.md/CLAUDE.md, or nothing imperative in them).${c.reset}\n`);
    return;
  }

  console.log(`  ${c.dim}${rules.length} rule(s) extracted from ${[...new Set(rules.map(r => r.file))].join(' + ')}${c.reset}\n`);

  if (findingCount === 0) {
    console.log(`  ${c.green}✅ No duplicate, directly-contradictory, or stale rules found.${c.reset}\n`);
  } else {
    console.log(`  ${c.yellow}${findingCount} deterministic finding(s):${c.reset}\n`);
    for (const d of duplicates) {
      const where = d.rules.map(r => `${r.file}:${r.line}`).join(` ${c.dim}≡${c.reset} `);
      console.log(`    ${c.yellow}⚠${c.reset} duplicate rule — ${where}: ${c.dim}"${d.rules[0].text}"${c.reset}`);
    }
    for (const n of negations) {
      console.log(`    ${c.yellow}⚠${c.reset} negation conflict — ${n.a.file}:${n.a.line} ${c.dim}⇄${c.reset} ${n.b.file}:${n.b.line}: ${c.dim}"${n.a.text}" vs "${n.b.text}"${c.reset}`);
    }
    for (const s of stalePointers) {
      console.log(`    ${c.yellow}⚠${c.reset} stale pointer — ${s.file}:${s.line}: ${c.cyan}${s.path}${c.reset} does not exist`);
    }
    for (const s of staleCommands) {
      console.log(`    ${c.yellow}⚠${c.reset} stale command — ${s.file}:${s.line}: ${c.cyan}docguard ${s.command}${c.reset} is not a docguard command`);
    }
    console.log('');
  }

  if (tasks.length > 0) {
    console.log(`  ${c.yellow}${tasks.length} rule pair(s) for the agent to judge:${c.reset}\n`);
    for (const t of tasks) {
      console.log(`  ${c.bold}${t.a.file}:${t.a.line} ↔ ${t.b.file}:${t.b.line}${c.reset} ${c.dim}(shared: ${t.sharedTerms.join(', ')})${c.reset}`);
      console.log(`    ${c.yellow}A${c.reset} ${c.dim}${t.a.section ? `[${t.a.section}] ` : ''}${c.reset}"${t.a.text}"`);
      console.log(`    ${c.yellow}B${c.reset} ${c.dim}${t.b.section ? `[${t.b.section}] ` : ''}${c.reset}"${t.b.text}"`);
      console.log('');
    }

    const mode = detectAgentMode(projectDir);
    const cmd = mode === 'llm' ? '/docguard.verify' : 'docguard verify --instructions --format json';
    console.log(`  ${c.dim}Whether clustered rules contradict in practice is judgment DocGuard can't make — an agent must.${c.reset}`);
    console.log(`  ${c.dim}Get the machine task list: ${c.cyan}${cmd}${c.dim}, then judge each pair and report which rule should win.${c.reset}\n`);
  } else if (findingCount === 0) {
    console.log(`  ${c.dim}(Looks for duplicate/negated rules, dead file pointers, unknown docguard commands, and topically-clustered rule pairs.)${c.reset}\n`);
  }
}
