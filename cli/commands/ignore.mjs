/**
 * `docguard ignore` — every suppression in the project, with its reason,
 * expiry, state and source (specs/057-ignore-reasons).
 *
 *   docguard ignore                      the model, for a reviewer
 *   docguard ignore --format json        the model plus the export report
 *   docguard ignore --format claimspec   a claimspec v1 `ignore` document on
 *                                        stdout; what it leaves out on stderr
 *
 * Read-only: it writes nothing in any mode.
 *
 * @implements docguard.ignore-reasons#FR-007
 * @implements docguard.ignore-reasons#FR-008
 */

import { c } from '../shared.mjs';
import { collectSuppressions } from '../scanners/suppressions.mjs';
import { toClaimspecIgnore } from '../writers/claimspec-ignore.mjs';
import { assertValidClaimspec } from '../claimspec-schema.mjs';
import { DISPLAY_NAMES } from './explain.mjs';

const INLINE_SHOWN = 20;

function printExportReport(report, log) {
  log(`claimspec ignore: exported ${report.exported} of ${report.candidates} .docguardignore entr${report.candidates === 1 ? 'y' : 'ies'}.`);
  for (const o of report.omitted) log(`  omitted ${o.at}  ${o.pattern} — ${o.why}`);
  for (const r of report.rewritten) log(`  written ${r.at}  ${r.from} as ${r.to} — the same scope in gitignore syntax`);
  for (const n of report.notRepresentable) log(`  not representable: ${n.label} — ${n.why}`);
  if (report.complete) {
    log('This document is the complete suppression policy.');
  } else {
    const left = report.omitted.length + report.notRepresentable.reduce((sum, n) => sum + n.count, 0);
    log(`This document is not the complete suppression policy: ${left} suppression${left === 1 ? ' is' : 's are'} not in it. \`docguard ignore\` lists them all.`);
  }
}

const label = e => e.pattern ?? (e.codes ? e.codes.join(',') : e.key) ?? '(any code)';

function stateText(e) {
  if (e.state === 'expired') return `${c.yellow}expired ${e.expires}${c.reset}`;
  if (e.state === 'invalid') return `${c.red}does not apply (${e.problem || 'invalid'})${c.reset}`;
  if (e.state === 'disabled') return `${c.dim}disabled${c.reset}`;
  return e.expires ? `until ${e.expires}` : 'active';
}

const reasonText = e => e.reason ? e.reason : `${c.dim}no reason${c.reset}`;

function printModel(model, report, projectName) {
  const { entries } = model;
  console.log(`${c.bold}Suppressions${projectName ? ` — ${projectName}` : ''}${c.reset} ${c.dim}(as of ${model.asOf} UTC)${c.reset}\n`);
  if (entries.length === 0) {
    console.log('  Nothing is suppressed.\n');
    return;
  }
  const group = (title, rows, render) => {
    if (!rows.length) return;
    console.log(`${c.bold}${title}${c.reset} ${c.dim}(${rows.length})${c.reset}`);
    rows.forEach(render);
    console.log('');
  };
  group('.docguardignore', entries.filter(e => e.kind === 'path' && e.source.file === '.docguardignore'),
    e => console.log(`  ${String(e.source.line).padStart(3)}  ${label(e)}  ${stateText(e)}  ${reasonText(e)}`));
  group('.docguard.json', entries.filter(e => e.kind === 'path' && e.source.file === '.docguard.json'),
    e => console.log(`  ${label(e)}  ${c.dim}(${e.source.key}, ${e.scope})${c.reset}  ${reasonText(e)}`));
  const inline = entries.filter(e => e.kind === 'code');
  group('Inline docguard:ignore pragmas', inline.slice(0, INLINE_SHOWN),
    e => console.log(`  ${e.source.file}:${e.source.line}  ${label(e)}  ${reasonText(e)}`));
  if (inline.length > INLINE_SHOWN) console.log(`  ${c.dim}… and ${inline.length - INLINE_SHOWN} more (--format json lists every one)${c.reset}\n`);
  group('Validator N/A markers', entries.filter(e => e.kind === 'validator'),
    e => console.log(`  ${e.source.file}:${e.source.line}  ${e.key}  ${stateText(e)}  ${reasonText(e)}`));
  group('Section N/A markers', entries.filter(e => e.kind === 'section'),
    e => console.log(`  ${e.source.file}:${e.source.line}  ${e.key}  ${stateText(e)}  ${reasonText(e)}`));
  const baseline = entries.filter(e => e.kind === 'fingerprint');
  if (baseline.length) {
    console.log(`${c.bold}Baseline${c.reset} ${c.dim}(.docguard.baseline.json)${c.reset}`);
    console.log(`  ${baseline.length} frozen finding fingerprint${baseline.length === 1 ? '' : 's'}${baseline[0].state === 'disabled' ? ' (disabled by "baseline": false)' : ''}\n`);
  }
  if (model.coverage.inlineScan !== 'complete') {
    console.log(`${c.yellow}Partial: ${model.coverage.unreadable} file(s) could not be read while looking for inline pragmas.${c.reset}\n`);
  }
  console.log(`${c.dim}claimspec export: ${report.exported} of ${report.candidates} .docguardignore entries are exportable — docguard ignore --format claimspec${c.reset}`);
}

export function runIgnore(projectDir, config, flags = {}) {
  const model = collectSuppressions(projectDir, config, { validatorKeys: Object.keys(DISPLAY_NAMES) });
  const { document, report } = toClaimspecIgnore(model);

  if (flags.format === 'claimspec') {
    try {
      assertValidClaimspec('ignore', document);
    } catch (error) {
      console.error(`${c.red}${error.message}${c.reset}`);
      process.exitCode = 1;
      return null;
    }
    process.stdout.write(JSON.stringify(document, null, 2) + '\n');
    printExportReport(report, line => console.error(line));
    return { document, report };
  }

  if (flags.format === 'json') {
    const data = { asOf: model.asOf, entries: model.entries, coverage: model.coverage, export: report };
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return data;
  }

  printModel(model, report, config?.projectName);
  return { model, report };
}
