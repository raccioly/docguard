#!/usr/bin/env node
/**
 * Seeded fuzzing of DocGuard's document parsers (specs/088-validator-fuzz).
 *
 *   node tools/fuzz.mjs [--cases 2000] [--seed 1] [--target <name>] [--save]
 *
 * Every parser that reads text a user or an agent wrote must, for any input:
 * return without throwing, return the same answer twice, and finish within a
 * time bound that scales with the input (a regex that backtracks
 * catastrophically on a crafted line is a denial of service in CI). The suite
 * runs a fixed seed and budget; a deep run here uses a random seed, and
 * `--save` writes each failing input, shrunk, to tests/fixtures/fuzz/ so the
 * suite replays it forever after.
 *
 * Zero dependencies: a 32-bit seeded generator and a fragment grammar of
 * Markdown, Spec Kit and AI-DLC shapes, with mutations.
 *
 * @implements docguard.validator-fuzz#FR-001
 * @implements docguard.validator-fuzz#FR-002
 * @implements docguard.validator-fuzz#FR-004
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { citedIds, definedIds, chainCoverage, storyNumbers } from '../cli/scanners/chain-coverage.mjs';
import { normalizeStatus, parseAdrFile } from '../cli/validators/decision-records.mjs';
import { backtickRefs, parseStageProgress } from '../cli/scanners/aidlc.mjs';
import { splitWaiverMetadata } from '../cli/waiver-metadata.mjs';
import { extractHeadingLines, extractHeadings } from '../cli/shared-headings.mjs';
import { inspectSections } from '../cli/writers/sections.mjs';
import { parseCovers, coveredSections } from '../cli/scanners/doc-deps.mjs';
import { parseLifecycleStatus } from '../cli/scanners/lifecycle-status.mjs';
import { parseApiReferenceDoc } from '../cli/scanners/api-doc.mjs';
import { stripHtmlComments, visibleMarkdown } from '../cli/shared-html-comments.mjs';
import { parseDocguardIgnore } from '../cli/shared-ignore.mjs';

/** mulberry32: a small, fast, well-distributed 32-bit generator. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = n => Math.floor(next() * n);
  return { next, int, pick: xs => xs[int(xs.length)], chance: p => next() < p };
}

const ID = r => `${r.pick(['FR', 'SC', 'NFR', 'US', 'ADR'])}-${String(r.int(1200)).padStart(r.pick([3, 3, 3, 2, 4]), '0')}${r.chance(0.1) ? r.pick(['a', 'b', '.1', '.2.3']) : ''}`;
const WORD = r => r.pick(['the', 'spec', 'plan.md', 'tasks.md', '`src/app.js`', 'Status', 'Superseded', 'owner:', 'expires:', '2026-13-40', 'GET', '/users/:id', '→', 'é', '🙂', '​', '‮', '**', '__', '`', '<!--', '-->', '|', '\\', '[x]', '[ ]', 'docguard:section', 'covers=', '#', '>']);
const LINE = r => {
  const words = () => Array.from({ length: r.int(8) }, () => WORD(r)).join(' ');
  return r.pick([
    () => `${'#'.repeat(1 + r.int(6))} ${words()}`,
    () => `- **${ID(r)}**: ${words()}`,
    () => `- **${ID(r)}** ${r.pick(['(amendment)', '*(x)*', '—', ''])}: ${words()}`,
    () => `| ${ID(r)} | ${words()} | ${words()} |`,
    () => `|---|---|${r.chance(0.5) ? '---|' : ''}`,
    () => `- [${r.pick([' ', 'x', 'X'])}] T${String(r.int(999)).padStart(3, '0')} ${r.chance(0.5) ? `[US${r.int(9)}]` : ''} ${words()} (${ID(r)}${r.chance(0.5) ? `, ${ID(r)} to ${ID(r)}` : ''})`,
    () => `### User Story ${r.int(12)} - ${words()} (Priority: P${r.int(4)})`,
    () => r.pick(['```', '```js', '~~~', '````']),
    () => r.pick(['<!--', '-->', '<!-- docguard:section id=x covers=src/a.js -->', '<!-- /docguard:section -->', '<!-- docguard:ignore -->']),
    () => `**Status**: ${r.pick(['Accepted', 'Superseded by ADR-002', 'Draft', 'Retired', '', 'Proposed'])}`,
    () => `- [${r.pick(['x', ' '])}] ${r.pick(['requirements-analysis', 'code-generation', 'build-and-test'])} — ${words()}`,
    () => `[Answer]: ${r.chance(0.5) ? '' : words()}`,
    () => `| ${r.pick(['GET', 'POST', 'DELETE'])} | /${words().replace(/\s+/g, '/')} | ${words()} |`,
    () => words(),
    () => '',
  ])();
};

/**
 * Structured blocks the parsers look for, so each one is reached: an ADR
 * section, AI-DLC stage progress, a covered doc section, a spec requirement
 * list. Mutations then break them in every way a person or an agent might.
 */
