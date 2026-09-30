/**
 * Spec-first change gate — does this change name the spec that governs it?
 *
 * Spec: specs/015-spec-first-gate (docguard.spec-first-gate).
 *
 * Validators evaluate a tree, so none of them can notice the spec that was
 * never written. This evaluates a change: the paths it touched since the merge
 * base, the commit messages in that range, and an optional description (a PR
 * body, passed as a file so an untrusted body never reaches a shell). A
 * governed change passes only with a reference that resolves to a real spec,
 * or a declared exemption with a reason. Every Git failure is inconclusive —
 * never a pass.
 *
 * @implements docguard.spec-first-gate#FR-001
 * @implements docguard.spec-first-gate#FR-002
 * @implements docguard.spec-first-gate#FR-003
 * @implements docguard.spec-first-gate#FR-004
 * @implements docguard.spec-first-gate#FR-005
 * @implements docguard.first-spec-preflight#FR-008
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDiffSnapshot } from '../shared-git.mjs';
import { globMatch } from '../shared-ignore.mjs';
import { parseSpecId, readSpecRegistry } from './spec-registry.mjs';

export const DEFAULT_EXEMPT_KINDS = ['release', 'deps', 'typo', 'test-only'];
const MIN_REASON = 10;
const SPEC_PATH_RE = /\bspecs\/([0-9]{3,}[a-z0-9._-]*)/gi;
const SPEC_ID_RE = /\b([a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+)\b/gi;
// `Spec: acme.x`, `**Spec ID**: \`acme.x\``: a word written as a reference.
// Only these are reported when unresolved; any dotted word (a file name, a
// version) has the Spec ID shape, so unlabelled ones would be noise.
const LABELLED_ID_RE = /\bSpec(?:[ \t]+ID)?\b[*_]*[ \t]*:[*_]*[ \t]*`?([a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+)`?/gi;
const EXEMPT_RE = /^\s*Spec-Exempt:\s*([A-Za-z-]+)\s*[—–-]+\s*(.*)$/gim;
const DEFAULT_TEST_RE = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[^/]+$|_test\.[^/]+$|(^|\/)test_[^/]*\.py$/;

function git(projectDir, args) {
  return execFileSync('git', args, {
    cwd: projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000, maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

/**
 * Read the change between the merge base of `since` and HEAD.
 * @returns {{ status: 'ok'|'inconclusive', reason: string|null, base: string|null, paths: string[], messages: string }}
 */
export function collectChange(projectDir, since) {
  const empty = { base: null, paths: [], messages: '' };
  if (!since) return { status: 'inconclusive', reason: 'A base revision is required (--since <ref>).', ...empty };
  let base;
  try {
    base = git(projectDir, ['merge-base', since, 'HEAD']);
  } catch {
    return { status: 'inconclusive', reason: `No merge base between ${since} and HEAD (unknown ref or shallow history).`, ...empty };
  }
  const snapshot = getDiffSnapshot(projectDir, base);
  // Only the path inventory matters here. getDiffSnapshot sets commitCount
  // after the inventory completes within budget, so a numeric count with a
  // failed status means the *patch* overflowed — the inventory is still whole.
  const inventoryComplete = snapshot.status === 'ok' || Number.isSafeInteger(snapshot.commitCount);
  if (!inventoryComplete) {
    return { status: 'inconclusive', reason: snapshot.reason || `Changed-path inventory ${snapshot.status}.`, ...empty, base };
  }
  const paths = [...new Set(snapshot.changedFiles.flatMap(f => [f.newPath, f.oldPath]).filter(Boolean))];
  let messages;
  try {
    messages = git(projectDir, ['log', '--format=%B%x00', `${base}..HEAD`]);
  } catch {
    return { status: 'inconclusive', reason: 'Commit messages in the range could not be read.', base, paths, messages: '' };
  }
  return { status: 'ok', reason: null, base, paths, messages };
}

