/**
 * Agent Readability scanner — how well do this repo's docs serve an AI agent?
 *
 * Human readability (Flesch, passive voice — doc-quality.mjs) asks "can a
 * person read this prose?". This scanner asks the 2026 question: "can an AI
 * consumer FIND, QUOTE, and TRUST this documentation?" — token budgets,
 * section addressability, machine-parseable structure, metadata markers, and
 * unbroken pointers. Deterministic, zero-LLM, zero npm dependencies.
 *
 * DISPLAY-ONLY consumer contract: assessAgentReadability feeds a score display
 * block (like ALCOA+) and must never feed the gating CDD grade — CI thresholds
 * read that.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/** chars/4 — the standard rough token estimate; consistency matters more than precision. */
const estTokens = (s) => Math.ceil(s.length / 4);

const GRADES = [[90, 'A'], [75, 'B'], [60, 'C'], [40, 'D']];
function toGrade(score) {
  for (const [min, g] of GRADES) if (score >= min) return g;
  return 'F';
}

function readIfExists(path) {
  try { return existsSync(path) ? readFileSync(path, 'utf-8') : null; } catch { return null; }
}

function canonicalDocs(projectDir) {
  const dir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith('.md'))
      .sort()
      .map(f => ({ name: `docs-canonical/${f}`, content: readIfExists(resolve(dir, f)) }))
      .filter(d => d.content !== null);
  } catch { return []; }
}

/**
 * Split a markdown body into sections at H2/H3 headings.
 * Returns [{heading, body}] — body excludes the heading line itself.
 */
function splitSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let current = null;
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence && line.match(/^#{2,3}\s+(.+)$/);
    if (h) {
      if (current) sections.push(current);
      current = { heading: h[1].trim(), body: '' };
    } else if (current) {
      current.body += line + '\n';
    }
  }
  if (current) sections.push(current);
  return sections;
}