const BLOCKS = [
  r => [`## ADR-${String(r.int(40)).padStart(3, '0')}: ${WORD(r)}`, `**Status**: ${r.pick(['Accepted', 'Superseded by ADR-002', 'Deprecated', 'Proposed', 'Partially superseded'])}`, r.pick([`Supersedes ADR-${r.int(40)}`, `- Superseded by: ADR-${r.int(40)}`, '']), `| ADR-${r.int(40)} | ${r.pick(['Accepted', 'Superseded'])} |`],
  r => ['## Stage Progress', ...Array.from({ length: 1 + r.int(6) }, () => `- [${r.pick([' ', 'x', '-', '?', 'R', 'S'])}] ${r.pick(['requirements-analysis', 'code-generation', 'build-and-test', 'units-generation'])} — ${WORD(r)}`)],
  r => [`<!-- docguard:section id=${r.pick(['api', 'model', 'x-1'])} covers=${r.pick(['src/a.js', 'src/a.js,src/b.py#Cls.m', ' , ,', 'src/*.ts'])} -->`, LINE(r), '<!-- /docguard:section -->'],
  r => ['## Requirements', ...Array.from({ length: 1 + r.int(8) }, () => `- **${ID(r)}**: ${WORD(r)}`), '## Success Criteria', `- **SC-${String(r.int(9)).padStart(3, '0')}**: ${WORD(r)}`],
];

/** One generated document: grammar lines and blocks, then mutations. */
export function generate(r) {
  let lines = Array.from({ length: 1 + r.int(60) }, () => LINE(r));
  for (let b = r.int(3); b > 0; b--) lines.splice(r.int(lines.length + 1), 0, ...r.pick(BLOCKS)(r));
  const mutations = r.int(4);
  for (let m = 0; m < mutations; m++) {
    const i = r.int(lines.length);
    switch (r.int(6)) {
      case 0: lines.splice(i, 0, lines[r.int(lines.length)]); break; // duplicate
      case 1: lines.splice(i, 1); break; // delete
      case 2: lines[i] = (lines[i] || '').slice(0, r.int((lines[i] || '').length + 1)); break; // truncate
      case 3: lines[i] = (lines[i] || '').repeat(1 + r.int(50)); break; // long line
      case 4: lines = lines.reverse(); break;
      default: lines[i] = `${'  '.repeat(r.int(8))}${lines[i] || ''}`; // indentation
    }
  }
  const eol = r.pick(['\n', '\n', '\n', '\r\n', '\r']);
  return `${r.chance(0.05) ? '﻿' : ''}${lines.join(eol)}${r.chance(0.5) ? eol : ''}`;
}

/**
 * Inputs built to make a backtracking regex go exponential or quadratic:
 * long runs of the characters the parsers' patterns branch on.
 */
