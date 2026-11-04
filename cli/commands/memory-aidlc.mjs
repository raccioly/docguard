/**
 * `docguard memory --export aidlc` and `--consolidate aidlc`
 * (specs/091-memory-governance). DocGuard feeds AWS AI-DLC verified facts and
 * consolidates its stage diaries without guessing. It never writes AI-DLC's
 * memory layers, and never runs `aidlc`.
 *
 * @implements docguard.memory-governance#FR-004
 * @implements docguard.memory-governance#FR-005
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { backtickRefs, diaryFiles, findAidlcSpaces, isPathTarget, pathExists, safeWorkspacePath } from '../scanners/aidlc.mjs';
import { getHeadInfo } from '../shared-git.mjs';
import { safeWrite } from '../writers/generate-io.mjs';
import { c } from '../shared.mjs';

function pickSpace(projectDir, name) {
  const spaces = findAidlcSpaces(projectDir);
  if (spaces.length === 0) return { error: 'No AI-DLC space found (expected aidlc/spaces/<space>/).' };
  const wanted = name || (spaces.some(s => s.space === 'default') ? 'default' : spaces[0].space);
  const space = spaces.find(s => s.space === wanted);
  return space ? { space } : { error: `No AI-DLC space "${wanted}". Spaces: ${spaces.map(s => s.space).join(', ')}` };
}

/** The digest: only facts whose comparison with code passed. */
export function buildCanonicalDigest(projectDir, domains, { version }) {
  const head = getHeadInfo(projectDir);
  const lines = [
    '# DocGuard canonical memory',
    '',
    `> Verified against the code by DocGuard ${version} at ${head ? head.commit.slice(0, 12) : 'an uncommitted tree'} on ${new Date().toISOString().slice(0, 10)}. Only facts whose comparison passed are listed; regenerate with \`docguard memory --export aidlc --write\`.`,
    '',
  ];
  for (const [key, d] of Object.entries(domains)) {
    if (!d || !Array.isArray(d.matchedItems) || d.matchedItems.length === 0) continue;
    lines.push(`## ${d.title}`, '', ...d.matchedItems.map(m => `- ${m}`), '');
  }
  return lines.join('\n');
}

export function exportAidlcMemory(projectDir, domains, flags, version) {
  const picked = pickSpace(projectDir, flags.space);
  if (picked.error) { console.error(`${c.red}✗ ${picked.error}${c.reset}`); process.exitCode = 1; return null; }
  const digest = buildCanonicalDigest(projectDir, domains, { version });
  const target = join(picked.space.abs, 'knowledge', 'docguard', 'canonical-memory.md');
  const rel = relative(projectDir, target).replace(/\\/g, '/');
  if (!flags.write) {
    process.stdout.write(digest + '\n');
    console.error(`${c.dim}(dry run) would write ${rel}; add --write${c.reset}`);
    return { written: false, path: rel, digest };
  }
  safeWrite(target, digest + '\n');
  console.log(`${c.green}✅ Wrote ${rel}${c.reset}`);
  console.log(`${c.dim}Index it in AI-DLC (DocGuard does not run aidlc): aidlc engine knowledge onboard ${rel}${c.reset}`);
  return { written: true, path: rel, digest };
}

const normalize = t => t.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').replace(/\s+/g, ' ').trim().toLowerCase();

export function consolidateAidlcMemory(projectDir, flags) {
  const picked = pickSpace(projectDir, flags.space);
  if (picked.error) { console.error(`${c.red}✗ ${picked.error}${c.reset}`); process.exitCode = 1; return null; }
  const groups = new Map();
  for (const file of diaryFiles(picked.space.abs)) {
    let text;
    try { text = readFileSync(file, 'utf-8'); } catch { continue; }
    const rel = relative(projectDir, file).replace(/\\/g, '/');
    text.split(/\r?\n/).forEach((line, i) => {
      if (!/^\s*(?:[-*+]|\d+\.)\s+\S/.test(line)) return;
      const key = normalize(line);
      if (key.length < 8) return;
      const g = groups.get(key) || { text: line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').trim(), occurrences: [], references: [] };
      g.occurrences.push(`${rel}:${i + 1}`);
      for (const r of backtickRefs(line)) if (isPathTarget(r.token) && !g.references.includes(r.token)) g.references.push(r.token);
      groups.set(key, g);
    });
  }
  const entries = [...groups.values()].map(g => ({
    ...g,
    stale: g.references.some(p => { const abs = safeWorkspacePath(projectDir, p.replace(/\/$/, '')); return abs ? !pathExists(abs, p.endsWith('/')) : false; }),
  })).sort((a, b) => b.occurrences.length - a.occurrences.length || a.text.localeCompare(b.text));
  const report = { space: picked.space.space, entries, note: 'A proposal: DocGuard never writes AI-DLC memory layers. Repeated entries are candidates for a project or team rule; stale entries name paths that are gone.' };
  if (flags.format === 'json') { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return report; }
  console.log(`${c.bold}🧠 AI-DLC diary consolidation — space ${report.space}${c.reset}\n`);
  for (const e of entries) {
    const mark = e.stale ? `${c.yellow}stale${c.reset} ` : '';
    console.log(`  ${mark}${e.occurrences.length}× ${e.text}`);
    for (const o of e.occurrences) console.log(`     ${c.dim}${o}${c.reset}`);
  }
  console.log(`\n${c.dim}${report.note}${c.reset}`);
  return report;
}
