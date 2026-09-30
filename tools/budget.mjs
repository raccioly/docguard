#!/usr/bin/env node

/**
 * Non-regression budgets: measure what a change costs users and agents, and
 * compare a head tree with its base on the same machine in the same job.
 *
 * Spec: specs/031-non-regression-budgets (docguard.non-regression-budgets).
 *
 *   node tools/budget.mjs measure --tree <dir> [--out report.json]
 *   node tools/budget.mjs compare --base <report.json> --head <report.json> [--message-file <pr-body>]
 *   node tools/budget.mjs ab --base <dir> --head <dir> [--message-file <pr-body>] [--summary <file>] [--out <json>]
 *
 * WHY BASE-VS-HEAD, NOT A THRESHOLD: an absolute time budget fails on a slow
 * runner and passes a real regression on a fast one. Comparing two trees in
 * one job, with interleaved samples and a floor under which a difference is
 * noise, measures the change and not the machine.
 *
 * Every metric runs as a child process of that tree's own CLI, so base is
 * measured by base's code. Guard timing runs both CLIs over the same targets
 * (the head tree and fixed fixtures), which isolates the code's speed from
 * content growth. Agent-facing bytes are measured per tree, because a longer
 * pack costs agents whatever caused it.
 *
 * @implements docguard.non-regression-budgets#FR-001
 * @implements docguard.non-regression-budgets#FR-002
 * @implements docguard.non-regression-budgets#FR-003
 * @implements docguard.non-regression-budgets#FR-004
 * @implements docguard.non-regression-budgets#FR-006
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_BUDGETS = resolve(SCRIPT_PATH, '..', '..', 'budgets.json');

export function loadBudgets(path = DEFAULT_BUDGETS) {
  const budgets = JSON.parse(readFileSync(path, 'utf8'));
  if (budgets.schemaVersion !== 1) throw new Error(`${path}: unsupported schemaVersion ${budgets.schemaVersion}`);
  return budgets;
}

export function median(values) {
  const xs = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

function cli(tree, args, { cwd = tree, input, timeout = 180000 } = {}) {
  const start = performance.now();
  const r = spawnSync(process.execPath, [resolve(tree, 'cli/docguard.mjs'), ...args], {
    cwd, input, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status, ms: performance.now() - start, error: r.error };
}

function jsonFrom(stdout) {
  const i = stdout.indexOf('{');
  return i < 0 ? null : JSON.parse(stdout.slice(i));
}

/** One guard wall-time sample per target, run by `tree`'s CLI. */
export function guardSample(tree, targets) {
  const out = {};
  for (const target of targets) {
    const r = cli(tree, ['guard', '--format', 'json', '--dir', target], { cwd: target });
    out[target] = r.error || !jsonFrom(r.stdout) ? null : r.ms;
  }
  return out;
}

function findings(tree) {
  const r = cli(tree, ['guard', '--format', 'json']);
  const j = r.error ? null : jsonFrom(r.stdout);
  if (!j) return null;
  const byCode = {};
  let errors = 0;
  for (const f of j.findings || []) {
    if (f.severity === 'info') continue;
    const key = `${f.code}:${f.severity}`;
    byCode[key] = (byCode[key] || 0) + 1;
    if (f.severity === 'error') errors++;
  }
  return { errors, byCode };
}

