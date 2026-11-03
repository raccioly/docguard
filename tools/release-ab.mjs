#!/usr/bin/env node
/**
 * Release trend gate: compare the release candidate with the previous release,
 * finding by finding, before it ships (specs/087-release-trend-gate).
 *
 *   node tools/release-ab.mjs --base <cli-tree> --head <cli-tree>
 *     [--config release-gate.json] [--changelog CHANGELOG.md] [--section <name>]
 *     [--out report.json] [--summary summary.md]
 *
 * Both CLIs run over the same corpus, one fresh git-initialized copy per CLI
 * and directory, serially: a shared copy lets one run's state (caches, the
 * anchor lock) leak into the other, and parallel runs on a loaded runner turn
 * git timeouts into phantom findings. Findings are compared as a multiset of
 * stable fingerprints, fingerprinted by the head tree's own function so a
 * fingerprint change between releases is not read as a finding change.
 *
 * The gate fails when a code's findings changed and the changelog section
 * being released never names that code, or an exit code changed and the
 * section has no `Exit codes:` line. Every change is printed, explained or
 * not. Whether the explanation is good is a reviewer's call.
 *
 * @implements docguard.release-trend-gate#FR-001
 * @implements docguard.release-trend-gate#FR-002
 * @implements docguard.release-trend-gate#FR-004
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SKIP = new Set(['.git', 'node_modules', '.docguard']);
const FIXED_DATE = '2026-01-01T00:00:00Z';

export function loadGateConfig(path) {
  const cfg = JSON.parse(readFileSync(path, 'utf8'));
  if (cfg.schemaVersion !== 1) throw new Error(`${path}: unsupported schemaVersion ${cfg.schemaVersion}`);
  if (!Array.isArray(cfg.corpus) || !cfg.corpus.length) throw new Error(`${path}: corpus must list at least one root`);
  const reasons = (where, map) => {
    for (const [code, reason] of Object.entries(map || {})) {
      if (!/^[A-Z]{2,4}\d{3}$/.test(code)) throw new Error(`${path}: ${where} key ${code} is not a finding code`);
      if (typeof reason !== 'string' || reason.trim().length < 10) throw new Error(`${path}: ${where}.${code} needs a reason`);
    }
  };
  reasons('volatileCodes', cfg.volatileCodes);
  for (const entry of cfg.corpus) {
    if (typeof entry === 'string') continue;
    if (!entry || typeof entry.path !== 'string') throw new Error(`${path}: a corpus entry is a path or { path, ignoreCodes }`);
    reasons(`corpus[${entry.path}].ignoreCodes`, entry.ignoreCodes);
  }
  return cfg;
}

/**
 * Corpus directories as `{ dir, ignoreCodes }`: a path ending in `/*` expands
 * to its subdirectories. `ignoreCodes` names codes a directory cannot judge,
 * with the reason: in the repository itself, DocGuard's own docs describe the
 * candidate, so the previous CLI disagrees with their counts by design.
 */
export function expandCorpus(headTree, entries) {
  const dirs = [];
  for (const entry of entries) {
    const root = typeof entry === 'string' ? entry : entry.path;
    const ignoreCodes = typeof entry === 'string' ? {} : entry.ignoreCodes || {};
    if (root.endsWith('/*')) {
      const base = resolve(headTree, root.slice(0, -2));
      for (const name of readdirSync(base).sort()) if (statSync(join(base, name)).isDirectory()) dirs.push({ dir: relative(headTree, join(base, name)) || '.', ignoreCodes });
    } else dirs.push({ dir: root, ignoreCodes });
  }
  return dirs;
}

