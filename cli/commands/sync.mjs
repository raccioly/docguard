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
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { c } from '../shared.mjs';
import { buildMemoryPlan } from '../scanners/memory-plan.mjs';
import { getSection, replaceSection } from '../writers/sections.mjs';
import { hasGeneratedMarker } from '../writers/api-reference.mjs';
import { runSyncTests } from './sync-tests.mjs';

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
const SECTION_FILE_MATCHERS = {
  'tech-stack':        (p) => /package\.json$|pyproject\.toml$|Cargo\.toml$|go\.mod$|pom\.xml$|Gemfile$/.test(p),
  'frontend-modules':  (p) => /(^|\/)(src\/)?(stores|hooks|contexts|features)\//.test(p),
  'endpoints-table':   (p) => /(^|\/)(routes|controllers|handlers|app\/api)\//.test(p)
                              || /\.(yaml|yml|json)$/i.test(p) && /openapi|swagger/i.test(p),
  'entities-table':    (p) => /(^|\/)(models|schemas|entities)\//.test(p)
                              || /\.prisma$/.test(p),
  'relationships':     (p) => /(^|\/)(models|schemas|entities)\//.test(p)
                              || /\.prisma$/.test(p),
  'screens-table':     (p) => /(^|\/)(screens|pages|app)\//.test(p)
                              || /\.(tsx|jsx)$/.test(p),
  'flows':             (p) => /(^|\/)(screens|pages|app|routes)\//.test(p),
  'integrations-table':(p) => /package\.json$|pyproject\.toml$|requirements.*\.txt$|Cargo\.toml$/.test(p),
  'features-table':    (p) => /(^|\/)(features|domains)\//.test(p),
  'features':          (p) => /(^|\/)(features|domains)\//.test(p),
  'env-vars-table':    (p) => /\.env(\..+)?$|(^|\/)config\//.test(p)
                              || /\.(ts|tsx|js|jsx|mjs|py|go|rs|java|kt|rb)$/.test(p), // any code may use env
  'setup':             (p) => /\.env(\..+)?$|(^|\/)config\//.test(p),
};

/**
 * Decide whether a given code-truth section should be re-synced based on the
 * set of changed files. Returns true when:
 *   - changedFiles is null/empty (no scope info → sync everything), OR
 *   - any changed file matches the section's known source patterns, OR
 *   - the section has no matcher registered (unknown → conservative: sync)
 */
function sectionTouchedByChanges(sectionId, changedFiles) {
  if (!changedFiles || changedFiles.length === 0) return true;
  const matcher = SECTION_FILE_MATCHERS[sectionId];
  if (!matcher) return true; // unknown section → don't accidentally skip it
  return changedFiles.some(matcher);
}

