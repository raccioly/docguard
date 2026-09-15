/**
 * File-only source adapters for evidence-scoped verification.
 * @implements docguard.evidence-scoped-verification#FR-002
 * @implements docguard.evidence-scoped-verification#FR-003
 * @implements docguard.evidence-scoped-verification#FR-004
 * @implements docguard.evidence-scoped-verification#FR-005
 */

import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { buildIgnoreFilter, compileGlob, DEFAULT_IGNORE_DIRS, relPosix } from '../shared-ignore.mjs';
import { countPythonLiteralEntries } from './python-literal.mjs';

const MAX_COLLECTION_FILES = 20_000;
const MAX_REPORT_FINDINGS = 10_000;
const OASDIFF_LEVELS = new Set(['ERR', 'WARN', 'INFO', 'NONE']);

const answer = (status, reasonCode, message, extra = {}) => ({ ...extra, status, reasonCode, message });

export function resolveJsonPointer(value, pointer) {
  if (pointer === '') return { found: true, value };
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return { found: false, reason: 'invalid-json-pointer' };
  let current = value;
  for (const raw of pointer.slice(1).split('/')) {
    if (/~(?:[^01]|$)/.test(raw)) return { found: false, reason: 'invalid-json-pointer-escape' };
    const token = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token)) return { found: false, reason: 'invalid-array-index' };
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) return { found: false, reason: 'unresolved-json-pointer' };
      current = current[index];
    } else if (current && typeof current === 'object' && Object.hasOwn(current, token)) {
      current = current[token];
    } else {
      return { found: false, reason: 'unresolved-json-pointer' };
    }
  }
  return { found: true, value: current };
}

function lexicalBase(pattern) {
  const parts = [];
  for (const part of pattern.split('/')) {
    if (/[*?{]/.test(part)) break;
    parts.push(part);
  }
  return parts.join('/') || '.';
}

/** Count regular, non-symlink files with a bounded walk and the shared ignore contract. */
export function countEvidenceCollection(projectDir, pattern, config = {}) {
  if (typeof pattern !== 'string' || pattern.startsWith('/') || /[\\:\0]/.test(pattern)
    || pattern.split('/').some(part => part === '..' || part.toLowerCase() === '.local' || /^\.env(?:\.|$)/i.test(part))) {
    return answer('inconclusive', 'unsafe-collection-base', 'Collection pattern is unsafe.');
  }
  let root;
  try { root = realpathSync(projectDir); } catch { return answer('inconclusive', 'repository-unavailable', 'Repository root is unavailable.'); }
  let matcher;
  try { matcher = compileGlob(pattern); } catch { return answer('unsupported', 'unsupported-glob', 'Collection glob cannot be compiled.'); }
  const ignored = buildIgnoreFilter(config.ignore || []);
  const lexical = lexicalBase(pattern);
  let base = root;
  try {
    for (const part of lexical.split('/').filter(item => item && item !== '.')) {
      base = resolve(base, part);
      if (lstatSync(base).isSymbolicLink()) return answer('inconclusive', 'symlink', 'Collection base traverses a symlink.');
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return answer('ok', 'collection-read', 'Collection evaluated.', { value: 0, inputHashes: [] });
    return answer('inconclusive', 'collection-unavailable', 'Collection base is unavailable.');
  }
  const relBase = relative(root, base);
  if (isAbsolute(relBase) || relBase === '..' || relBase.startsWith(`..${sep}`)) {
    return answer('inconclusive', 'unsafe-collection-base', 'Collection base leaves the repository.');
  }
  let baseStat;
  try { baseStat = lstatSync(base); } catch (error) {
    if (error?.code === 'ENOENT') return answer('ok', 'collection-read', 'Collection evaluated.', { value: 0, inputHashes: [] });
    return answer('inconclusive', 'collection-unavailable', 'Collection base is unavailable.');
  }
  if (baseStat.isSymbolicLink()) return answer('inconclusive', 'symlink', 'Collection base is a symlink.');
  let visited = 0;
  let matched = 0;
  const walk = path => {
    let entries;
    try { entries = readdirSync(path, { withFileTypes: true }); }
    catch { throw new Error('collection-unreadable'); }
    for (const entry of entries) {
      if (++visited > MAX_COLLECTION_FILES) throw new Error('collection-budget');
      if (DEFAULT_IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = resolve(path, entry.name);
      const rel = relPosix(root, full);
      if (ignored(rel)) continue;
      let stat;
      try { stat = lstatSync(full); } catch { throw new Error('collection-unreadable'); }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile() && matcher.test(rel)) matched++;
    }
  };
  try {
    if (baseStat.isFile()) matched = matcher.test(relPosix(root, base)) ? 1 : 0;
    else if (baseStat.isDirectory()) walk(base);
    else return answer('inconclusive', 'collection-not-file-or-directory', 'Collection base is not a regular file or directory.');
  } catch (error) {
    return answer('inconclusive', error.message, error.message === 'collection-budget'
      ? `Collection exceeded the ${MAX_COLLECTION_FILES}-entry budget.`
      : 'Collection could not be read completely.');
  }
  return answer('ok', 'collection-read', 'Collection evaluated.', { value: matched, inputHashes: [] });
}

function currentInputs(source, read) {
  const hashes = [];
  for (const input of source.inputs) {
    const snapshot = read(input.path);
    if (snapshot.content === null) {
      return answer('inconclusive', `input-${snapshot.evidence.reason}`, `Cannot safely read declared input ${input.path}.`, { inputHashes: hashes });
    }
    hashes.push({ path: input.path, declared: input.sha256, current: snapshot.evidence.hash });
  }
  const stale = hashes.filter(input => input.declared !== input.current);
  if (stale.length) return answer('stale', 'input-digest-mismatch', `${stale.length} declared input digest(s) no longer match.`, { inputHashes: hashes });
  return answer('ok', 'inputs-current', 'Declared report inputs are current.', { inputHashes: hashes });
}

function readReport(source, read) {
  if (source.adapterVersion !== 1) return answer('unsupported', 'adapter-version', `Adapter version ${source.adapterVersion} is unsupported.`);
  const inputs = currentInputs(source, read);
  if (inputs.status !== 'ok') return inputs;
  const snapshot = read(source.path);
  if (snapshot.content === null) {
    return answer('inconclusive', `report-${snapshot.evidence.reason}`, `Cannot safely read saved ${source.adapter} report ${source.path}.`, { inputHashes: inputs.inputHashes });
  }
  return answer('ok', 'report-read', 'Saved report is current and readable.', {
    content: snapshot.content,
    sourceEvidence: snapshot.evidence,
    inputHashes: inputs.inputHashes,
  });
}

function oasdiffReport(source, read) {
  if (!['breaking', 'changelog'].includes(source.command)) return answer('unsupported', 'oasdiff-command', `oasdiff command ${source.command} is unsupported.`);
  const report = readReport(source, read);
  if (report.status !== 'ok') return report;
  let parsed;
  try { parsed = JSON.parse(report.content); }
  catch { return answer('inconclusive', 'malformed-oasdiff-json', 'Saved oasdiff report is not valid JSON.', report); }
  if (!Array.isArray(parsed) || parsed.length > MAX_REPORT_FINDINGS) {
    return answer('unsupported', 'unsupported-oasdiff-shape', 'Saved oasdiff report must be a bounded JSON array.', report);
  }
  const valid = parsed.every(change => change && typeof change === 'object' && !Array.isArray(change)
    && typeof change.id === 'string' && change.id.length > 0
    && (typeof change.level === 'number' || OASDIFF_LEVELS.has(change.level)));
  if (!valid) return answer('unsupported', 'unsupported-oasdiff-change', 'Saved oasdiff report contains an unknown change shape.', report);
  return answer('ok', 'oasdiff-report', 'Saved oasdiff report evaluated.', { ...report, value: parsed.length });
}

function bufReport(source, read) {
  if (source.command !== 'breaking') return answer('unsupported', 'buf-command', `Buf command ${source.command} is unsupported.`);
  const report = readReport(source, read);
  if (report.status !== 'ok') return report;
  const lines = report.content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length > MAX_REPORT_FINDINGS) return answer('unsupported', 'buf-finding-budget', `Saved Buf report exceeds ${MAX_REPORT_FINDINGS} findings.`, report);
  for (const line of lines) {
    let finding;
    try { finding = JSON.parse(line); }
    catch { return answer('inconclusive', 'malformed-buf-jsonl', 'Saved Buf report contains malformed JSON Lines.', report); }
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)
      || typeof finding.path !== 'string' || !finding.path
      || typeof finding.type !== 'string' || !finding.type
      || typeof finding.message !== 'string' || !finding.message) {
      return answer('unsupported', 'unsupported-buf-finding', 'Saved Buf report contains an unknown violation shape.', report);
    }
  }
  return answer('ok', 'buf-report', 'Saved Buf report evaluated.', { ...report, value: lines.length });
}

