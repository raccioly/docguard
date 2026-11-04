/**
 * `docguard policy` — the project's enforcement ladder, with promotion
 * evidence from its own CI history (specs/083-enforcement-ladder).
 *
 * For every finding code: what the config sets, the level it last had when it
 * fired, and how many of the last `window` usable CI runs saw it. An advisory
 * code that this project has exercised and that stayed silent for the whole
 * window is ready to promote to blocking; a blocking code firing in half the
 * window is noisy. Evidence, not probability: the window is a sample size.
 *
 * Read-only: it reads `.docguard/history.jsonl` and writes nothing.
 *
 * @implements docguard.enforcement-ladder#FR-006
 * @implements docguard.enforcement-ladder#FR-007
 * @implements docguard.enforcement-ladder#FR-008
 * @implements docguard.enforcement-ladder#FR-009
 * @implements docguard.enforcement-ladder#FR-010
 */
import { CODES, codeDefaultLevel } from '../findings.mjs';
import { loadHistory } from '../writers/history.mjs';
import { c } from '../shared.mjs';

const LEVEL = { high: 'error', medium: 'warn', low: 'info' };

function semverAtLeast(version, min) {
  const parse = v => String(v || '').split(/[.-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
  const a = parse(version), b = parse(min);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/** What the config says, before any finding fires. */
function configured(config, code, validator) {
  const exact = config.findingSeverity?.[code];
  if (typeof exact === 'string' && LEVEL[exact.toLowerCase()]) return { level: LEVEL[exact.toLowerCase()], source: 'finding' };
  if (codeDefaultLevel(code)) return { level: 'info', source: 'code' };
  const v = config.severity?.[validator];
  if (typeof v === 'string' && LEVEL[v.toLowerCase()]) return { level: `${LEVEL[v.toLowerCase()]} for warnings`, source: 'validator' };
  return { level: 'intrinsic', source: 'intrinsic' };
}

export function buildPolicyReport(projectDir, config = {}, { window = 5 } = {}) {
  const entries = loadHistory(projectDir, 1000);
  const withoutCodes = entries.filter(e => !e.codes || typeof e.codes !== 'object').length;
  const withGaps = entries.filter(e => e.codes && (e.verdicts?.gaps || 0) > 0).length;
  const usable = entries.filter(e => e.codes && typeof e.codes === 'object' && (e.verdicts?.gaps || 0) === 0);
  const recent = usable.slice(-window);
  const enough = usable.length >= window;
  const required = new Set(Array.isArray(config.requiredChecks) ? config.requiredChecks : []);

  const codes = Object.keys(CODES).sort().map(code => {
    const meta = CODES[code];
    const since = meta.since || null;
    const knows = e => !since || semverAtLeast(e.docguardVersion, since);
    const seenIn = usable.filter(e => knows(e) && e.codes[code]);
    const window_ = recent.filter(knows);
    const hits = window_.filter(e => e.codes[code]).length;
    const lastLevel = seenIn.length ? seenIn[seenIn.length - 1].codes[code].level : null;
    let category;
    if (!enough) category = 'insufficient-evidence';
    else if ((lastLevel === 'warn' || lastLevel === 'info') && hits === 0) category = 'ready-to-promote';
    else if (lastLevel === 'error' && hits >= Math.ceil(window / 2)) category = 'noisy-blocking';
    else category = seenIn.length ? 'steady' : 'not-observed';
    return {
      code, validator: meta.validator || null, title: meta.title || null,
      configured: configured(config, code, meta.validator),
      required: required.has(meta.validator),
      lastLevel, runs: window_.length, hits, category,
      ...(category === 'ready-to-promote' ? { promote: `"findingSeverity": { "${code}": "high" }` } : {}),
    };
  });

  let note;
  if (entries.length === 0) note = 'No history: run `docguard ci` and keep .docguard/history.jsonl between CI runs (CI-RECIPES) to collect promotion evidence.';
  else if (!enough) note = `${window - usable.length} more usable runs needed before any promotion is recommended (window ${window}).`;
  else note = `Evidence from the last ${window} usable runs. A window is a sample size, not a probability.`;

  return {
    window,
    history: { entries: entries.length, usable: usable.length, withoutCodes, withGaps },
    codes,
    note,
  };
}

export function runPolicy(projectDir, config, flags = {}) {
  const window = Number.parseInt(flags.window, 10) > 0 ? Number.parseInt(flags.window, 10) : 5;
  const report = buildPolicyReport(projectDir, config, { window });
  if (flags.format === 'json') {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  console.log(`${c.bold}⚖️  DocGuard Policy — ${config.projectName || 'project'}${c.reset}`);
  console.log(`${c.dim}   ${report.history.usable} usable of ${report.history.entries} recorded run(s); window ${window}. ${report.note}${c.reset}\n`);
  const promote = report.codes.filter(x => x.category === 'ready-to-promote');
  const noisy = report.codes.filter(x => x.category === 'noisy-blocking');
  console.log(`  ${c.bold}Ready to promote${c.reset} ${c.dim}(advisory, exercised here, silent for the window)${c.reset}`);
  if (promote.length === 0) console.log(`    ${c.dim}none${c.reset}`);
  for (const x of promote) console.log(`    ${c.green}${x.code}${c.reset} ${x.title} ${c.dim}— 0/${x.runs} runs; add ${x.promote}${c.reset}`);
  console.log(`\n  ${c.bold}Noisy blocking codes${c.reset} ${c.dim}(blocking, fired in at least half the window)${c.reset}`);
  if (noisy.length === 0) console.log(`    ${c.dim}none${c.reset}`);
  for (const x of noisy) console.log(`    ${c.yellow}${x.code}${c.reset} ${x.title} ${c.dim}— ${x.hits}/${x.runs} runs${c.reset}`);
  if (report.history.withGaps || report.history.withoutCodes) {
    console.log(`\n  ${c.dim}Not counted: ${report.history.withGaps} run(s) with observation gaps, ${report.history.withoutCodes} run(s) recorded before per-code evidence.${c.reset}`);
  }
}