function git(cwd, args) {
  // Scratch copies, like the benchmark runner's: no global or system config,
  // so a maintainer's hooks, signing or default branch never touch them.
  const env = { ...process.env, GIT_AUTHOR_DATE: FIXED_DATE, GIT_COMMITTER_DATE: FIXED_DATE, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull };
  const r = spawnSync('git', ['-c', 'user.name=release-ab', '-c', 'user.email=release-ab@invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${r.stderr}`);
  return r.stdout;
}

/** A fresh one-commit repository holding the tracked content of `source`. */
function freshCopy(headTree, source) {
  const parent = mkdtempSync(join(tmpdir(), 'docguard-release-ab-'));
  const dest = join(parent, 'p');
  const src = resolve(headTree, source);
  if (source === '.') {
    // The repository itself: its committed tree only, never local state.
    const archive = spawnSync('git', ['-C', src, 'archive', '--format=tar', 'HEAD'], { maxBuffer: 512 * 1024 * 1024 });
    if (archive.status !== 0) throw new Error(`git archive failed in ${src}`);
    mkdirSync(dest, { recursive: true });
    const untar = spawnSync('tar', ['-x', '-C', dest], { input: archive.stdout });
    if (untar.status !== 0) throw new Error('tar failed');
  } else {
    cpSync(src, dest, { recursive: true, filter: p => !SKIP.has(p.split('/').pop()) });
  }
  git(dest, ['init', '-q', '-b', 'main']);
  git(dest, ['add', '-A']);
  git(dest, ['commit', '-q', '--allow-empty', '-m', 'release-ab fixture']);
  return { dir: dest, cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

function runGuard(cliTree, dir) {
  const r = spawnSync(process.execPath, [resolve(cliTree, 'cli/docguard.mjs'), 'guard', '--format', 'json'], {
    cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600000,
    env: { ...process.env, NO_COLOR: '1', CI: '1' },
  });
  let data = null;
  try { data = JSON.parse(r.stdout); } catch { /* reported below */ }
  return { exit: r.status, data, error: data ? null : (r.error?.message || r.stderr.slice(0, 500) || 'no JSON output') };
}

const locOf = f => (typeof f.location === 'string' ? f.location : f.location?.file || '');

function multiset(findings, fingerprint) {
  const m = new Map();
  for (const f of findings) {
    const fp = fingerprint(f);
    const e = m.get(fp) || { code: f.code || 'DOCGUARD', location: locOf(f), message: f.message, n: 0 };
    e.n++;
    m.set(fp, e);
  }
  return m;
}

/** Findings only in `a`, counted. */
function minus(a, b) {
  const out = [];
  for (const [fp, e] of a) {
    const extra = e.n - (b.get(fp)?.n || 0);
    if (extra > 0) out.push({ ...e, n: extra });
  }
  return out;
}

export function compareRuns(base, head, fingerprint, volatile = {}, ignoreCodes = {}) {
  const changes = { added: [], removed: [], exit: null, validators: [], volatile: [], ignored: [] };
  if (base.exit !== head.exit) changes.exit = { base: base.exit, head: head.exit };
  if (!base.data || !head.data) return { ...changes, error: base.error || head.error };
  let added = minus(multiset(head.data.findings || [], fingerprint), multiset(base.data.findings || [], fingerprint));
  let removed = minus(multiset(base.data.findings || [], fingerprint), multiset(head.data.findings || [], fingerprint));
  // A volatile code is compared by count only: its message carries a date or a timing.
  for (const code of Object.keys(volatile)) {
    const count = list => (list.findings || []).filter(f => f.code === code).length;
    const b = count(base.data); const h = count(head.data);
    if (b !== h) changes.volatile.push({ code, base: b, head: h });
    added = added.filter(f => f.code !== code);
    removed = removed.filter(f => f.code !== code);
  }
  const ignore = f => Object.hasOwn(ignoreCodes, f.code);
  changes.ignored = [...added, ...removed].filter(ignore).map(f => ({ code: f.code, n: f.n, reason: ignoreCodes[f.code] }));
  changes.added = added.filter(f => !ignore(f));
  changes.removed = removed.filter(f => !ignore(f));
  // Status, and the verdict only when both releases report one: a release
  // that adds the verdict field has not changed any validator's answer.
  const index = d => new Map((d.validators || []).map(v => [v.key || v.name, v]));
  const bv = index(base.data); const hv = index(head.data);
  for (const key of [...new Set([...bv.keys(), ...hv.keys()])].sort()) {
    const b = bv.get(key); const h = hv.get(key);
    if (!b || !h) {
      if (b) changes.validators.push({ key, base: b.status, head: null });
      continue; // a validator new in this release is listed by its findings, not as a change
    }
    const differs = b.status !== h.status || (b.verdict && h.verdict && b.verdict !== h.verdict);
    if (differs) changes.validators.push({ key, base: `${b.status}${b.verdict ? `/${b.verdict}` : ''}`, head: `${h.status}${h.verdict ? `/${h.verdict}` : ''}` });
  }
  return changes;
}

/** The text of `## [section]` in a Keep a Changelog file. */
export function changelogSection(text, section) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => new RegExp(`^##\\s+\\[${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`).test(l));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && /^##\s+\[/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n');
}

/** Every changed code and exit code, and whether the section explains it. */
export function judge(results, section) {
  const codes = new Map();
  for (const r of results) {
    for (const f of [...(r.changes.added || []), ...(r.changes.removed || [])]) codes.set(f.code, (codes.get(f.code) || 0) + f.n);
    for (const v of r.changes.volatile || []) codes.set(v.code, (codes.get(v.code) || 0) + Math.abs(v.head - v.base));
  }
  const text = section || '';
  const unexplained = [...codes.keys()].filter(code => !new RegExp(`\\b${code}\\b`).test(text)).sort();
  const exitChanges = results.filter(r => r.changes.exit);
  const exitExplained = /^\s*(?:[-*]\s*)?(?:\*\*)?Exit codes:?(?:\*\*)?/im.test(text);
  const errors = results.filter(r => r.changes.error);
  return {
    pass: unexplained.length === 0 && (exitChanges.length === 0 || exitExplained) && errors.length === 0,
    changedCodes: Object.fromEntries([...codes].sort()),
    unexplained,
    exitChanges: exitChanges.map(r => ({ dir: r.dir, ...r.changes.exit })),
    exitExplained,
    errors: errors.map(r => ({ dir: r.dir, error: r.changes.error })),
  };
}

export function summarize(report) {
  const out = [`## Release trend gate: ${report.verdict.pass ? 'PASS' : 'FAIL'}`, '', `Compared ${report.base.version} → ${report.head.version} over ${report.results.length} corpus directories; changelog section \`[${report.section}]\`.`, ''];
  for (const r of report.results) {
    const c = r.changes;
    if (!c.added.length && !c.removed.length && !c.exit && !c.validators.length && !c.volatile.length && !c.ignored?.length && !c.error) continue;
    out.push(`### ${r.dir}`);
    if (c.error) out.push(`- could not compare: ${c.error}`);
    if (c.exit) out.push(`- exit code ${c.exit.base} → ${c.exit.head}`);
    for (const f of c.added) out.push(`- added ${f.code} ${f.location}${f.n > 1 ? ` ×${f.n}` : ''}: ${f.message}`);
    for (const f of c.removed) out.push(`- removed ${f.code} ${f.location}${f.n > 1 ? ` ×${f.n}` : ''}: ${f.message}`);
    for (const v of c.volatile) out.push(`- ${v.code} count ${v.base} → ${v.head} (volatile: compared by count)`);
    for (const v of c.validators) out.push(`- validator ${v.key}: ${v.base} → ${v.head}`);
    for (const i of c.ignored || []) out.push(`- ${i.code} ×${i.n} not judged here: ${i.reason}`);
    out.push('');
  }
  const v = report.verdict;
  if (v.unexplained.length) out.push(`**Unexplained:** ${v.unexplained.join(', ')}. Name each code in the changelog section and say why its findings changed.`);
  if (v.exitChanges.length && !v.exitExplained) out.push('**Exit codes changed** and the section has no `Exit codes:` line describing it.');
  if (v.pass) out.push('Every finding change is named in the changelog.');
  return `${out.join('\n')}\n`;
}

function flag(args, name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

async function main(args) {
  const baseTree = resolve(flag(args, '--base') || '');
  const headTree = resolve(flag(args, '--head') || '.');
  if (!flag(args, '--base')) throw new Error('--base <previous release tree> is required');
  const cfg = loadGateConfig(resolve(headTree, flag(args, '--config', 'release-gate.json')));
  const changelog = readFileSync(resolve(headTree, flag(args, '--changelog', 'CHANGELOG.md')), 'utf8');
  const version = dir => JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')).version;
  // Before the version cut the candidate still carries the released version,
  // whose section is the previous release's: read [Unreleased] then.
  const cut = version(headTree) !== version(baseTree) && changelogSection(changelog, version(headTree)) !== null;
  const section = flag(args, '--section') || (cut ? version(headTree) : 'Unreleased');
  const { fingerprintFinding } = await import(pathToFileURL(resolve(headTree, 'cli/writers/baseline.mjs')).href);
  const results = [];
  for (const { dir, ignoreCodes } of expandCorpus(headTree, cfg.corpus)) {
    const runs = {};
    for (const [side, tree] of [['base', baseTree], ['head', headTree]]) {
      const copy = freshCopy(headTree, dir);
      try { runs[side] = runGuard(tree, copy.dir); } finally { copy.cleanup(); }
    }
    results.push({ dir, base: { exit: runs.base.exit }, head: { exit: runs.head.exit }, changes: compareRuns(runs.base, runs.head, fingerprintFinding, cfg.volatileCodes || {}, ignoreCodes) });
    process.stderr.write(`release-ab: ${dir} compared\n`);
  }
  const report = { schemaVersion: 1, base: { version: version(baseTree) }, head: { version: version(headTree) }, section, results, verdict: judge(results, changelogSection(changelog, section)) };
  const outPath = flag(args, '--out');
  if (outPath) writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  const text = summarize(report);
  const summaryPath = flag(args, '--summary');
  if (summaryPath) writeFileSync(summaryPath, text, { flag: 'a' });
  process.stdout.write(text);
  return report.verdict.pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, err => { console.error(`release-ab: ${err.message}`); process.exitCode = 2; });
}