export function readEvidenceSource(projectDir, declaration, read, config = {}) {
  const source = declaration.source;
  if (source.adapter === 'json-pointer') {
    const snapshot = read(source.path);
    if (snapshot.content === null) return answer('inconclusive', `source-${snapshot.evidence.reason}`, `Cannot safely read JSON source ${source.path}.`);
    let parsed;
    try { parsed = JSON.parse(snapshot.content); }
    catch { return answer('inconclusive', 'malformed-source-json', `JSON source ${source.path} is malformed.`, { sourceEvidence: snapshot.evidence, inputHashes: [] }); }
    const selected = resolveJsonPointer(parsed, source.pointer);
    if (!selected.found) return answer('inconclusive', selected.reason, `JSON Pointer ${source.pointer || '<root>'} did not resolve.`, { sourceEvidence: snapshot.evidence, inputHashes: [] });
    return answer('ok', 'json-pointer-resolved', 'JSON Pointer resolved.', { value: selected.value, sourceEvidence: snapshot.evidence, inputHashes: [] });
  }
  if (source.adapter === 'collection-count') {
    const result = countEvidenceCollection(projectDir, source.glob, config);
    if (result.status === 'ok' && result.value === 0 && !source.allowEmpty) {
      return answer('inconclusive', 'empty-collection-not-allowed', 'Collection matched no files and allowEmpty is false.', result);
    }
    return result;
  }
  if (source.adapter === 'python-literal-count') {
    const snapshot = read(source.path);
    if (snapshot.content === null) {
      return answer('inconclusive', `source-${snapshot.evidence.reason}`, `Cannot safely read Python source ${source.path}.`);
    }
    const parsed = countPythonLiteralEntries(snapshot.content, source.symbol);
    const extra = { sourceEvidence: snapshot.evidence, inputHashes: [] };
    if (Object.hasOwn(parsed, 'value')) extra.value = parsed.value;
    if (parsed.status === 'ok' && parsed.value === 0 && !source.allowEmpty) {
      return answer('inconclusive', 'empty-python-literal-not-allowed', 'Python literal has no entries and allowEmpty is false.', extra);
    }
    return answer(parsed.status, parsed.reasonCode, parsed.message, extra);
  }
  if (source.adapter === 'oasdiff') return oasdiffReport(source, read);
  if (source.adapter === 'buf') return bufReport(source, read);
  return answer('unsupported', 'unsupported-adapter', `Adapter ${source.adapter} is unsupported.`);
}
