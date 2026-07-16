/**
 * Report Command — Compliance-evidence bundle for audits.
 *
 * `docguard report` runs guard + score internally and emits a deterministic
 * evidence report: who/what/when (git commit, branch, tool version), the
 * guard verdict per validator, the findings summary, the CDD score with its
 * ALCOA+ data-integrity attributes, and the mechanical-fix history. An
 * `integrity` sha256 over the canonical JSON payload makes the bundle
 * tamper-evident — re-running `docguard report --format json` at the same
 * commit reproduces the same evidence. The generation timestamp and the
 * ALCOA+ section are excluded from the hash for that reason (both are
 * wall-clock-relative; ALCOA's Contemporaneous attribute also depends on
 * file mtimes, which reset on a fresh clone).
 *
 * Report is EVIDENCE, not a gate: it always exits 0. `guard` and `ci` remain
 * the commands that fail builds. This split matters for auditors — evidence
 * collection must not change behavior depending on what it observes.
 *
 * Output: markdown to stdout by default, `--format json` for the machine
 * bundle, `--out <file>` to write either format to a file instead.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { c } from '../shared.mjs';
import { runGuardInternal } from './guard.mjs';
import { runScoreInternal, computeAlcoaCompliance } from './score.mjs';
import { getHeadInfo, isGitRepo } from '../shared-git.mjs';
import { loadFixMemory } from '../writers/fix-memory.mjs';

const _PKG = JSON.parse(readFileSync(resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'), 'utf-8'));
const CLI_VERSION = _PKG.version;

/**
 * Build the evidence payload. Pure gather — no printing, no exit. The
 * `integrity` hash covers everything EXCEPT `generatedAt` and the hash
 * itself, so the same tree state always yields the same hash.
 */
