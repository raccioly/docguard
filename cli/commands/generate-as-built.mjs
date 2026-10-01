/**
 * `docguard generate --spec <area>` — an as-built Spec Kit specification for
 * one area of existing code.
 *
 * Spec: specs/024-as-built-specs. DocGuard proposes one requirement candidate
 * per deterministic fact and leaves every statement to the agent; with
 * --write it creates the spec in the next free feature directory and records
 * `origin: as_built` + `sourcePaths` in the registry, so guard keeps the spec
 * and the code in step (SPR007).
 *
 * @implements docguard.as-built-specs#FR-001
 * @implements docguard.as-built-specs#FR-003
 */

import { existsSync, rmdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { c } from '../shared.mjs';
import { areaTests, collectAreaFacts, factsTier, isPatternTier, nextFeatureDir, renderAsBuiltSpec, resolveArea, slugFor } from '../scanners/as-built.mjs';
import { projectSpecRegistry, SPEC_REGISTRY_PATH } from '../scanners/spec-registry.mjs';
import { commitFileTransaction } from '../writers/file-transaction.mjs';

const SPEC_ID_RE = /^[a-z0-9][a-z0-9._-]{2,127}$/;

function defaultSpecId(config, projectDir, slug) {
  const project = String(config.projectName || basename(resolve(projectDir))).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '') || 'project';
  return `${project}.${slug}`.slice(0, 128);
}

export function runGenerateAsBuilt(projectDir, config, flags) {
  const json = flags.format === 'json';
  const fail = reason => {
    if (json) console.log(JSON.stringify({ command: 'generate --spec', status: 'ERROR', reason }, null, 2));
    else console.error(`${c.red}✗${c.reset} ${reason}`);
    process.exitCode = 1;
    return { status: 'ERROR', reason };
  };

  const area = resolveArea(projectDir, flags.spec);
  if (!area.ok) return fail(area.reason);
  const facts = collectAreaFacts(projectDir, area.rel, config);
  const tests = areaTests(projectDir, area.rel);
  if (facts.length === 0) return fail(`No deterministic facts (routes, exports, environment variables, entities) found under ${area.rel}; nothing to anchor an as-built spec on.`);

  const slug = slugFor(area.rel);
  const dirName = nextFeatureDir(projectDir, slug);
  const specId = flags.id || defaultSpecId(config, projectDir, slug);
  if (!SPEC_ID_RE.test(specId)) return fail(`Invalid spec ID ${JSON.stringify(specId)} (lowercase letters, digits, dots, underscores, hyphens; 3-128 chars).`);
  const title = `As-built: ${area.rel}`;
  const content = renderAsBuiltSpec({ title, specId, areaRel: area.rel, facts, tests, dirName, date: new Date().toISOString().slice(0, 10) });
  const specPath = `specs/${dirName}/spec.md`;
  // Which analyzer read the route and entity facts: a candidate the pattern
  // fallback could not see is missing, so the result says so
  // (docguard.python-extraction#FR-013).
  const tier = factsTier(facts);
  const lowConfidence = isPatternTier(tier.tier);
  const notes = lowConfidence
    ? [`Routes and entities were read by the pattern fallback, not a syntax tree (${tier.tierReason || 'no parser'}); a candidate it cannot see is missing. Install python3 (or fix the parse error) and re-run for exact facts.`]
    : [];
  const result = {
    command: 'generate --spec', status: 'PLANNED', area: area.rel, specId, path: specPath, facts, tests, written: false,
    parserTier: tier.tier, confidence: lowConfidence ? 'low' : 'high', notes,
  };

  if (flags.write) {
    const abs = resolve(projectDir, specPath);
    if (existsSync(abs)) return fail(`${specPath} already exists.`);
    const before = projectSpecRegistry(projectDir, config);
    if (before.issues.length) return fail(`Registry has integrity issues; fix them first: ${before.issues.map(i => i.message).join(' ')}`);
    // One transaction: the registry can only be projected once the spec is on
    // disk, so its write runs inside the spec transaction's validation. A
    // failure there rolls back both files (Constitution VI; no plain write).
    const registryPath = resolve(projectDir, SPEC_REGISTRY_PATH);
    try {
      commitFileTransaction([{ path: abs, content }], {
        validate: () => {
          const projection = projectSpecRegistry(projectDir, config);
          const entry = projection.registry.specs.find(s => s.specId === specId);
          if (projection.issues.length || !entry) {
            throw new Error(projection.issues.map(i => i.message).join(' ') || `The new spec ${specId} did not register.`);
          }
          // Current behaviour, living document, not yet reviewed by a human.
          entry.reviewed.lifecycle.delivery = 'implemented';
          entry.reviewed.lifecycle.persistenceModel = 'living';
          entry.reviewed.lifecycle.origin = 'as_built';
          entry.reviewed.scope.sourcePaths = [area.rel];
          commitFileTransaction([{ path: registryPath, content: `${JSON.stringify(projection.registry, null, 2)}\n` }], {
            validate: () => {
              const after = projectSpecRegistry(projectDir, config);
              if (after.issues.length) throw new Error(after.issues.map(i => i.message).join(' '));
            },
          });
        },
      });
    } catch (error) {
      try { rmdirSync(dirname(abs)); } catch { /* the directory is not empty or already gone */ }
      return fail(`As-built spec not written: ${error.message}`);
    }
    result.status = 'WRITTEN';
    result.written = true;
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return result;
  }
  const byKind = facts.reduce((m, f) => ({ ...m, [f.kind]: (m[f.kind] || 0) + 1 }), {});
  console.log(`${c.bold}🧭 As-built spec — ${area.rel}${c.reset}`);
  console.log(`  ${facts.length} requirement candidate(s): ${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(' · ')}; ${tests.length} existing test file(s)`);
  console.log(`  Spec ID: ${specId}`);
  for (const note of notes) console.log(`  ${c.yellow}⚠️  ${note}${c.reset}`);
  console.log(`  ${result.written ? `${c.green}✅ Written${c.reset}` : 'Would write'}: ${specPath}${result.written ? ' (registry: origin as_built, sourcePaths recorded)' : ` — re-run with ${c.cyan}--write${c.reset}`}`);
  console.log(`  ${c.dim}Next: have your agent replace each <!-- agent: … --> note with the requirement it observes; keep every docguard:fact marker. Guard reports new or vanished facts (SPR007).${c.reset}`);
  if (!result.written) {
    for (const f of facts.slice(0, 8)) console.log(`   ${c.dim}• ${f.kind} ${f.key}${c.reset}`);
    if (facts.length > 8) console.log(`   ${c.dim}… ${facts.length - 8} more${c.reset}`);
  }
  return result;
}