export function pathological() {
  const n = 20000;
  return {
    'long bold id run': `- **FR-${'0'.repeat(n)}`,
    'unterminated bold': `**${'a '.repeat(n)}`,
    'many open fences': '```\n'.repeat(n / 10),
    'unterminated comment': `<!--${' x'.repeat(n)}`,
    'nested emphasis': '*_'.repeat(n / 2),
    'whitespace run': `${' '.repeat(n)}x`,
    'table pipes': `|${' |'.repeat(n)}`,
    'status colons': `Status${':'.repeat(n)}`,
    'id ranges': Array.from({ length: n / 10 }, (_, i) => `FR-${String(i % 999).padStart(3, '0')} to`).join(' '),
    'backticks': '`'.repeat(n),
    'heading hashes': `${'#'.repeat(n)} x`,
    'dashes': `- ${'-'.repeat(n)}`,
    'owner tokens': `reason ${'owner: '.repeat(n / 10)}`,
    // Quadratic behavior hides at 20 KB: these are about 200 KB each.
    'many comments on one line': Array.from({ length: 2500 }, (_, i) => `<!-- docguard:section id=s${i} covers=src/a.js -->x<!-- /docguard:section -->`).join(''),
    'many section blocks': Array.from({ length: 2500 }, (_, i) => `<!-- docguard:section id=s${i} covers=src/a.js -->\nx\n<!-- /docguard:section -->`).join('\n'),
    'many requirement lines': Array.from({ length: 8000 }, (_, i) => `- **FR-${String(i % 999).padStart(3, '0')}**: x (FR-${String((i + 1) % 999).padStart(3, '0')} to FR-${String((i + 9) % 999).padStart(3, '0')})`).join('\n'),
    'many ADRs': Array.from({ length: 4000 }, (_, i) => `## ADR-${i}: x\n**Status**: Superseded by ADR-${i + 1}\n| ADR-${i} | Superseded |`).join('\n'),
    'many headings': Array.from({ length: 10000 }, (_, i) => `## Heading ${i} \`code\` [link](#x)`).join('\n'),
  };
}

const ARRAY = v => Array.isArray(v) || v instanceof Map || v instanceof Set;
const plain = v => JSON.stringify(v, (_, x) => (x instanceof Map ? [...x] : x instanceof Set ? [...x] : x));

/** Every target: a name, the call, and any extra property it must hold. */
export const TARGETS = [
  { name: 'definedIds', run: t => definedIds(t), check: ARRAY },
  { name: 'citedIds', run: t => citedIds(t), check: ARRAY },
  { name: 'storyNumbers', run: t => storyNumbers(t), check: ARRAY },
  { name: 'chainCoverage', run: t => chainCoverage({ spec: t, plan: t.slice(0, t.length >> 1), tasks: t }) },
  { name: 'parseAdrFile', run: t => parseAdrFile(t, 'docs/adr.md') },
  { name: 'normalizeStatus', run: t => normalizeStatus(t.split(/\r?\n/)[0]) },
  { name: 'parseStageProgress', run: t => parseStageProgress(t) },
  { name: 'backtickRefs', run: t => backtickRefs(t), check: ARRAY },
  { name: 'splitWaiverMetadata', run: t => splitWaiverMetadata(t) },
  { name: 'extractHeadings', run: t => extractHeadings(t) },
  { name: 'extractHeadingLines', run: t => extractHeadingLines(t), check: ARRAY },
  { name: 'inspectSections', run: t => inspectSections(t) },
  { name: 'coveredSections', run: t => coveredSections(t), check: ARRAY },
  { name: 'parseCovers', run: t => parseCovers(t), check: ARRAY },
  { name: 'parseLifecycleStatus', run: t => parseLifecycleStatus(t) },
  { name: 'parseApiReferenceDoc', run: t => parseApiReferenceDoc(t), check: ARRAY },
  { name: 'stripHtmlComments', run: t => stripHtmlComments(t), check: v => typeof v?.text === 'string' },
  { name: 'visibleMarkdown', run: t => visibleMarkdown(t), check: v => typeof v === 'string' },
  { name: 'parseDocguardIgnore', run: t => parseDocguardIgnore(t, { today: '2026-11-03' }) },
];