export function runSync(projectDir, config, flags) {
  // v0.28 (field report #10): `--tests` reconciles the hand-maintained TEST-SPEC
  // Source-to-Test Map from disk (ghost-source removal + new co-located pairs) —
  // a distinct path from the generated code-truth section refresh below.
  if (flags.tests) return runSyncTests(projectDir, config, flags);

  const plan = buildMemoryPlan(projectDir, config);
  const apply = !!flags.write;
  const isJson = flags.format === 'json';
  const changed = flags.since ? gitChangedFiles(projectDir, flags.since) : null;

  const updates = [];   // { doc, section, status }
  const reviews = [];   // { doc, section, reason }
  const skipped = [];   // { doc, reason }

  for (const doc of plan.docs) {
    const full = resolve(projectDir, doc.path);
    if (!existsSync(full)) {
      skipped.push({ doc: doc.path, reason: 'not present — run `generate --plan --write` to create it' });
      continue;
    }
    let content = readFileSync(full, 'utf-8');
    if (!hasGeneratedMarker(content) && !flags.force) {
      skipped.push({ doc: doc.path, reason: 'not marked docguard:generated (use --force to sync anyway)' });
      continue;
    }

    let docChanged = false;
    let codeSectionChanged = false;
    for (const sec of doc.sections) {
      if (sec.source !== 'code') continue;
      const existing = getSection(content, sec.id);
      if (!existing) continue; // sync refreshes sections that already exist
      // B5: a pinned section is intentionally hand-maintained — never revert it.
      // (Pairs with the Generated-Staleness exemption for the same marker.)
      if (existing.attrs?.pinned !== undefined) {
        skipped.push({ doc: doc.path, reason: `section ${sec.id} is pinned (hand-maintained) — not synced` });
        continue;
      }
      if (existing.body.trim() === String(sec.body).trim()) continue; // already current
      // L-1: when --since is provided, only update sections whose underlying
      // source files appear in the changed set. Avoids spurious updates when
      // the section's CONTENT would naturally drift (e.g. timestamp-driven
      // counters) but no real source file changed.
      if (changed !== null && !sectionTouchedByChanges(sec.id, changed)) {
        skipped.push({ doc: doc.path, reason: `section ${sec.id} unchanged since ${flags.since} (no underlying source files in diff)` });
        continue;
      }
      codeSectionChanged = true;
      updates.push({ doc: doc.path, section: sec.id, status: apply ? 'updated' : 'stale' });
      if (apply) { content = replaceSection(content, sec.id, sec.body).content; docChanged = true; }
    }

    // If code changed, the prose around it may need an agent's eyes.
    if (codeSectionChanged) {
      for (const sec of doc.sections) {
        if (sec.source === 'human') {
          reviews.push({ doc: doc.path, section: sec.id, reason: 'a code section in this doc changed — review the prose' });
        }
      }
    }

    if (apply && docChanged) writeFileSync(full, content, 'utf-8');
  }

  if (isJson) {
    console.log(JSON.stringify({
      project: config.projectName,
      since: flags.since || null,
      changedFiles: changed,
      applied: apply,
      updates,
      reviews,
      skipped,
      timestamp: new Date().toISOString(),
    }, null, 2));
    return;
  }

  console.log(`${c.bold}🔄 DocGuard Sync — ${config.projectName}${c.reset}`);
  if (flags.since) {
    const n = changed === null ? 'git unavailable' : `${changed.length} file(s) changed since ${flags.since}`;
    console.log(`${c.dim}   ${n}${c.reset}`);
  }
  console.log(`${c.dim}   ${apply ? 'Applying' : 'Dry run (use --write to apply)'}${c.reset}\n`);

  if (updates.length === 0) {
    console.log(`  ${c.green}✅ Documentation memory is up to date — no code-truth sections drifted.${c.reset}\n`);
  } else {
    console.log(`  ${apply ? c.green : c.yellow}${apply ? '✅ Refreshed' : '⚠️  Stale'} ${updates.length} code-truth section(s):${c.reset}`);
    for (const u of updates) console.log(`     ${apply ? c.green : c.yellow}${apply ? '↻' : '•'} ${u.doc} → ${u.section}${c.reset}`);
    if (reviews.length > 0) {
      console.log(`\n  ${c.bold}🤖 Prose to review (${reviews.length}) — code changed near these sections:${c.reset}`);
      for (const r of reviews) console.log(`     ${c.dim}• ${r.doc} → ${r.section}${c.reset}`);
      console.log(`  ${c.dim}Run your AI agent (/docguard.fix) to refresh the prose, then ${c.cyan}docguard guard${c.dim}.${c.reset}`);
    }
    if (!apply) console.log(`\n  ${c.dim}Apply mechanical refreshes: ${c.cyan}docguard sync --write${c.reset}`);
    console.log('');
  }

  if (skipped.length > 0 && flags.verbose) {
    console.log(`  ${c.dim}Skipped:${c.reset}`);
    for (const s of skipped) console.log(`     ${c.dim}- ${s.doc}: ${s.reason}${c.reset}`);
    console.log('');
  }
}
