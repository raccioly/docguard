/**
 * Requirement anchors: every code→requirement link in a project, resolved to
 * the narrowest piece of code it names.
 *
 * Spec: specs/070-requirement-anchors (docguard.requirement-anchors).
 * Data model: specs/070-requirement-anchors/data-model.md.
 *
 * A link is a (requirement, anchor) pair. The requirement is resolved exactly
 * as requirement evidence resolves it: a Spec ID or document path before the
 * `#`, or a bare ID that names one declared requirement. The anchor comes
 * from anchor-tags.mjs: the file, a qualified symbol, a statement, or a route,
 * with the tier that resolved it. Each link carries three fingerprints: the
 * exact code fingerprint, the pattern-tier floor, and the requirement block's
 * fingerprint (FR-011, FR-014).
 *
 * Cost (FR-041): only files whose text mentions `@implements` or `@req` are
 * read past a substring check, each is parsed at most once, every Python file
 * goes through one batched `python3` run, and a per-file cache keyed by the
 * file's bytes answers for unchanged files.
 *
 * @implements docguard.requirement-anchors#FR-006
 * @implements docguard.requirement-anchors#FR-011
 * @implements docguard.requirement-anchors#FR-014
 * @implements docguard.requirement-anchors#FR-016
 * @implements docguard.requirement-anchors#FR-026
 * @implements docguard.requirement-anchors#FR-041
 */

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildIgnoreFilter, relPosix, walkFiles } from '../shared-ignore.mjs';
import { listTrackedFiles } from '../shared-git.mjs';
import { requirementPatterns } from '../shared-requirements.mjs';
import { openAnchorCache, contentSha } from './anchor-cache.mjs';
import { FILE_TIER, pythonCandidateLines, resolveFileAnchors } from './anchor-tags.mjs';
import { BABEL_TIER, V1_PREFIX, dg1 } from './fingerprint.mjs';
import { PATTERN_ALGO, languageOf } from './pattern-lexer.mjs';
import { pythonBatch, pythonTier } from './py-anchors.mjs';
import { isTestSource } from './requirement-evidence.mjs';
import { collectRequirementIds } from './requirement-docs.mjs';

export const ANCHOR_LOCK_PATH = '.docguard-anchor-lock.jsonl';
export const ANCHOR_ALGO = 1;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TAG_HINT = /@(?:implements|req)\b/;
const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|kts|rb|php|sh|cs|swift|c|h|cc|cpp|cxx|hh|hpp|hxx|ya?ml)$/i;

/** Percent-encode the two characters that would break a `|`-joined key. */
export const encodeKeyPart = part => String(part).replaceAll('%', '%25').replaceAll('|', '%7C');

export function linkKey({ requirement, file, anchor, scope }) {
  return [requirement, file, anchor, scope].map(encodeKeyPart).join('|');
}

