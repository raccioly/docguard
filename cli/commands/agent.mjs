/**
 * `docguard agent` — the one-shot agent task graph.
 *
 * Field report §2: an LLM told "run docguard and fix the docs" had to drive ~10
 * manual round-trips (guard → init → config → generate → hand-write 7 docs →
 * guard → fix FPs → …). This command collapses that into a SINGLE ordered,
 * dependency-aware, self-contained task stream an agent executes without extra
 * discovery:
 *   - code-truth tasks ship PRE-FILLED content (insert as-is; only `<!-- … -->`
 *     placeholders need values),
 *   - human-judgment tasks carry the instruction + grounding facts,
 *   - every task has an acceptance/verify command so the agent self-checks in
 *     isolation instead of re-running the whole suite and diffing,
 *   - phases impose order: config → canonical-docs → verify,
 *   - confidence is propagated (code-truth = high; prose = requires-human), and
 *     anything the profile suppressed surfaces as a note, never a committed guess.
 *
 * Read-only: it emits the plan, it never writes. A compact human summary by
 * default; `--format json` emits the full machine task graph (the agent-
 * executable artifact) — mirroring `generate --plan` / `generate --plan
 * --format json`.
 */

import { buildMemoryPlan } from '../scanners/memory-plan.mjs';
import { c } from '../shared.mjs';

const PHASES = ['config', 'canonical-docs', 'verify'];

function docSlug(path) {
  return path.replace(/^docs-(?:canonical|implementation)\//, '').replace(/\.md$/, '').toLowerCase();
}

/**
 * Transform a memory plan into the ordered agent task graph. Pure — no I/O — so
 * it is unit-testable and reused by both the command and `generate`.
 */
export function buildAgentTaskGraph(projectDir, config, plan) {
  const profileName = config.profile || 'standard';
  const tasks = [];

  // Phase 1 — config: make the project model explicit BEFORE any doc is written.
  // (The agent learned this ordering by trial in the field report; encode it.)
  tasks.push({
    id: 'config.setup',
    phase: 'config',
    file: '.docguard.json',
    kind: 'human-judgment',
    instruction: `Ensure .docguard.json exists and is correct: run \`docguard init --profile ${profileName}\` if it is absent. Confirm projectName is "${config.projectName}" and profile is "${profileName}".`,
    grounding: { projectName: config.projectName, profile: profileName, kind: plan.profile.kind, languages: plan.profile.languages },
    prefilled: null,
    acceptance: { verify: 'docguard guard --format json', expect: '.docguard.json present and the config validator passes' },
    confidence: 'high',
  });

  // Phase 2 — canonical-docs: one task per section. Section order from the plan
  // already puts code-truth before prose within each doc, so insert-then-write.
  for (const doc of plan.docs) {
    const slug = docSlug(doc.path);
    for (const sec of doc.sections) {
      const isCode = sec.source === 'code';
      tasks.push({
        id: `${slug}.${sec.id}`,
        phase: 'canonical-docs',
        file: doc.path,
        section: sec.id,
        kind: isCode ? 'code-truth' : 'human-judgment',
        prefilled: isCode ? sec.body : null,
        instruction: isCode
          ? `Insert the pre-filled "${sec.id}" content into ${doc.path} verbatim — it is extracted from your code. Only fill any \`<!-- … -->\` placeholders.`
          : sec.task,
        grounding: sec.grounding || null,
        acceptance: { verify: 'docguard guard --format json', expect: `no missing/stale finding for ${doc.path}` },
        confidence: isCode ? 'high' : 'requires-human',
      });
    }
  }

  // Phase 3 — verify: the agent's own gate. Self-check, don't assume.
  tasks.push({
    id: 'verify.guard',
    phase: 'verify',
    file: null,
    kind: 'verify',
    instruction: 'Run `docguard guard --format json`. Resolve every error and warning, then re-run until clean. Run `docguard score` to confirm the maturity grade.',
    prefilled: null,
    grounding: null,
    acceptance: { verify: 'docguard guard --format json', expect: '0 errors' },
    confidence: 'high',
  });

  return {
    project: config.projectName,
    profile: { name: profileName, kind: plan.profile.kind, languages: plan.profile.languages, frameworks: plan.profile.frameworks },
    order: PHASES,
    counts: {
      tasks: tasks.length,
      codeTruth: tasks.filter(t => t.kind === 'code-truth').length,
      humanJudgment: tasks.filter(t => t.kind === 'human-judgment').length,
    },
    tasks,
    notes: plan.notes || [],
  };
}

export function runAgent(projectDir, config, flags) {
  // Allow `--profile <name>` to preview a profile's plan without having to run
  // `init` first (the field-report agent had no config yet on its first call).
  const cfg = flags.profile ? { ...config, profile: flags.profile } : config;
  const plan = buildMemoryPlan(projectDir, cfg);
  const graph = buildAgentTaskGraph(projectDir, cfg, plan);

  if (flags.format === 'json') {
    // The agent-executable artifact.
    console.log(JSON.stringify({ ...graph, timestamp: new Date().toISOString() }, null, 2));
    return;
  }

  // Default: a compact human summary of the same graph.
  {
    console.log(`${c.bold}🤖 DocGuard Agent Task Graph — ${graph.project}${c.reset}`);
    console.log(`${c.dim}   profile: ${graph.profile.name} · kind: ${graph.profile.kind} · ${graph.counts.tasks} tasks (${graph.counts.codeTruth} code-truth, ${graph.counts.humanJudgment} human)${c.reset}\n`);
    for (const phase of graph.order) {
      const inPhase = graph.tasks.filter(t => t.phase === phase);
      if (!inPhase.length) continue;
      console.log(`  ${c.bold}▸ ${phase}${c.reset}`);
      for (const t of inPhase) {
        const tag = t.kind === 'code-truth' ? `${c.green}[code]${c.reset} `
          : t.kind === 'verify' ? `${c.cyan}[verify]${c.reset}` : `${c.yellow}[human]${c.reset}`;
        console.log(`    ${tag} ${c.bold}${t.id}${c.reset}${t.file ? ` ${c.dim}→ ${t.file}${c.reset}` : ''}`);
      }
    }
    for (const note of graph.notes) console.log(`  ${c.yellow}ℹ️  ${note}${c.reset}`);
    console.log(`\n  ${c.dim}Run with --format json for the full machine-readable task stream.${c.reset}`);
  }
}
