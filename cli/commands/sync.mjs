import { isMappedDocPath } from '../shared-doc-roles.mjs';
/**
 * Sync Command — keep the documentation memory ALWAYS UP TO DATE.
 *
 * Re-derives the code-truth surface (endpoints, entities, screens, tech-stack,
 * env vars) and refreshes the matching `source=code` sections of existing
 * canonical docs IN PLACE — mechanically, no LLM, idempotent. Human prose is
 * never touched (it lives outside markers / in `source=human` sections).
 *
 * When a code section changes, the prose sections in that doc are flagged for
 * agent review (e.g. "endpoints changed → re-read the API overview").
 *
 * Default is a DRY RUN (preview); `--write` applies. `--since <ref>` adds the
 * git diff as context. Only edits docguard:generated docs unless `--force`.
 * @implements docguard.document-lifecycle#FR-010
 * @implements docguard.code-derived-diagrams#FR-007
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { c } from '../shared.mjs';
import { buildMemoryPlan } from '../scanners/memory-plan.mjs';
import { assertOwnedCodeSection, getSection, inspectSections, replaceSection } from '../writers/sections.mjs';
import { safeWrite } from '../writers/generate-io.mjs';
import { hasGeneratedMarker } from '../writers/api-reference.mjs';
import { runSyncTests } from './sync-tests.mjs';
import { sectionTouchedByChanges } from '../shared-sync-scope.mjs';
import { readAgentSurface, commandHint } from '../agent-surface.mjs';

function gitChangedFiles(projectDir, since) {
  const run = (args) => {
    try {
      return execFileSync('git', args, { cwd: projectDir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n').map(s => s.trim()).filter(Boolean);
    } catch { return null; }
  };
  const committed = run(['diff', '--name-only', `${since}...HEAD`]);
  if (committed === null) return null;
  const working = run(['diff', '--name-only', since]) || [];
  return [...new Set([...committed, ...working])];
}

/**
 * L-1: Map each `source: 'code'` section ID to a predicate that returns true
 * when one of the changed file paths could plausibly affect it. Conservative
 * by design — when in doubt we run the section's sync, never skip it.
 *
 * The predicates are matched against project-relative POSIX paths (the form
 * `git diff --name-only` returns).
 */

/** Whether `ref` names a commit in this repository; null when git is unusable here. */
function refResolves(projectDir, ref) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: projectDir, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return null; }
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: projectDir, stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch { return false; }
}

/** The exact `sync` command that writes what this run could not (docguard.output-ux#FR-003). */
function syncCommand({ force = false, allowPartial = false, since = null } = {}) {
  return ['docguard sync --write', force && '--force', allowPartial && '--allow-partial', since && `--since ${since}`]
    .filter(Boolean).join(' ');
}

/**
 * @implements docguard.output-ux#FR-003
 * @implements docguard.output-ux#FR-004
 * @implements docguard.output-ux#FR-005
 */