/** Time allowed for one call: generous, but linear in the input. */
export const budgetMs = text => 250 + text.length / 100;

/** Check one input against one target; returns null or the failure. */
export function check(target, text) {
  let first;
  const start = performance.now();
  try { first = target.run(text); } catch (err) { return { kind: 'throws', detail: String(err?.stack || err).split('\n').slice(0, 3).join(' | ') }; }
  const ms = performance.now() - start;
  if (ms > budgetMs(text)) return { kind: 'slow', detail: `${Math.round(ms)} ms for ${text.length} chars (budget ${Math.round(budgetMs(text))} ms)` };
  if (target.check && !target.check(first)) return { kind: 'shape', detail: `unexpected result ${plain(first)?.slice(0, 200)}` };
  let second;
  try { second = target.run(text); } catch (err) { return { kind: 'throws-second', detail: String(err) }; }
  if (plain(first) !== plain(second)) return { kind: 'nondeterministic', detail: 'two calls on the same input disagree' };
  return null;
}

/** Shrink a failing input line by line while it still fails the same way. */
export function shrink(target, text, kind) {
  let lines = text.split('\n');
  for (let size = Math.max(1, lines.length >> 1); size >= 1; size >>= 1) {
    for (let i = 0; i + size <= lines.length;) {
      const candidate = [...lines.slice(0, i), ...lines.slice(i + size)];
      if (candidate.length && check(target, candidate.join('\n'))?.kind === kind) lines = candidate; else i += size;
    }
  }
  return lines.join('\n');
}

/** Run `cases` generated inputs plus the pathological set; returns failures. */
export function fuzz({ seed = 1, cases = 200, only = null } = {}) {
  const failures = [];
  const targets = TARGETS.filter(t => !only || t.name === only);
  for (const target of targets) {
    const r = rng(seed ^ createHash('sha256').update(target.name).digest().readUInt32LE(0));
    for (let i = 0; i < cases; i++) {
      const text = generate(r);
      const failure = check(target, text);
      if (failure) { failures.push({ target: target.name, seed, index: i, ...failure, input: text }); break; }
    }
    for (const [label, text] of Object.entries(pathological())) {
      const failure = check(target, text);
      if (failure) failures.push({ target: target.name, seed, index: label, ...failure, input: text });
    }
  }
  return failures;
}

function flag(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const seed = Number(flag(args, '--seed', String(Date.now() % 2 ** 31)));
  const cases = Number(flag(args, '--cases', '2000'));
  const failures = fuzz({ seed, cases, only: flag(args, '--target', null) });
  for (const f of failures) {
    const target = TARGETS.find(t => t.name === f.target);
    const small = typeof f.index === 'number' ? shrink(target, f.input, f.kind) : f.input;
    console.log(`✖ ${f.target} ${f.kind} (seed ${f.seed}, case ${f.index}): ${f.detail}`);
    if (args.includes('--save')) {
      const dir = resolve('tests/fixtures/fuzz');
      mkdirSync(dir, { recursive: true });
      const name = `${f.target}-${createHash('sha256').update(small).digest('hex').slice(0, 12)}.txt`;
      writeFileSync(resolve(dir, name), small);
      console.log(`  saved tests/fixtures/fuzz/${name}`);
    }
  }
  console.log(`${failures.length ? '✖' : '✔'} ${TARGETS.length} parsers, seed ${seed}, ${cases} cases each plus ${Object.keys(pathological()).length} pathological inputs: ${failures.length} failure(s)`);
  process.exitCode = failures.length ? 1 : 0;
}
