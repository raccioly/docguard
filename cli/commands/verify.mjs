/**
 * Verify Command — `docguard verify --semantic` (LLM field report #5).
 *
 * Surfaces the semantic claims in the canonical docs (documented numbers, limits,
 * and enums) as a structured verification task list for the agent to check
 * against the code. DocGuard does the deterministic discovery; the LLM does the
 * judgment — the same division of labour as `docguard agent`.
 *
 * Read-only. JSON is the machine artifact (the agent-executable task list);
 * text is the human summary.
 *
 *   docguard verify [--semantic] [--format json]
 */

import { c } from '../shared.mjs';
import { detectAgentMode } from '../ensure-skills.mjs';
import { extractSemanticClaims, buildSemanticVerifyTasks } from '../scanners/semantic-claims.mjs';

export function runVerify(projectDir, config, flags) {
  const isJson = flags.format === 'json';
  const claims = extractSemanticClaims(projectDir, config);
  const tasks = buildSemanticVerifyTasks(claims);

  if (isJson) {
    console.log(JSON.stringify({
      command: 'verify --semantic',
      project: config.projectName,
      claimCount: tasks.length,
      // How to act on this: each task is a claim to confirm against the code.
      howToVerify: 'For each task, read the cited code (or grep for the constant/config), compare it to the documented value, and report any mismatch with both values. DocGuard cannot judge these — they require reading the code.',
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