/** Existing spec directories and the spec IDs they (or the registry) declare. */
export function specInventory(projectDir) {
  const dirs = new Set();
  const ids = new Map();
  const specsRoot = resolve(projectDir, 'specs');
  if (existsSync(specsRoot)) {
    for (const entry of readdirSync(specsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const specFile = resolve(specsRoot, entry.name, 'spec.md');
      if (!existsSync(specFile)) continue;
      dirs.add(entry.name);
      try {
        const id = parseSpecId(readFileSync(specFile, 'utf8'));
        if (id) ids.set(id.toLowerCase(), `specs/${entry.name}`);
      } catch { /* unreadable spec: its directory still counts */ }
    }
  }
  const registry = readSpecRegistry(projectDir);
  for (const spec of registry.value?.specs || []) {
    if (spec?.specId && !ids.has(spec.specId.toLowerCase())) ids.set(spec.specId.toLowerCase(), spec.path || spec.specId);
  }
  return { dirs, ids };
}

function isGoverned(path, config) {
  const patterns = config?.specFirst?.paths;
  if (Array.isArray(patterns) && patterns.length > 0) return globMatch(path, patterns);
  if (/\.md$/i.test(path) || path.startsWith('specs/')) return false;
  if (DEFAULT_TEST_RE.test(path)) return false;
  if (Array.isArray(config?.testPatterns) && globMatch(path, config.testPatterns)) return false;
  return true;
}

/**
 * Classify a change. Pure given its inputs.
 * @returns {{ status: 'covered'|'exempt'|'not-governed'|'uncovered', governed: string[],
 *   references: {kind: string, value: string, spec: string}[], unresolved: string[],
 *   exemption: {kind: string, reason: string}|null, invalidExemptions: {kind: string, reason: string, problem: string}[],
 *   allowedKinds: string[] }}
 */
export function classifySpecFirst({ paths, text, config, inventory }) {
  const allowedKinds = (Array.isArray(config?.specFirst?.exemptKinds) && config.specFirst.exemptKinds.length
    ? config.specFirst.exemptKinds : DEFAULT_EXEMPT_KINDS).map(k => String(k).toLowerCase());
  const governed = paths.filter(p => isGoverned(p, config)).sort();

  const references = [];
  const unresolved = [];
  const seen = new Set();
  const add = (kind, value, spec) => {
    const key = `${kind}:${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (spec) references.push({ kind, value, spec });
    else unresolved.push(value);
  };

  for (const p of paths) {
    const m = p.match(/^specs\/([^/]+)\//);
    if (m && inventory.dirs.has(m[1])) add('edited', `specs/${m[1]}`, `specs/${m[1]}`);
  }
  for (const m of text.matchAll(SPEC_PATH_RE)) {
    const dir = m[1].replace(/[.]+$/, '');
    add('path', `specs/${dir}`, inventory.dirs.has(dir) ? `specs/${dir}` : null);
  }
  for (const m of text.matchAll(SPEC_ID_RE)) {
    const spec = inventory.ids.get(m[1].toLowerCase());
    if (spec) add('id', m[1], spec);
  }
  for (const m of text.matchAll(LABELLED_ID_RE)) {
    if (!inventory.ids.has(m[1].toLowerCase())) add('id', m[1], null);
  }

  let exemption = null;
  const invalidExemptions = [];
  for (const m of text.matchAll(EXEMPT_RE)) {
    const kind = m[1].toLowerCase();
    const reason = m[2].trim();
    if (!allowedKinds.includes(kind)) invalidExemptions.push({ kind, reason, problem: 'unknown kind' });
    else if (reason.length < MIN_REASON) invalidExemptions.push({ kind, reason, problem: `reason shorter than ${MIN_REASON} characters` });
    else if (!exemption) exemption = { kind, reason };
  }

  let status;
  if (governed.length === 0) status = 'not-governed';
  else if (references.length > 0) status = 'covered';
  else if (exemption) status = 'exempt';
  else status = 'uncovered';
  return { status, governed, references, unresolved, exemption, invalidExemptions, allowedKinds };
}

/** Collect the change and classify it. */
export function checkSpecFirst(projectDir, config, { since, messageText = '' } = {}) {
  const change = collectChange(projectDir, since);
  if (change.status !== 'ok') {
    return { command: 'specs require', status: 'inconclusive', reason: change.reason, since, base: change.base,
      governed: [], references: [], unresolved: [], exemption: null, invalidExemptions: [], allowedKinds: [] };
  }
  const text = `${messageText}\n${change.messages}`;
  const result = classifySpecFirst({ paths: change.paths, text, config, inventory: specInventory(projectDir) });
  return { command: 'specs require', since, base: change.base, reason: null, changed: change.paths.length, ...result };
}