/** Normalized requirement block → `dg1:` fingerprint (contracts/fingerprint.md). */
export function requirementFingerprint(block) {
  const normalized = String(block || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
  return dg1(normalized);
}

/** True when the project opted in: a committed lock, or `anchors.enabled`. */
export function anchorsActivated(projectDir, config = {}) {
  return existsSync(resolve(projectDir, ANCHOR_LOCK_PATH)) || config.anchors?.enabled === true;
}

function candidateFiles(projectDir, config) {
  const ignored = buildIgnoreFilter(config.ignore || []);
  let files = listTrackedFiles(projectDir);
  if (files) files = [...files];
  else {
    files = [];
    walkFiles(projectDir, abs => { files.push(relPosix(projectDir, abs)); });
  }
  return files
    .filter(rel => SOURCE_EXT.test(rel) && !isTestSource(rel) && !ignored(rel))
    .sort();
}

function readSource(projectDir, rel) {
  const abs = resolve(projectDir, rel);
  try {
    const stat = lstatSync(abs);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return readFileSync(abs);
  } catch { return null; }
}

/**
 * Resolve a tag's requirement the way requirement evidence does.
 * @returns {{ identity: string, specId: string|null, definition: object } | { error: string }}
 */
function resolveRequirement(tag, index) {
  const { byQualified, byId } = index;
  if (tag.qualifier) {
    const key = `${tag.qualifier}#${tag.id}`;
    const hit = byQualified.get(key);
    if (hit) return hit;
    return { error: `cites ${key}, which no spec or requirement document declares` };
  }
  const candidates = byId.get(tag.id) || [];
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return { error: `cites ${tag.id}, which no spec or requirement document declares` };
  return { error: `cites the bare ID ${tag.id}, which ${candidates.length} documents declare; qualify it with the Spec ID (${candidates.slice(0, 3).map(c => c.identity).join(', ')})` };
}

function requirementIndex(projectDir, config, patterns) {
  const definitions = collectRequirementIds(projectDir, config, patterns);
  const byQualified = new Map();
  const byId = new Map();
  for (const [key, def] of definitions) {
    const identity = def.specId ? `${def.specId}#${def.id}` : key;
    const entry = { identity, specId: def.specId || null, definition: def, fingerprint: requirementFingerprint(def.block ?? def.text) };
    byQualified.set(key, entry);
    if (def.specId) byQualified.set(`${def.specId}#${def.id}`, entry);
    if (!byId.has(def.id)) byId.set(def.id, []);
    byId.get(def.id).push(entry);
  }
  return { byQualified, byId };
}

/**
 * Every link in the project.
 * @param {string} projectDir
 * @param {object} [config]
 * @param {{ noCache?: boolean, env?: object }} [options]
 */
export function computeLinks(projectDir, config = {}, options = {}) {
  const patterns = requirementPatterns(config);
  const pyTier = pythonTier();
  const identity = `anchors-v${ANCHOR_ALGO}|${V1_PREFIX}|pattern@${PATTERN_ALGO}|${BABEL_TIER}|${pyTier || 'no-python'}`;
  const cache = openAnchorCache(projectDir, { identity, noCache: options.noCache, env: options.env });
  const index = requirementIndex(projectDir, config, patterns);

  // 1. Read candidate files, keep the ones that mention a tag.
  const sources = [];
  for (const rel of candidateFiles(projectDir, config)) {
    const bytes = readSource(projectDir, rel);
    if (!bytes) continue;
    const content = bytes.toString('utf8');
    if (!TAG_HINT.test(content)) continue;
    sources.push({ rel, content, sha: contentSha(bytes) });
  }

  // 2. Cache hits answer directly; Python misses go through ONE interpreter run.
  const resolved = new Map();
  const pyMisses = [];
  for (const source of sources) {
    const hit = cache.get(source.rel, source.sha);
    if (hit) { resolved.set(source.rel, hit); continue; }
    if (languageOf(source.rel) === 'python') pyMisses.push(source);
  }
  let python = { ok: true, files: {} };
  if (pyMisses.length && pyTier) {
    python = pythonBatch(pyMisses.map(s => ({ key: s.rel, content: s.content, outline: true, lines: pythonCandidateLines(s.content) })));
  }
  const pythonReason = !pyTier ? 'python3 is unavailable' : (python.ok ? null : python.reason);
  for (const source of sources) {
    if (resolved.has(source.rel)) continue;
    const result = resolveFileAnchors(source.content, source.rel, patterns, {
      python: python.ok ? python.files?.[source.rel] || null : null,
      pythonTier: python.ok ? pyTier : null,
      pythonReason,
    });
    resolved.set(source.rel, result);
    if (!result.degraded) cache.set(source.rel, source.sha, result);
  }
  cache.save();

  // 3. Links, requirement resolution, statement identities, problems.
  const links = [];
  const problems = [];
  const files = [];
  const seen = new Set();
  for (const source of sources) {
    const result = resolved.get(source.rel);
    files.push({ path: source.rel, tier: result.tier, confidence: result.confidence, degraded: result.degraded || null, error: result.error || null });
    const ordinals = new Map();
    const symbolStarts = new Map();
    for (const a of result.anchors) {
      const tag = a.tag;
      for (const problem of a.problems || []) {
        problems.push({ code: 'ANC006', file: source.rel, line: tag.line, tier: a.tier, confidence: a.confidence, message: `@${tag.verb} ${tag.qualifier ? `${tag.qualifier}#` : ''}${tag.id} ${problem}` });
      }
      const req = resolveRequirement(tag, index);
      if (req.error) {
        problems.push({ code: 'ANC007', file: source.rel, line: tag.line, tier: a.tier, confidence: a.confidence, message: `@${tag.verb} at ${source.rel}:${tag.line} ${req.error}` });
        continue;
      }
      let anchor = a.anchor;
      if (a.scope === 'statement' || (a.scope === 'route' && !anchor)) {
        const ordinalKey = `${a.owner}\u0000${req.identity}`;
        const n = (ordinals.get(ordinalKey) || 0) + 1;
        ordinals.set(ordinalKey, n);
        anchor = `${a.owner}>stmt:${req.identity}#${n}`;
      } else if (a.scope === 'symbol') {
        // Two declarations with one qualified name (overloads, redeclared helpers): number them in source order.
        const starts = symbolStarts.get(anchor) || [];
        if (!starts.includes(a.startLine)) starts.push(a.startLine);
        symbolStarts.set(anchor, starts);
        const position = starts.indexOf(a.startLine);
        if (position > 0) anchor = `${anchor}#${position + 1}`;
      }
      const link = {
        requirement: req.identity, specId: req.specId, file: source.rel, anchor, scope: a.scope,
        tier: a.tier, confidence: a.confidence, startLine: a.startLine, endLine: a.endLine ?? null,
        tagLine: tag.line, verb: tag.verb, exact: a.exact, floor: a.floor, req: req.fingerprint,
      };
      link.key = linkKey(link);
      if (seen.has(link.key)) continue;
      seen.add(link.key);
      links.push(link);
    }
  }
  links.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // 4. Degraded tiers and an untrusted cache, aggregated (Constitution IX).
  const degraded = new Map();
  for (const f of files.filter(f => f.degraded)) {
    if (!degraded.has(f.degraded)) degraded.set(f.degraded, []);
    degraded.get(f.degraded).push(f.path);
  }
  for (const [reason, paths] of degraded) {
    problems.push({ code: 'ANC010', file: paths[0], line: null, tier: 'pattern@' + PATTERN_ALGO, confidence: 'medium',
      message: `${paths.length} file(s) were anchored at a lower tier because ${reason} (${paths.slice(0, 3).join(', ')}${paths.length > 3 ? ', …' : ''}); their anchors are less precise` });
  }
  if (cache.tracked.length) {
    problems.push({ code: 'ANC010', file: cache.tracked[0], line: null, tier: FILE_TIER, confidence: 'high', message: `The anchor cache was ${cache.reason}` });
  }

  const summary = {
    links: links.length,
    byScope: tally(links, l => l.scope),
    byTier: tally(links, l => l.tier),
    files: files.length,
  };
  return { activated: anchorsActivated(projectDir, config), links, problems, files, summary, cache: { enabled: cache.enabled, reason: cache.reason }, python: { tier: pyTier, reason: pythonReason } };
}

function tally(items, keyOf) {
  const out = {};
  for (const item of items) { const k = keyOf(item); out[k] = (out[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}