export function runSync(projectDir, config, flags) {
  // v0.28 (field report #10): `--tests` reconciles the hand-maintained TEST-SPEC
  // Source-to-Test Map from disk (ghost-source removal + new co-located pairs) —
  // a distinct path from the generated code-truth section refresh below.
  if (flags.tests) return runSyncTests(projectDir, config, flags);

  // A ref git cannot resolve is a mistake to report, not a reason to fall back
  // to a full sync that exits 0. Outside a repository the documented "git
  // unavailable" fallback stands.
  if (flags.since && refResolves(projectDir, flags.since) === false) {
    console.error(`${c.red}✗ --since ${flags.since}: git cannot resolve that ref to a commit in this repository.${c.reset}`);
    process.exitCode = 1;
    return null;
  }

  const plan = buildMemoryPlan(projectDir, config);
  const apply = !!flags.write;
  const isJson = flags.format === 'json';
  const changed = flags.since ? gitChangedFiles(projectDir, flags.since) : null;
  const since = flags.since || null;

  const updates = [];   // { doc, section, status }
  const reviews = [];   // { doc, section, reason }
  const skipped = [];   // { doc, section?, stale, reason, command? }
  const pendingWrites = [];

  for (const doc of plan.docs) {
    const full = resolve(projectDir, doc.path);
    if (!existsSync(full)) {
      skipped.push({ doc: doc.path, stale: false, reason: 'not present — run `generate --plan --write` to create it' });
      continue;
    }
    let content = readFileSync(full, 'utf-8');
    const mapped = isMappedDocPath(config, doc.path);
    if (apply && mapped && inspectSections(content).issues.length) {
      throw new Error(`${doc.path}: malformed or duplicate docguard:section markers; no write was applied.`);
    }
    // A doc that is neither generated nor mapped is still compared, so the run
    // can say which of its sections are stale and that --force writes them.
    const writable = hasGeneratedMarker(content) || !!flags.force || mapped;
    const needsForce = !hasGeneratedMarker(content) && !mapped;

    let docChanged = false;
    let codeSectionChanged = false;
    let staleUnwritable = 0;
    for (const sec of doc.sections) {
      if (sec.source !== 'code') continue;
      const existing = getSection(content, sec.id);
      if (!existing) continue; // sync refreshes sections that already exist
      // B5: a pinned section is intentionally hand-maintained — never revert it.
      // (Pairs with the Generated-Staleness exemption for the same marker.)
      if (existing.attrs?.pinned !== undefined) {
        skipped.push({ doc: doc.path, section: sec.id, stale: false, reason: `section ${sec.id} is pinned (hand-maintained) — not synced` });
        continue;
      }
      if (existing.body.trim() === String(sec.body).trim()) continue; // already current
      // L-1: when --since is provided, only update sections whose underlying
      // source files appear in the changed set.
      if (changed !== null && !sectionTouchedByChanges(sec.id, changed)) {
        skipped.push({ doc: doc.path, section: sec.id, stale: false, reason: `section ${sec.id} unchanged since ${flags.since} (no underlying source files in diff)` });
        continue;
      }
      // docguard.code-derived-diagrams#FR-007: a section drawn from incomplete
      // evidence would overwrite a complete one with less. Opt in explicitly.
      if (sec.completeness === 'partial' && !flags.allowPartial) {
        skipped.push({
          doc: doc.path, section: sec.id, stale: true,
          reason: `section ${sec.id} is partial (${sec.partialReason}) — not synced; use --allow-partial to write it anyway`,
          command: syncCommand({ force: needsForce, allowPartial: true, since }),
        });
        continue;
      }
      if (!writable) {
        staleUnwritable++;
        skipped.push({
          doc: doc.path, section: sec.id, stale: true,
          reason: 'not marked docguard:generated (use --force to sync anyway)',
          command: syncCommand({ force: true, allowPartial: !!flags.allowPartial, since }),
        });
        continue;
      }
      codeSectionChanged = true;
      updates.push({ doc: doc.path, section: sec.id, status: apply ? 'updated' : 'stale' });
      if (apply) {
        if (mapped) assertOwnedCodeSection(content, sec.id, doc.path);
        content = replaceSection(content, sec.id, sec.body).content;
        docChanged = true;
      }
    }
    if (!writable && staleUnwritable === 0) {
      skipped.push({ doc: doc.path, stale: false, reason: 'not marked docguard:generated (use --force to sync anyway)' });
    }

    // If code changed, the prose around it may need an agent's eyes. Name only
    // prose sections the document has; a doc without any is named itself.
    if (codeSectionChanged) {
      const present = doc.sections.filter(sec => sec.source === 'human' && getSection(content, sec.id));
      for (const sec of present) {
        reviews.push({ doc: doc.path, section: sec.id, reason: 'a code section in this doc changed — review the prose' });
      }
      if (present.length === 0) {
        reviews.push({ doc: doc.path, section: null, reason: 'a code section in this doc changed — review its prose (the doc has no marked prose sections)' });
      }
    }

    if (apply && docChanged) pendingWrites.push({ full, content });
  }

  // Authorization for every mapped target completed above. Only now expose
  // writes, preserving backup behavior for both default and mapped layouts.
  for (const pending of pendingWrites) safeWrite(pending.full, pending.content);

  const result = {
    project: config.projectName,
    since,
    changedFiles: changed,
    applied: apply,
    updates,
    reviews,
    skipped,
    timestamp: new Date().toISOString(),
  };
  if (flags.silent) return result;
  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  console.log(`${c.bold}🔄 DocGuard Sync — ${config.projectName}${c.reset}`);
  if (flags.since) {
    const n = changed === null ? 'git unavailable' : `${changed.length} file(s) changed since ${flags.since}`;
    console.log(`${c.dim}   ${n}${c.reset}`);
  }
  console.log(`${c.dim}   ${apply ? 'Applying' : 'Dry run (use --write to apply)'}${c.reset}\n`);

  const staleSkipped = skipped.filter(s => s.stale);
  if (updates.length === 0 && staleSkipped.length === 0) {
    console.log(`  ${c.green}✅ Documentation memory is up to date — no code-truth sections drifted.${c.reset}\n`);
  } else if (updates.length > 0) {
    console.log(`  ${apply ? c.green : c.yellow}${apply ? '✅ Refreshed' : '⚠️  Stale'} ${updates.length} code-truth section(s):${c.reset}`);
    for (const u of updates) console.log(`     ${apply ? c.green : c.yellow}${apply ? '↻' : '•'} ${u.doc} → ${u.section}${c.reset}`);
    if (reviews.length > 0) {
      console.log(`\n  ${c.bold}🤖 Prose to review (${reviews.length}) — code changed near these sections:${c.reset}`);
      for (const r of reviews) console.log(`     ${c.dim}• ${r.doc}${r.section ? ` → ${r.section}` : ' (no marked prose sections)'}${c.reset}`);
      console.log(`  ${c.dim}Refresh the prose with your AI agent (${c.cyan}${commandHint(projectDir, readAgentSurface(projectDir), 'fix', '--doc <name>')}${c.dim}), then ${c.cyan}docguard guard${c.dim}.${c.reset}`);
    }
    if (!apply) {
      console.log(`\n  ${c.dim}Apply mechanical refreshes: ${c.cyan}${syncCommand({ force: !!flags.force, allowPartial: !!flags.allowPartial, since })}${c.reset}`);
    }
    console.log('');
  }

  if (staleSkipped.length > 0) {
    console.log(`  ${c.yellow}⚠️  ${staleSkipped.length} stale code-truth section(s) were not ${apply ? 'written' : 'included'}:${c.reset}`);
    for (const s of staleSkipped) console.log(`     ${c.yellow}• ${s.doc} → ${s.section}${c.reset} ${c.dim}— ${s.reason}${c.reset}`);
    for (const command of [...new Set(staleSkipped.map(s => s.command))]) {
      console.log(`  ${c.dim}Write them: ${c.cyan}${command}${c.reset}`);
    }
    console.log('');
  }

  const otherSkipped = skipped.filter(s => !s.stale);
  if (otherSkipped.length > 0 && flags.verbose) {
    console.log(`  ${c.dim}Skipped:${c.reset}`);
    for (const s of otherSkipped) console.log(`     ${c.dim}- ${s.doc}: ${s.reason}${c.reset}`);
    console.log('');
  }
  return result;
}