/** MCP responses for fixed requests, as byte counts per tool call. */
function mcpBytes(tree, calls) {
  const messages = [
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'budget', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    ...calls.map((call, i) => ({ jsonrpc: '2.0', id: 100 + i, method: 'tools/call', params: { name: call.tool, arguments: call.arguments || {} } })),
  ];
  const r = cli(tree, ['mcp'], { input: `${messages.map(m => JSON.stringify(m)).join('\n')}\n` });
  const byId = new Map();
  for (const line of r.stdout.split('\n')) {
    try { const m = JSON.parse(line); if (m.id !== undefined) byId.set(m.id, Buffer.byteLength(line)); } catch { /* not a message */ }
  }
  const out = {};
  const tools = byId.get(1);
  if (tools !== undefined) out['mcp:tools/list'] = tools;
  calls.forEach((call, i) => {
    const bytes = byId.get(100 + i);
    // A tool the tree does not have answers with an error; that is "absent",
    // not "small", so it is left out and compare() reports the head's as new.
    if (bytes !== undefined && !/"isError":true|"error":\{/.test(r.stdout.split('\n').find(l => l.includes(`"id":${100 + i}`)) || '')) {
      out[`mcp:${call.tool}${call.label ? `:${call.label}` : ''}`] = bytes;
    }
  });
  return out;
}

function agentBytes(tree, budgets) {
  const out = {};
  const pack = cli(tree, ['memory', '--pack', '--stdout']);
  if (!pack.error && pack.status === 0) out['memory-pack'] = Buffer.byteLength(pack.stdout);
  for (const [name, text] of Object.entries(budgets.agentTasks || {})) {
    const r = cli(tree, ['agent', '--task', text, '--format', 'json']);
    if (!r.error && jsonFrom(r.stdout)) out[`agent-task:${name}`] = Buffer.byteLength(r.stdout);
  }
  Object.assign(out, mcpBytes(tree, budgets.mcpCalls || []));
  for (const file of ['llms.txt', 'llms-full.txt']) {
    const p = resolve(tree, file);
    if (existsSync(p)) out[file] = statSync(p).size;
  }
  return out;
}

function packageWeight(tree) {
  const r = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: tree, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  try {
    const [info] = JSON.parse(r.stdout);
    return { size: info.size, unpackedSize: info.unpackedSize, files: info.entryCount ?? info.files?.length };
  } catch { return null; }
}

function dependencies(tree) {
  try { return Object.keys(JSON.parse(readFileSync(resolve(tree, 'package.json'), 'utf8')).dependencies || {}).sort(); } catch { return null; }
}

function staticMeasures(tree, budgets) {
  return {
    tree,
    version: (() => { try { return JSON.parse(readFileSync(resolve(tree, 'package.json'), 'utf8')).version; } catch { return null; } })(),
    findings: findings(tree),
    agentBytes: agentBytes(tree, budgets),
    package: packageWeight(tree),
    dependencies: dependencies(tree),
  };
}

/** One tree on its own (local use). Guard targets resolve against the tree. */
export function measure(tree, budgets = loadBudgets(), { samples = budgets.samples } = {}) {
  const root = resolve(tree);
  const targets = budgets.guardTargets.map(t => resolve(root, t));
  const runs = Array.from({ length: samples }, () => guardSample(root, targets));
  return { ...staticMeasures(root, budgets), guard: summarizeGuard(runs, targets, root) };
}

/** Base and head, guard samples interleaved over the head's targets. */
export function measurePair(baseTree, headTree, budgets = loadBudgets(), { samples = budgets.samples } = {}) {
  const base = resolve(baseTree);
  const head = resolve(headTree);
  const targets = budgets.guardTargets.map(t => resolve(head, t));
  const baseRuns = [];
  const headRuns = [];
  for (let i = 0; i < samples; i++) {
    // Alternate which tree goes first so warm caches favour neither.
    if (i % 2 === 0) { baseRuns.push(guardSample(base, targets)); headRuns.push(guardSample(head, targets)); }
    else { headRuns.push(guardSample(head, targets)); baseRuns.push(guardSample(base, targets)); }
  }
  return {
    base: { ...staticMeasures(base, budgets), guard: summarizeGuard(baseRuns, targets, head) },
    head: { ...staticMeasures(head, budgets), guard: summarizeGuard(headRuns, targets, head) },
  };
}

function summarizeGuard(runs, targets, root) {
  const out = {};
  for (const target of targets) {
    const label = target === root ? '.' : target.slice(root.length + 1);
    const values = runs.map(r => r[target]);
    out[label] = values.some(v => v === null) ? null : median(values);
  }
  return out;
}

/** `Budget-Exempt: <metric> — <reason>` lines; the reason is required. */
export function parseExemptions(text = '') {
  const out = new Map();
  for (const m of String(text).matchAll(/^Budget-Exempt:\s*(\S+)\s+[—–-]{1,2}\s*(.{8,})$/gm)) out.set(m[1], m[2].trim());
  return out;
}

function row(metric, base, head, budget, verdict, note = '') {
  const delta = Number.isFinite(base) && Number.isFinite(head) ? head - base : null;
  return { metric, base, head, delta, budget, verdict, note };
}

function ratioCheck(metric, base, head, { maxRatio, floor }, exemptions) {
  if (!Number.isFinite(head)) return row(metric, base, head, null, base === undefined ? 'N/A' : 'INCONCLUSIVE', 'head could not be measured');
  if (base === undefined) return row(metric, base, head, null, 'NEW');
  if (!Number.isFinite(base)) return row(metric, base, head, null, 'INCONCLUSIVE', 'base could not be measured');
  const limit = Math.max(base * maxRatio, base + floor);
  const budget = `≤ ${Math.round(limit)} (×${maxRatio}, floor +${floor})`;
  if (head <= limit) return row(metric, base, head, budget, 'PASS');
  if (exemptions.has(metric)) return row(metric, base, head, budget, 'EXEMPT', exemptions.get(metric));
  return row(metric, base, head, budget, 'FAIL');
}

/**
 * Apply budgets to two reports.
 * @returns {{ status: 'PASS'|'FAIL'|'INCONCLUSIVE', rows: object[] }}
 */
export function compare(base, head, budgets = loadBudgets(), exemptions = new Map()) {
  const rows = [];
  for (const target of Object.keys(head.guard || {})) {
    rows.push(ratioCheck(`guard-ms:${target}`, base.guard?.[target], head.guard[target], { maxRatio: budgets.guard.maxRatio, floor: budgets.guard.floorMs }, exemptions));
  }
  const baseErrors = base.findings?.errors;
  const headErrors = head.findings?.errors;
  if (!Number.isFinite(headErrors) || !Number.isFinite(baseErrors)) {
    rows.push(row('self-errors', baseErrors, headErrors, 'no new errors', 'INCONCLUSIVE', 'guard output could not be read'));
  } else if (headErrors > baseErrors && !exemptions.has('self-errors')) {
    rows.push(row('self-errors', baseErrors, headErrors, 'no new errors', 'FAIL'));
  } else {
    rows.push(row('self-errors', baseErrors, headErrors, 'no new errors', headErrors > baseErrors ? 'EXEMPT' : 'PASS', exemptions.get('self-errors') || ''));
  }
  const codes = new Set([...Object.keys(base.findings?.byCode || {}), ...Object.keys(head.findings?.byCode || {})]);
  for (const code of [...codes].sort()) {
    const b = base.findings?.byCode?.[code] || 0;
    const h = head.findings?.byCode?.[code] || 0;
    if (b !== h) rows.push(row(`findings:${code}`, b, h, 'review only', 'INFO'));
  }
  for (const metric of [...new Set([...Object.keys(base.agentBytes || {}), ...Object.keys(head.agentBytes || {})])].sort()) {
    const h = head.agentBytes?.[metric];
    if (h === undefined) { rows.push(row(`bytes:${metric}`, base.agentBytes[metric], undefined, null, 'GONE')); continue; }
    rows.push(ratioCheck(`bytes:${metric}`, base.agentBytes?.[metric], h, { maxRatio: budgets.agentBytes.maxRatio, floor: budgets.agentBytes.floorBytes }, exemptions));
  }
  for (const key of ['size', 'unpackedSize', 'files']) {
    rows.push(ratioCheck(`package:${key}`, base.package?.[key], head.package?.[key], { maxRatio: budgets.package.maxRatio, floor: budgets.package.floor[key] }, exemptions));
  }
  const added = (head.dependencies || []).filter(d => !(base.dependencies || []).includes(d));
  if (head.dependencies === null || base.dependencies === null) rows.push(row('dependencies', null, null, 'none new', 'INCONCLUSIVE'));
  else if (added.length && !exemptions.has('dependencies')) rows.push(row('dependencies', base.dependencies.length, head.dependencies.length, 'none new', 'FAIL', `added: ${added.join(', ')}`));
  else rows.push(row('dependencies', base.dependencies.length, head.dependencies.length, 'none new', added.length ? 'EXEMPT' : 'PASS', added.length ? exemptions.get('dependencies') : ''));

  const status = rows.some(r => r.verdict === 'FAIL') ? 'FAIL' : rows.some(r => r.verdict === 'INCONCLUSIVE') ? 'INCONCLUSIVE' : 'PASS';
  return { status, rows };
}

const fmt = v => (v === null || v === undefined ? '—' : Number.isFinite(v) ? String(Math.round(v)) : String(v));

export function renderTable(result) {
  const lines = [
    `### Non-regression budgets: ${result.status}`,
    '',
    '| Metric | Base | Head | Δ | Budget | Verdict |',
    '|---|---:|---:|---:|---|---|',
    ...result.rows.map(r => `| \`${r.metric}\` | ${fmt(r.base)} | ${fmt(r.head)} | ${r.delta === null ? '—' : (r.delta > 0 ? '+' : '') + Math.round(r.delta)} | ${r.budget || '—'} | ${r.verdict}${r.note ? ` — ${r.note}` : ''} |`),
    '',
    'Guard times are medians of interleaved samples on one runner. `Budget-Exempt: <metric> — <reason>` in the PR body waives one metric.',
  ];
  return `${lines.join('\n')}\n`;
}

const EXIT = { PASS: 0, FAIL: 1, INCONCLUSIVE: 2 };

function main(argv) {
  const [cmd, ...rest] = argv;
  const opt = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
  const budgets = loadBudgets(opt('--budgets') || DEFAULT_BUDGETS);
  const samples = opt('--samples') ? Number(opt('--samples')) : budgets.samples;
  const exemptions = parseExemptions(opt('--message-file') ? readFileSync(opt('--message-file'), 'utf8') : '');
  const emit = (value, table) => {
    if (opt('--out')) writeFileSync(opt('--out'), `${JSON.stringify(value, null, 2)}\n`);
    if (table && opt('--summary')) writeFileSync(opt('--summary'), table, { flag: 'a' });
    console.log(table || JSON.stringify(value, null, 2));
  };
  if (cmd === 'measure') return emit(measure(opt('--tree') || '.', budgets, { samples }));
  if (cmd === 'compare') {
    const result = compare(JSON.parse(readFileSync(opt('--base'), 'utf8')), JSON.parse(readFileSync(opt('--head'), 'utf8')), budgets, exemptions);
    emit(result, renderTable(result));
    process.exitCode = EXIT[result.status];
    return undefined;
  }
  if (cmd === 'ab') {
    if (!opt('--base')) throw new Error('ab needs --base <dir>: a checkout of the base revision, e.g. git worktree add ../base origin/main');
    const pair = measurePair(opt('--base'), opt('--head') || '.', budgets, { samples });
    const result = compare(pair.base, pair.head, budgets, exemptions);
    emit({ ...pair, result }, renderTable(result));
    process.exitCode = EXIT[result.status];
    return undefined;
  }
  throw new Error('usage: budget.mjs measure|compare|ab (see the header of tools/budget.mjs)');
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(`budget: ${error.message}`);
    process.exitCode = 2;
  }
}