export function buildReport(projectDir, config) {
  const guardData = runGuardInternal(projectDir, config);
  const scoreData = runScoreInternal(projectDir, config);
  const alcoa = computeAlcoaCompliance(projectDir, config, scoreData.categories);
  const git = isGitRepo(projectDir) ? getHeadInfo(projectDir) : null;
  const fixMemory = loadFixMemory(projectDir);

  // Findings grouped by stable code — auditors care about "how many of
  // which class", not the per-file noise. Codeless findings group as OTHER.
  const byCode = new Map();
  for (const f of guardData.findings || []) {
    const code = f.code || 'OTHER';
    const entry = byCode.get(code) || { code, severity: f.severity, count: 0, sample: null };
    entry.count++;
    if (!entry.sample && f.message) entry.sample = f.message;
    byCode.set(code, entry);
  }
  const findingsSummary = [...byCode.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  const payload = {
    tool: { name: 'docguard', version: CLI_VERSION },
    project: {
      name: config.projectName,
      profile: config.profile || 'standard',
      type: config.projectType || 'unknown',
    },
    git: git ? { commit: git.commit, branch: git.branch, dirty: git.dirty } : null,
    guard: {
      status: guardData.status,
      passed: guardData.passed,
      total: guardData.total,
      errors: guardData.errors,
      warnings: guardData.warnings,
      // Audit-critical (H3): evidence must disclose what a committed baseline
      // is suppressing — "no findings" with a hidden baseline is false green.
      baselineSuppressed: guardData.baselineSuppressed || 0,
      validators: (guardData.validators || [])
        .filter(v => v.status !== 'skipped')
        .map(v => ({ name: v.name, status: v.status })),
    },
    findings: findingsSummary,
    score: {
      score: scoreData.score,
      grade: scoreData.grade,
      categories: scoreData.categories,
    },
    alcoa: {
      score: alcoa.score,
      met: alcoa.met,
      total: alcoa.total,
      attributes: alcoa.attributes.map(a => ({
        name: a.name, met: a.met, evidence: a.evidence, gap: a.gap,
      })),
    },
    fixHistory: {
      entries: fixMemory.entries.length,
      lastApplied: fixMemory.entries.length
        ? fixMemory.entries.reduce((max, e) => (e.appliedAt > max ? e.appliedAt : max), '')
        : null,
    },
  };

  // Integrity scope (M3): the hash covers the git-stable sections only. The
  // ALCOA+ block is excluded because its Contemporaneous attribute derives
  // from file mtimes vs now — it drifts with wall-clock time and resets on a
  // fresh clone, which would break "same commit ⇒ same hash".
  const { alcoa: _unhashed, ...hashable } = payload;
  const integrity = 'sha256:' + createHash('sha256').update(JSON.stringify(hashable)).digest('hex');
  return { ...payload, generatedAt: new Date().toISOString(), integrity };
}

function toMarkdown(r) {
  const lines = [];
  const gitLine = r.git
    ? `commit \`${r.git.commit.slice(0, 12)}\`${r.git.branch ? ` (${r.git.branch})` : ' (detached HEAD)'}${r.git.dirty ? ' — **uncommitted changes present**' : ''}`
    : 'not a git repository';

  lines.push(`# Documentation Compliance Report — ${r.project.name}`);
  lines.push('');
  lines.push(`Generated ${r.generatedAt} by DocGuard v${r.tool.version} · ${gitLine}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| CDD Score | ${r.score.score}/100 (${r.score.grade}) |`);
  lines.push(`| Guard | ${r.guard.status.toUpperCase()} — ${r.guard.passed}/${r.guard.total} checks, ${r.guard.errors} error(s), ${r.guard.warnings} warning(s) |`);
  if (r.guard.baselineSuppressed > 0) {
    lines.push(`| Baseline | ⚠️ ${r.guard.baselineSuppressed} pre-existing finding(s) suppressed by \`.docguard.baseline.json\` — not reflected in the counts above |`);
  }
  lines.push(`| ALCOA+ data integrity | ${r.alcoa.score}% (${r.alcoa.met}/${r.alcoa.total} attributes) |`);
  lines.push(`| Profile | ${r.project.profile} (${r.project.type}) |`);
  lines.push('');

  lines.push('## Validators');
  lines.push('');
  lines.push('| Validator | Status |');
  lines.push('|-----------|--------|');
  for (const v of r.guard.validators) {
    const icon = v.status === 'pass' ? '✅' : v.status === 'warn' ? '⚠️' : v.status === 'na' ? '➖' : '❌';
    lines.push(`| ${v.name} | ${icon} ${v.status} |`);
  }
  lines.push('');

  lines.push('## Findings');
  lines.push('');
  if (r.findings.length === 0) {
    lines.push(r.guard.baselineSuppressed > 0
      ? `No new findings beyond the ${r.guard.baselineSuppressed} suppressed by the committed baseline (run \`docguard guard --no-baseline\` for the full picture).`
      : 'No findings — documentation matches the implementation at this commit.');
  } else {
    lines.push('| Code | Severity | Count | Example |');
    lines.push('|------|----------|------:|---------|');
    for (const f of r.findings) {
      lines.push(`| ${f.code} | ${f.severity} | ${f.count} | ${(f.sample || '').replace(/\|/g, '\\|')} |`);
    }
  }
  lines.push('');

  lines.push('## ALCOA+ Attributes');
  lines.push('');
  lines.push('| Attribute | Met | Evidence / Gap |');
  lines.push('|-----------|-----|----------------|');
  for (const a of r.alcoa.attributes) {
    lines.push(`| ${a.name} | ${a.met ? '✅' : '❌'} | ${(a.met ? a.evidence : a.gap) || '—'} |`);
  }
  lines.push('');

  lines.push('## Fix History');
  lines.push('');
  lines.push(r.fixHistory.entries
    ? `${r.fixHistory.entries} mechanical fix(es) on record (\`.docguard/fixed.json\`), last applied ${r.fixHistory.lastApplied}.`
    : 'No mechanical fixes on record.');
  lines.push('');

  lines.push('## Integrity');
  lines.push('');
  lines.push(`\`${r.integrity}\` — sha256 over the canonical JSON payload, excluding \`generatedAt\`, this hash, and the \`alcoa\` section (its Contemporaneous attribute is wall-clock/mtime-relative). Re-run \`docguard report --format json\` at the same commit to reproduce.`);
  lines.push('');
  return lines.join('\n');
}

export function runReport(projectDir, config, flags) {
  const report = buildReport(projectDir, config);
  const isJson = flags.format === 'json';
  const output = isJson ? JSON.stringify(report, null, 2) : toMarkdown(report);

  if (flags.out) {
    writeFileSync(resolvePath(projectDir, flags.out), output + '\n');
    // Chrome goes to stderr-style short confirm only in non-JSON mode; in
    // JSON mode stay silent so scripted callers see nothing unexpected.
    if (!isJson) console.log(`${c.green}✅ Report written to ${flags.out}${c.reset}`);
    return report;
  }

  // Machine/markdown output IS the artifact: write + natural exit (never
  // console.log + process.exit — >8 KB payloads truncate through a pipe).
  process.stdout.write(output + '\n');
  return report;
}