/** Fraction of non-blank lines that are structured (table/list/fence/heading/marker). */
function structuredFraction(content) {
  let structured = 0, total = 0, inFence = false;
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    total++;
    if (/^```/.test(t)) { inFence = !inFence; structured++; continue; }
    if (inFence) { structured++; continue; }
    if (/^(\||[-*+]\s|\d+\.\s|#{1,6}\s|>|<!--)/.test(t)) structured++;
  }
  return total === 0 ? 0 : structured / total;
}

/**
 * Assess agent readability for a project.
 * @returns {{ metrics: Array<{key,label,score,detail,fix}>, score: number, grade: string }}
 */
export function assessAgentReadability(projectDir, config = {}) {
  const metrics = [];
  const agentsMd = readIfExists(resolve(projectDir, 'AGENTS.md'));
  const claudeMd = readIfExists(resolve(projectDir, 'CLAUDE.md'));
  const agentEntry = agentsMd ?? claudeMd;
  const docs = canonicalDocs(projectDir);

  // 1. agent-entry — without an entry file, an agent starts blind.
  metrics.push({
    key: 'agent-entry',
    label: 'Agent entry file',
    score: agentEntry ? 100 : 0,
    detail: agentsMd ? 'AGENTS.md present' : claudeMd ? 'CLAUDE.md present (no AGENTS.md)' : 'no AGENTS.md or CLAUDE.md',
    fix: agentEntry ? null : 'Create AGENTS.md (docguard init scaffolds it) — agents need an entry point',
  });

  // 2. token-budget — an entry file beyond the skim budget gets skimmed, not read.
  if (agentEntry) {
    const tokens = estTokens(agentEntry);
    let score, fix = null;
    if (tokens <= 2000) score = 100;
    else if (tokens <= 4000) score = 75;
    else if (tokens <= 8000) { score = 40; fix = 'Trim the agent entry file below ~4k tokens — link out to detail docs instead of inlining'; }
    else { score = 10; fix = 'Agent entry file blows the context skim budget — split into linked canonical docs'; }
    metrics.push({
      key: 'token-budget',
      label: 'Entry-file token budget',
      score,
      detail: `~${tokens} est. tokens (ideal ≤2000, acceptable ≤4000)`,
      fix,
    });
  }

  // 3. addressability — can a section be quoted alone, and do anchors resolve uniquely?
  if (docs.length > 0) {
    let quotable = 0, totalSections = 0, dupDocs = [];
    for (const d of docs) {
      const sections = splitSections(d.content);
      totalSections += sections.length;
      quotable += sections.filter(s => estTokens(s.body) <= 120).length;
      const seen = new Set();
      for (const s of sections) {
        const slug = s.heading.toLowerCase();
        if (seen.has(slug)) { dupDocs.push(`${d.name} ("${s.heading}")`); break; }
        seen.add(slug);
      }
    }
    const frac = totalSections === 0 ? 0 : quotable / totalSections;
    let score = Math.round(frac * 100);
    if (dupDocs.length > 0) score = Math.max(0, score - 30);
    metrics.push({
      key: 'addressability',
      label: 'Section addressability',
      score,
      detail: `${quotable}/${totalSections} H2/H3 sections quotable alone (≤120 tok)${dupDocs.length ? `; duplicate headings: ${dupDocs[0]}${dupDocs.length > 1 ? ` +${dupDocs.length - 1}` : ''}` : ''}`,
      fix: score >= 60 ? null : dupDocs.length ? 'Make headings unique within each doc — duplicates break anchor links' : 'Split long sections — an agent should be able to quote one section without dragging the whole doc',
    });
  }

  // 4. structure-density — tables/lists/fences parse; prose walls don't.
  if (docs.length > 0) {
    const fracs = docs.map(d => structuredFraction(d.content));
    const avg = fracs.reduce((a, b) => a + b, 0) / fracs.length;
    const score = Math.min(100, Math.round((avg / 0.3) * 100));
    metrics.push({
      key: 'structure-density',
      label: 'Structured-content density',
      score,
      detail: `${Math.round(avg * 100)}% of canonical-doc lines are structured (target ≥30%)`,
      fix: score >= 60 ? null : 'Convert prose walls to tables/lists — structured content is machine-parseable',
    });
  }

  // 5. marker-presence — machine-readable metadata density.
  if (docs.length > 0) {
    const marked = docs.filter(d => /docguard:(last-reviewed|section|generated)/.test(d.content)).length;
    metrics.push({
      key: 'marker-presence',
      label: 'Machine markers',
      score: Math.round((marked / docs.length) * 100),
      detail: `${marked}/${docs.length} canonical docs carry docguard markers (last-reviewed / section / generated)`,
      fix: marked === docs.length ? null : 'Add <!-- docguard:last-reviewed YYYY-MM-DD --> to unmarked docs — agents use it to judge trust',
    });
  }

  // 6. llms-txt — the AI-consumer index standard.
  const hasLlms = existsSync(resolve(projectDir, 'llms.txt'));
  metrics.push({
    key: 'llms-txt',
    label: 'llms.txt index',
    score: hasLlms ? 100 : 0,
    detail: hasLlms ? 'llms.txt present at root' : 'no llms.txt at root',
    fix: hasLlms ? null : 'Run docguard llms — generates the llms.txt AI index from your canonical docs',
  });

  // 7. self-containedness — broken relative pointers strand an agent mid-task.
  // The entry file lives at the project root, so links resolve against it.
  if (agentEntry) {
    const links = [...agentEntry.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)]
      .map(m => m[1])
      .filter(l => !/^[a-z]+:\/\//i.test(l));
    if (links.length > 0) {
      const broken = links.filter(l => !existsSync(resolve(projectDir, l)));
      metrics.push({
        key: 'self-containedness',
        label: 'Entry-file link integrity',
        score: Math.round(((links.length - broken.length) / links.length) * 100),
        detail: broken.length === 0
          ? `${links.length}/${links.length} relative doc links resolve`
          : `${broken.length}/${links.length} relative links broken (first: ${broken[0]})`,
        fix: broken.length === 0 ? null : 'Fix the broken links — a dead pointer strands an agent mid-task',
      });
    }
  }

  const score = metrics.length === 0 ? 0
    : Math.round(metrics.reduce((sum, m) => sum + m.score, 0) / metrics.length);
  return { metrics, score, grade: toGrade(score) };
}
