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
 * Cost (FR-041): only files whose text mentions `@implements` or `@req` (or
 * an enabled importer's syntax, FR-038) are read past a substring check, each is parsed at most once, every Python file
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

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildIgnoreFilter, compileGlob, relPosix, walkFiles } from '../shared-ignore.mjs';
import { fileContentAtRev, listTrackedFiles } from '../shared-git.mjs';
import { requirementPatterns } from '../shared-requirements.mjs';
import { openAnchorCache, contentSha } from './anchor-cache.mjs';
import { ANCHOR_LOCK_PATH, GITATTRIBUTES_LINE, gitattributesDeclaresUnion, readAnchorLock } from './anchor-lock.mjs';
import { FILE_TIER, importSettings, orphanCandidates, pythonCandidateLines, resolveFileAnchors, tagHint, volatileLinesFor } from './anchor-tags.mjs';
import { BABEL_TIER, V1_PREFIX, dg1 } from './fingerprint.mjs';
import { PATTERN_ALGO, languageOf } from './pattern-lexer.mjs';
import { pythonBatch, pythonTier } from './py-anchors.mjs';
import { isTestSource, resolveRequirementReferences, scanTestFilesForReferences } from './requirement-evidence.mjs';
import { readSpecRegistry } from './spec-registry.mjs';
import { prepareTreeSitter, treeSitterBatch } from './ts-anchors.mjs';
import { loadTestguardEvidence, structuredHint, testStatus } from './testguard-evidence.mjs';
import { collectRequirementIds } from './requirement-docs.mjs';
import { readRetirementManifest } from './retirement-manifest.mjs';
import { buildImportGraph, reverseImportAncestors, reverseImportIndex } from './import-graph.mjs';

export { ANCHOR_LOCK_PATH };
export const ANCHOR_ALGO = 1;

/**
 * The `anchors.failOn` default, decided by measurement, not by taste (FR-027,
 * FR-028): `tools/anchor-churn-replay.mjs --write-default` sets it from the
 * committed replay evidence (specs/070-requirement-anchors/evidence/), and a
 * drift test keeps the two equal. `reviewed-exact` only if the replay saw zero
 * formatting-only suspects among exact-tier links.
 */
export const ANCHOR_FAIL_DEFAULT = 'reviewed-exact';
export const FAIL_POLICIES = Object.freeze(['none', 'reviewed-exact']);
const PRECISE_SCOPES = new Set(['symbol', 'statement', 'route']);

/** True for the tiers that read code exactly: Babel, python3's ast, tree-sitter. */
export const isExactTier = tier => /^(?:babel|python-ast|treesitter)@/.test(tier || '');

/** The project's failure policy: `anchors.failOn`, else the measured default. */
export function failOnPolicy(config = {}) {
  const value = config.anchors?.failOn;
  return FAIL_POLICIES.includes(value) ? value : ANCHOR_FAIL_DEFAULT;
}

/**
 * Whether a problem fails guard under the policy (FR-028): a code-side
 * suspect (ANC001) or a lost link (ANC003) whose link was REVIEWED (never
 * merely baselined), sits at symbol, statement or route scope, and was read
 * at an exact tier. A file-scope link changes on any edit in its file, and a
 * pattern-tier span is an estimate; neither is precise enough to fail a build.
 * A requirement-side suspect (ANC002) never fails.
 */
export function isFailingProblem(problem, policy) {
  return policy === 'reviewed-exact'
    && (problem.code === 'ANC001' || problem.code === 'ANC003')
    && PRECISE_SCOPES.has(problem.scope)
    && isExactTier(problem.tier)
    && problem.reviewedState === 'reviewed';
}
const MAX_FILE_BYTES = 2 * 1024 * 1024;
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

/**
 * The code that turns a file's bytes into anchors. Its hash joins the cache
 * identity, so an upgrade that changes how tags resolve is never answered
 * with anchors an older resolver computed for the same bytes.
 */
/**
 * A python or tree-sitter request for one source, with the lines a
 * `docguard:volatile` marker holds when there are any, so the out-of-process
 * tiers use the same marked lines as the resolvers (docguard.volatile-anchor-lines#FR-002).
 */
function withVolatile(source, request) {
  const volatile = volatileLinesFor(source.content, source.rel);
  return volatile.size ? { ...request, volatile: [...volatile].sort((a, b) => a - b) } : request;
}

const EXTRACTOR_MODULES = ['./anchor-tags.mjs', './anchors.mjs', './pattern-lexer.mjs', './py-anchors.mjs', './fingerprint.mjs',
  './ts-decls.mjs', './ts-anchors.mjs', './ts-anchors-child.mjs', './js-ast.mjs', '../shared-requirements.mjs'];
let extractorHash = null;
function extractorIdentity() {
  if (!extractorHash) {
    const h = createHash('sha256');
    for (const m of EXTRACTOR_MODULES) { try { h.update(readFileSync(new URL(m, import.meta.url))); } catch { h.update(`missing:${m}`); } }
    extractorHash = h.digest('hex').slice(0, 16);
  }
  return extractorHash;
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
    if (index.retired.has(key)) return { retired: true, identity: key };
    return { error: `cites ${key}, which no spec or requirement document declares` };
  }
  const candidates = byId.get(tag.id) || [];
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) {
    const retired = [...index.retired].filter(key => key.endsWith(`#${tag.id}`));
    if (retired.length === 1) return { retired: true, identity: retired[0] };
    return { error: `cites ${tag.id}, which no spec or requirement document declares` };
  }
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
  // Retired and superseded requirements stay known, so a tag that still cites
  // one is told to retarget (ANC008) instead of being called unknown (ANC007).
  const retired = new Set();
  const manifest = readRetirementManifest(projectDir);
  if (manifest.ok) {
    for (const entry of manifest.entries) {
      for (const id of entry.requirementIds || []) {
        if (typeof id !== 'string') continue;
        retired.add(`${entry.path}#${id}`);
        if (entry.specId) retired.add(`${entry.specId}#${id}`);
      }
    }
  }
  return { byQualified, byId, retired, definitions };
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
  // FR-038: importer settings change what a file's bytes mean, so they are part of the cache identity.
  const importers = importSettings(config);
  const hint = tagHint(importers);
  const importIdentity = importers ? `|import:${dg1(JSON.stringify([[...importers.kinds].sort(), Object.entries(importers.map).sort(([a], [b]) => (a < b ? -1 : 1))]))}` : '';
  // FR-009: the opt-in tree-sitter tier, verified and staged, or a reason it is unavailable.
  // `treeSitterManifest` is a test seam for fake artifacts; production always uses the shipped manifest.
  const ts = prepareTreeSitter(projectDir, config, { manifest: options.treeSitterManifest });
  // The requirement patterns decide which comment text is a tag, so they are part of it too.
  const patternIdentity = dg1(patterns.map(p => `${p.source}/${p.flags}`).join('\n')).slice(-16);
  const identity = `anchors-v${ANCHOR_ALGO}|${V1_PREFIX}|pattern@${PATTERN_ALGO}|${BABEL_TIER}|${pyTier || 'no-python'}|code:${extractorIdentity()}|req:${patternIdentity}${importIdentity}${ts.ok ? `|${ts.tier}` : ''}`;
  const cache = openAnchorCache(projectDir, { identity, noCache: options.noCache, env: options.env });
  const index = requirementIndex(projectDir, config, patterns);

  // 1. Read candidate files, keep the ones that mention a tag. With
  // `revision`, read the named files as that commit had them (the test chain
  // compares the anchored code at a TestGuard evidence revision, FR-033).
  const sources = [];
  const atRevision = options.revision
    ? rel => { const text = fileContentAtRev(projectDir, options.revision, rel); return text === null ? null : Buffer.from(text, 'utf8'); }
    : null;
  for (const rel of atRevision ? options.files || [] : candidateFiles(projectDir, config)) {
    const bytes = atRevision ? atRevision(rel) : readSource(projectDir, rel);
    if (!bytes) continue;
    const content = bytes.toString('utf8');
    if (!hint.test(content)) continue;
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
    python = pythonBatch(pyMisses.map(s => withVolatile(s, { key: s.rel, content: s.content, outline: true, lines: pythonCandidateLines(s.content, hint) })));
  }
  const pythonReason = !pyTier ? 'python3 is unavailable' : (python.ok ? null : python.reason);
  const tsMisses = ts.ok ? sources.filter(s => !resolved.has(s.rel) && ts.languages.includes(languageOf(s.rel))) : [];
  const tsOut = tsMisses.length ? treeSitterBatch(ts, tsMisses.map(s => withVolatile(s, { key: s.rel, lang: languageOf(s.rel), content: s.content }))) : { ok: true, files: {} };
  for (const source of sources) {
    if (resolved.has(source.rel)) continue;
    const tsFile = tsOut.ok ? tsOut.files?.[source.rel] : null;
    const result = resolveFileAnchors(source.content, source.rel, patterns, {
      python: python.ok ? python.files?.[source.rel] || null : null,
      pythonTier: python.ok ? pyTier : null,
      pythonReason,
      importers,
      treeSitter: tsFile?.symbols ? { tier: ts.tier, symbols: tsFile.symbols } : null,
    });
    resolved.set(source.rel, result);
    // A file the tree-sitter process should have read but did not is not cached under its identity.
    const tsMissing = ts.ok && ts.languages.includes(languageOf(source.rel)) && !tsOut.ok;
    if (!result.degraded && !tsMissing) cache.set(source.rel, source.sha, result);
  }
  cache.save();

  // 3. Links, requirement resolution, statement identities, problems.
  const links = [];
  const problems = [];
  const files = [];
  const seen = new Set();
  const targets = new Map();
  for (const source of sources) {
    const result = resolved.get(source.rel);
    files.push({ path: source.rel, sha: source.sha, tier: result.tier, confidence: result.confidence, degraded: result.degraded || null, error: result.error || null });
    const ordinals = new Map();
    const symbolStarts = new Map();
    for (const a of result.anchors) {
      const tag = a.tag;
      for (const problem of a.problems || []) {
        problems.push({ code: 'ANC006', file: source.rel, line: tag.line, tier: a.tier, confidence: a.confidence, message: `@${tag.verb} ${tag.qualifier ? `${tag.qualifier}#` : ''}${tag.id} ${problem}` });
      }
      if (tag.unmapped) {
        problems.push({ code: 'ANC007', file: source.rel, line: tag.line, tier: a.tier, confidence: a.confidence, message: `@${tag.verb} ${tag.foreign.ref} at ${source.rel}:${tag.line} ${tag.unmapped}` });
        continue;
      }
      // docguard.volatile-anchor-lines#FR-005: an anchor the marker silences entirely is said so.
      if (a.volatileOnly) {
        problems.push({ code: 'ANC011', file: source.rel, line: tag.line, tier: a.tier, confidence: a.confidence,
          message: `@${tag.verb} ${tag.qualifier ? `${tag.qualifier}#` : ''}${tag.id} anchors only lines marked docguard:volatile (lines ${a.startLine}-${a.endLine ?? 'end'}), so it can never turn suspect. Anchor it to the code that implements the requirement, or remove the marker` });
      }
      const req = resolveRequirement(tag, index);
      if (req.retired) {
        const link = { requirement: req.identity, specId: null, file: source.rel, anchor: a.anchor || `${a.owner}>stmt:${req.identity}#1`, scope: a.scope,
          tier: a.tier, confidence: a.confidence, startLine: a.startLine, endLine: a.endLine ?? null, tagLine: tag.line, verb: tag.verb,
          exact: a.exact, floor: a.floor, req: null, retired: true };
        link.key = linkKey(link);
        if (!seen.has(link.key)) { seen.add(link.key); links.push(link); }
        continue;
      }
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
        ...(tag.foreign ? { imported: { from: tag.foreign.source, ref: tag.foreign.ref, ...(tag.foreign.outdated ? { outdated: { revision: tag.foreign.revision, expected: tag.foreign.expected } } : {}) } } : {}),
      };
      link.key = linkKey(link);
      // A symbol tagged natively and through an importer for different requirements is ambiguous (FR-038).
      const target = `${link.file}\u0000${link.anchor}\u0000${link.scope}`;
      const origins = targets.get(target) || { native: new Set(), foreign: new Set(), line: tag.line, tier: a.tier, confidence: a.confidence, where: describeLink(link).split(' → ')[1] };
      (tag.foreign ? origins.foreign : origins.native).add(link.requirement);
      targets.set(target, origins);
      if (seen.has(link.key)) continue;
      seen.add(link.key);
      links.push(link);
    }
  }
  links.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const [target, o] of targets) {
    if (!o.native.size || !o.foreign.size) continue;
    const same = o.native.size === o.foreign.size && [...o.native].every(r => o.foreign.has(r));
    if (same) continue;
    problems.push({ code: 'ANC006', file: target.split('\u0000')[0], line: o.line, tier: o.tier, confidence: o.confidence,
      message: `${o.where} carries native tags for ${[...o.native].sort().join(', ')} and imported tags for ${[...o.foreign].sort().join(', ')}; keep one tagging system per symbol, or make them name the same requirements` });
  }

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
  const tsReasons = [...(ts.configured && !ts.ok ? [ts.reason] : []), ...(ts.problems || []), ...(tsOut.ok ? [] : [tsOut.reason])];
  for (const reason of tsReasons) {
    problems.push({ code: 'ANC010', file: '.docguard.json', line: null, tier: 'pattern@' + PATTERN_ALGO, confidence: 'high',
      message: `The tree-sitter tier is unavailable: ${reason}; the pattern tier anchors these files` });
  }

  const summary = {
    links: links.length,
    byScope: tally(links, l => l.scope),
    byTier: tally(links, l => l.tier),
    files: files.length,
  };
  const requirements = new Set([...index.byQualified.values()].map(e => e.identity));
  return { activated: anchorsActivated(projectDir, config), links, problems, files, summary, cache: { enabled: cache.enabled, reason: cache.reason }, python: { tier: pyTier, reason: pythonReason }, requirements, retired: index.retired, index };
}

function tally(items, keyOf) {
  const out = {};
  for (const item of items) { const k = keyOf(item); out[k] = (out[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Compare one lock entry with the link as it is now (contracts/fingerprint.md,
 * "Comparison"): the exact fingerprint when the tier is unchanged, else the
 * pattern-tier floor that every machine can compute.
 */
export function compareEntry(entry, link) {
  if (!entry.code.startsWith('dg1:')) {
    return { verdict: 'unverifiable', reason: `the lock entry was recorded with fingerprint algorithm ${entry.code.split(':')[0]}, which this DocGuard does not compute` };
  }
  const sameTier = entry.tier === link.tier;
  const codeSame = sameTier ? entry.code === link.exact : entry.floor === link.floor;
  const reqSame = link.req === null || entry.req === link.req;
  if (codeSame && reqSame) return { verdict: entry.state, tierChanged: !sameTier };
  return { verdict: 'suspect', side: !codeSame && !reqSame ? 'both' : !codeSame ? 'code' : 'requirement', tierChanged: !sameTier };
}

const describeLink = l => `${l.requirement} → ${l.file}${l.scope === 'file' ? '' : ` ${l.anchor}`}`;

/**
 * Every link with its state against the anchor lock (FR-019), the lock entries
 * whose code is gone (lost / retired-target), and the problems guard reports.
 * @returns {object} computeLinks' result plus `links[].state`, `lost[]`, `lock`, `notes[]`
 */
export function computeAnchorStatus(projectDir, config = {}, options = {}) {
  const base = computeLinks(projectDir, config, options);
  const lock = readAnchorLock(projectDir);
  const problems = [...base.problems];
  const notes = [];
  const lockSummary = { path: ANCHOR_LOCK_PATH, exists: lock.exists, entries: lock.links.size, error: lock.error, conflicts: lock.conflicts.length };
  if (lock.error) {
    problems.push({ code: 'ANC005', file: ANCHOR_LOCK_PATH, line: null, tier: 'file', confidence: 'high', message: lock.error });
    return { ...base, problems, lock: lockSummary, lost: [], notes,
      links: base.links.map(l => ({ ...l, state: 'unverifiable', reason: 'the anchor lock cannot be read' })) };
  }
  if (lock.exists && !gitattributesDeclaresUnion(projectDir)) {
    notes.push(`.gitattributes does not declare the anchor lock merge=union, so two branches that review links can conflict. Add the line \`${GITATTRIBUTES_LINE}\`, or run \`docguard anchors accept … --gitattributes\`.`);
  }
  if (lock.exists) notes.push('DocGuard records reasons and bulk flags but authenticates nobody: require human review of .docguard-anchor-lock.jsonl through CODEOWNERS.');
  const conflicted = new Set(lock.conflicts.map(c => c.key));
  for (const c of lock.conflicts) {
    problems.push({ code: 'ANC009', file: ANCHOR_LOCK_PATH, line: c.lines[0], tier: 'file', confidence: 'high',
      message: `${ANCHOR_LOCK_PATH} records ${c.key} on lines ${c.lines.join(' and ')} with different content (usually a union merge of two reviews); the link is treated as unreviewed until it is accepted again` });
  }
  const current = new Set(base.links.map(l => l.key));
  const links = base.links.map(link => {
    if (link.retired) {
      problems.push({ code: 'ANC008', file: link.file, line: link.tagLine, tier: link.tier, confidence: 'high',
        message: `@${link.verb} at ${link.file}:${link.tagLine} cites ${link.requirement}, a requirement of a retired or superseded spec; point it at the requirement that replaced it, or remove it` });
      return { ...link, state: 'retired-target' };
    }
    if (conflicted.has(link.key)) return { ...link, state: 'suspect', side: 'conflict' };
    const entry = lock.links.get(link.key);
    // FR-038: OpenFastTrace's "outdated": the tag covers an older revision than the mapping expects.
    if (link.imported?.outdated) {
      const { revision, expected } = link.imported.outdated;
      problems.push({ code: 'ANC001', file: link.file, line: link.startLine || link.tagLine, tier: link.tier, confidence: 'high', key: link.key, requirement: link.requirement,
        scope: link.scope, reviewedState: entry?.state || null, revision: entry?.revision || null, cause: 'oft-outdated',
        message: `${describeLink(link)} is outdated: its OpenFastTrace tag covers revision ${revision}, and anchors.importMap expects ${expected}` });
      return { ...link, ...(entry ? { entry, reviewedState: entry.state } : {}), state: 'suspect', side: 'code', cause: 'oft-outdated' };
    }
    if (!entry) {
      if (lock.exists) problems.push({ code: 'ANC004', file: link.file, line: link.tagLine, tier: link.tier, confidence: 'high', message: `${describeLink(link)} has no review yet` });
      return { ...link, state: 'unreviewed' };
    }
    const cmp = compareEntry(entry, link);
    const withEntry = { ...link, entry, reviewedState: entry.state, tierChanged: cmp.tierChanged || false };
    if (cmp.verdict === 'unverifiable') {
      problems.push({ code: 'ANC010', file: link.file, line: link.tagLine, tier: link.tier, confidence: 'high', message: `${describeLink(link)} cannot be compared: ${cmp.reason}` });
      return { ...withEntry, state: 'unverifiable', reason: cmp.reason };
    }
    if (cmp.verdict !== 'suspect') return { ...withEntry, state: cmp.verdict };
    if (cmp.side === 'code' || cmp.side === 'both') {
      problems.push({ code: 'ANC001', file: link.file, line: link.startLine || link.tagLine, tier: link.tier, confidence: 'high', key: link.key, requirement: link.requirement,
        scope: link.scope, reviewedState: entry.state, revision: entry.revision,
        message: `${describeLink(link)} changed since it was ${entry.state} (${entry.date}${cmp.tierChanged ? `, compared at the pattern floor because the tier changed from ${entry.tier}` : `, ${link.tier}`})` });
    }
    if (cmp.side === 'requirement' || cmp.side === 'both') {
      problems.push({ code: 'ANC002', file: link.file, line: link.tagLine, tier: link.tier, confidence: 'high', key: link.key, requirement: link.requirement,
        scope: link.scope, reviewedState: entry.state,
        message: `${link.requirement} changed its text since ${describeLink(link)} was ${entry.state} (${entry.date})` });
    }
    return { ...withEntry, state: 'suspect', side: cmp.side };
  });
  // FR-030: a reviewed entry whose anchor no longer resolves carries over to
  // the ONE unreviewed link with the same requirement and the same code
  // fingerprint (a rename or move with an unchanged body: v1 leaves the
  // symbol's own name out). Zero or several candidates is lost; no similarity
  // matching, because trivial bodies collide. Nothing is written: the next
  // accept rewrites the key.
  const unreviewedByCode = new Map();
  for (const l of links) {
    if (l.state !== 'unreviewed') continue;
    const k = `${l.requirement}\u0000${l.exact}`;
    unreviewedByCode.set(k, [...(unreviewedByCode.get(k) || []), l]);
  }
  const claims = new Map(); // candidate key → lost entry keys that point at it
  const orphaned = [...lock.links].filter(([key]) => !current.has(key));
  for (const [key, entry] of orphaned) {
    const candidates = unreviewedByCode.get(`${entry.requirement}\u0000${entry.code}`) || [];
    if (candidates.length === 1) claims.set(candidates[0].key, [...(claims.get(candidates[0].key) || []), key]);
  }
  const movedTo = new Map(); // old key → new link
  for (const [candidateKey, oldKeys] of claims) {
    if (oldKeys.length !== 1) continue; // two vanished entries, one body: ambiguous
    movedTo.set(oldKeys[0], links.find(l => l.key === candidateKey));
  }
  for (const [oldKey, target] of movedTo) {
    const entry = lock.links.get(oldKey);
    const index = links.indexOf(target);
    links[index] = { ...target, state: 'moved', entry, reviewedState: entry.state, movedFrom: oldKey };
    const unreviewedNote = problems.findIndex(p => p.code === 'ANC004' && p.file === target.file && p.line === target.tagLine && p.message.startsWith(target.requirement));
    if (unreviewedNote >= 0) problems.splice(unreviewedNote, 1);
    notes.push(`${target.requirement} moved from ${entry.file}${entry.scope === 'file' ? '' : ` ${entry.anchor}`} to ${target.file}${target.scope === 'file' ? '' : ` ${target.anchor}`} with its code unchanged; its ${entry.state} review carries over until the next accept rewrites the key.`);
  }
  const lost = [];
  for (const [key, entry] of lock.links) {
    if (current.has(key) || movedTo.has(key)) continue;
    const exists = base.requirements?.has(entry.requirement);
    const retired = !exists && base.retired?.has(entry.requirement);
    const item = { key, requirement: entry.requirement, file: entry.file, anchor: entry.anchor, scope: entry.scope, tier: entry.tier, entry, state: retired ? 'retired-target' : 'lost' };
    lost.push(item);
    if (retired) continue;
    problems.push({ code: 'ANC003', file: entry.file, line: null, tier: entry.tier, confidence: 'high', key, scope: entry.scope, reviewedState: entry.state, requirement: entry.requirement,
      message: `${describeLink(entry)} was ${entry.state} on ${entry.date}, but no tag anchors it any more${exists ? ' while the requirement still exists' : ' and the requirement is no longer declared'}; restore the tag where the requirement is implemented, or run \`docguard anchors accept --remove '${key}' --reason "…"\`` });
  }
  if (options.ripple) addRipple(projectDir, config, links);
  if (options.tests) addTestChain(projectDir, config, links, base);
  const byState = {};
  for (const l of [...links, ...lost]) byState[l.state] = (byState[l.state] || 0) + 1;
  const baselined = byState.baselined || 0;
  const summary = { ...base.summary, byState, baselinedShare: links.length ? Number((baselined / links.length).toFixed(3)) : 0 };
  return { ...base, links, lost, problems, lock: lockSummary, notes, summary };
}

/** A code-side suspect: the anchored code changed since its review (FR-032). */
const isCodeSuspect = link => link.state === 'suspect' && (link.side === 'code' || link.side === 'both');

/** Every test reference (`@req`, `@covers`, a test label) per requirement identity. */
function testReferences(projectDir, config, index) {
  const patterns = requirementPatterns(config);
  const files = listTrackedFiles(projectDir) || (() => { const out = []; walkFiles(projectDir, abs => { out.push(relPosix(projectDir, abs)); }); return out; })();
  const ignored = buildIgnoreFilter(config.ignore || []);
  const refs = scanTestFilesForReferences(projectDir, files.filter(f => !ignored(f)), patterns);
  const byRequirement = new Map();
  for (const [key, list] of resolveRequirementReferences(index.definitions, refs, index.retired)) {
    const def = index.definitions.get(key);
    const identity = def?.specId ? `${def.specId}#${def.id}` : key;
    const seen = byRequirement.get(identity) || new Map();
    for (const r of list) seen.set(`${r.file}:${r.line}`, { file: r.file, line: r.line });
    byRequirement.set(identity, seen);
  }
  return byRequirement;
}

/**
 * FR-032/FR-033: each code-side suspect lists the tests that cite its
 * requirement, as needing re-verification; a saved TestGuard evidence file
 * upgrades a test to re-verified only when it proves the code as it is now.
 * Advisory: guard never reads this.
 *
 * @implements docguard.requirement-anchors#FR-032
 */
function addTestChain(projectDir, config, links, base) {
  const suspects = links.filter(isCodeSuspect);
  if (!suspects.length) return;
  const refs = testReferences(projectDir, config, base.index);
  const evidence = loadTestguardEvidence(projectDir, config);
  // The anchored code at the evidence revision, read once for every suspect file.
  let atRevision = new Map();
  if (evidence.status === 'ok') {
    const files = [...new Set(suspects.map(l => l.file))].sort();
    const then = computeLinks(projectDir, config, { revision: evidence.revision, files, noCache: true });
    atRevision = new Map(then.links.map(l => [l.key, l]));
  }
  const resolveRef = ref => base.index.byQualified.get(ref)?.identity || null;
  for (const link of suspects) {
    const then = atRevision.get(link.key);
    const state = !then ? 'missing'
      : (then.tier === link.tier ? then.exact === link.exact : then.floor === link.floor) ? 'unchanged' : 'changed';
    const hasSpecId = Boolean(link.specId);
    let hint;
    link.tests = [...(refs.get(link.requirement)?.values() || [])]
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))
      .map(t => {
        if (hint === undefined) hint = structuredHint(evidence, link.requirement, resolveRef, hasSpecId);
        return { file: t.file, line: t.line, ...testStatus(evidence, { requirement: link.requirement, testFile: t.file, atRevision: state, hint }) };
      });
  }
}

/* ───────────────────────────── Orphans and granularity (US7) ───────────────────────────── */

const GLOB_CHARS = /[*?{]/;

/** A governed-path entry: a glob, or a file or directory prefix. */
function pathMatcher(entry) {
  const clean = String(entry).replace(/^\.\//, '').replace(/\/+$/, '');
  if (GLOB_CHARS.test(clean)) { const re = compileGlob(clean); return rel => re.test(rel); }
  return rel => rel === clean || rel.startsWith(`${clean}/`);
}

/**
 * Where orphans are looked for (FR-034): `anchors.orphanPaths`, else the
 * `scope.sourcePaths` of current specs in the committed registry. `spec`
 * narrows to one spec's paths.
 */
export function governedPaths(projectDir, config = {}, spec = null) {
  const registry = readSpecRegistry(projectDir);
  const specs = (registry.value?.specs || []).filter(e => e.reviewed?.lifecycle?.context === 'current');
  let paths = [];
  let source;
  if (spec) {
    const entry = specs.find(e => e.specId === spec);
    paths = entry?.reviewed?.scope?.sourcePaths || [];
    source = `the scope.sourcePaths of ${spec}`;
  } else if (Array.isArray(config.anchors?.orphanPaths) && config.anchors.orphanPaths.length) {
    paths = config.anchors.orphanPaths.filter(p => typeof p === 'string' && p);
    source = 'anchors.orphanPaths';
  } else {
    paths = [...new Set(specs.flatMap(e => e.reviewed?.scope?.sourcePaths || []))].sort();
    source = 'the scope.sourcePaths of current specs';
  }
  const matchers = paths.map(pathMatcher);
  return { paths, source, matches: rel => matchers.some(m => m(rel)) };
}

const DISPOSITION_PREFIX = 'disposition|';
export const dispositionKey = (file, anchor) => `${DISPOSITION_PREFIX}${encodeKeyPart(file)}|${encodeKeyPart(anchor)}`;

/** Whether a link in the same file anchors this unit, or inside it. */
function covers(link, name) {
  if (link.scope === 'file') return true;
  const anchor = link.scope === 'statement' ? link.anchor.split('>stmt:')[0] : link.anchor;
  return anchor === name || ['.', '#', '(', '>'].some(sep => anchor.startsWith(`${name}${sep}`));
}

/**
 * FR-034/FR-035: every exported or top-level implementation unit under the
 * governed paths that no tag anchors, once, ordered by file, line and name,
 * with any disposition recorded for it. A report, never a guard finding; it
 * proposes no requirement text and calls no model.
 * @implements docguard.requirement-anchors#FR-034
 */
export function computeOrphans(projectDir, config = {}, options = {}) {
  const governed = governedPaths(projectDir, config, options.spec || null);
  const lock = readAnchorLock(projectDir);
  const notes = [];
  if (!governed.paths.length) {
    notes.push(options.spec
      ? `${options.spec} declares no scope.sourcePaths, so it governs no code.`
      : 'No governed paths: set anchors.orphanPaths in .docguard.json (globs, files or directories), or give a spec scope.sourcePaths.');
  }
  const files = governed.paths.length ? candidateFiles(projectDir, config).filter(governed.matches) : [];
  const sources = [];
  for (const rel of files) {
    const bytes = readSource(projectDir, rel);
    if (bytes) sources.push({ rel, content: bytes.toString('utf8') });
  }
  const pyTier = pythonTier();
  const pySources = sources.filter(src => languageOf(src.rel) === 'python');
  const python = pySources.length && pyTier ? pythonBatch(pySources.map(src => ({ key: src.rel, content: src.content, outline: true, lines: [] }))) : { ok: false };
  const links = governed.paths.length ? computeLinks(projectDir, config, { noCache: options.noCache }).links : [];
  const linksByFile = new Map();
  for (const l of links) linksByFile.set(l.file, [...(linksByFile.get(l.file) || []), l]);
  const orphans = [];
  const candidates = new Set();
  const unreadable = [];
  let symbols = 0;
  for (const src of sources) {
    const result = orphanCandidates(src.content, src.rel, { python: python.ok ? python.files?.[src.rel] || null : null, pythonTier: python.ok ? pyTier : null });
    if (result.error && !result.symbols.length) { unreadable.push(`${src.rel} (${result.error})`); continue; }
    const fileLinks = linksByFile.get(src.rel) || [];
    const seen = new Set();
    for (const sym of result.symbols) {
      if (seen.has(sym.name)) continue;
      seen.add(sym.name);
      symbols++;
      if (fileLinks.some(l => covers(l, sym.name))) continue;
      const key = dispositionKey(src.rel, sym.name);
      candidates.add(key);
      const d = lock.dispositions.get(key);
      orphans.push({ file: src.rel, anchor: sym.name, line: sym.line, kind: sym.kind, tier: result.tier,
        disposition: d ? { kind: d.kind, reason: d.reason, date: d.date } : null });
    }
  }
  orphans.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || (a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0)));
  if (unreadable.length) notes.push(`${unreadable.length} governed file(s) could not be read for symbols: ${unreadable.slice(0, 3).join(', ')}${unreadable.length > 3 ? ', …' : ''}`);
  const staleDispositions = [...lock.dispositions.values()]
    .filter(d => !candidates.has(d.key) && (!options.spec || governed.matches(d.file)))
    .map(d => ({ key: d.key, file: d.file, anchor: d.anchor, kind: d.kind, date: d.date,
      why: !governed.matches(d.file) ? 'outside the governed paths' : 'no untagged symbol by that name any more (tagged, renamed or removed)' }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  return {
    governed: { source: governed.source, paths: governed.paths },
    files: sources.length,
    symbols,
    orphans,
    undispositioned: orphans.filter(o => !o.disposition).length,
    staleDispositions,
    lock: { error: lock.error },
    notes,
  };
}

/**
 * FR-036: how precisely this project's links are anchored, by scope and tier.
 * Information only, and only once the project opted in (FR-041: a project
 * that has not pays nothing).
 * @implements docguard.requirement-anchors#FR-036
 */
export function anchorGranularity(projectDir, config = {}) {
  if (!anchorsActivated(projectDir, config)) return null;
  const { summary } = computeLinks(projectDir, config);
  return { links: summary.links, byScope: summary.byScope, byTier: summary.byTier };
}

/* ───────────────────────────── Trace matrix (US8) ───────────────────────────── */

/** Byte order on UTF-8, the contract's sort (not UTF-16 code units). */
const byteCompare = (a, b) => Buffer.compare(Buffer.from(String(a ?? ''), 'utf8'), Buffer.from(String(b ?? ''), 'utf8'));

/** A spec's state for the matrix: `retired`, else its reviewed delivery state. */
function specStates(projectDir) {
  const registry = readSpecRegistry(projectDir);
  const states = new Map();
  for (const e of registry.value?.specs || []) {
    const lifecycle = e.reviewed?.lifecycle || {};
    states.set(e.specId, lifecycle.context === 'retired' ? 'retired' : lifecycle.delivery || '');
  }
  return states;
}

/**
 * FR-037: every requirement → anchor → test path, in one deterministic order
 * (requirement, file, anchor, test file, test line; byte order). One row per
 * (link, test reference); a link with no test has one row with empty test
 * columns; a requirement with no link has one row per test, or one row,
 * with `link_state: missing`. The ReqIF model holds each requirement, anchor
 * and test once, with `implements` and `verifies` relations.
 * @implements docguard.requirement-anchors#FR-037
 */
export function traceMatrix(projectDir, config = {}, options = {}) {
  const status = computeAnchorStatus(projectDir, config, { tests: true, noCache: options.noCache });
  const index = status.index;
  const refs = testReferences(projectDir, config, index);
  const states = specStates(projectDir);
  const inSpec = id => !options.spec || id.startsWith(`${options.spec}#`);
  const requirements = new Map();
  const addRequirement = (identity, fingerprint, specId) => {
    if (requirements.has(identity) || !inSpec(identity)) return;
    requirements.set(identity, { identity, fingerprint: fingerprint || '', specState: specId ? states.get(specId) ?? '' : (index.retired.has(identity) ? 'retired' : '') });
  };
  for (const entry of index.byQualified.values()) addRequirement(entry.identity, entry.fingerprint, entry.specId);
  const allLinks = [
    ...status.links.map(l => ({ ...l, entry: l.entry || null })),
    ...status.lost.map(l => ({ ...l, confidence: '', exact: l.entry.code, tests: undefined })),
  ].filter(l => inSpec(l.requirement));
  for (const l of allLinks) addRequirement(l.requirement, l.req || l.entry?.req || '', l.specId || (l.retired || l.state === 'retired-target' ? null : l.requirement.split('#')[0]));
  const testsOf = identity => [...(refs.get(identity)?.values() || [])].sort((a, b) => byteCompare(a.file, b.file) || a.line - b.line);

  const rows = [];
  const linksBy = new Map();
  for (const l of allLinks) linksBy.set(l.requirement, [...(linksBy.get(l.requirement) || []), l]);
  for (const req of requirements.values()) {
    const base = { requirement: req.identity, requirement_fp: req.fingerprint, spec_state: req.specState };
    const tests = testsOf(req.identity);
    const links = linksBy.get(req.identity) || [];
    if (!links.length) {
      const empty = { file: '', anchor: '', scope: '', tier: '', confidence: '', link_state: 'missing', suspect_side: '', code_fp: '', reviewed_revision: '', reviewed_date: '' };
      if (!tests.length) rows.push({ ...base, ...empty, test_file: '', test_line: '', test_status: '' });
      for (const t of tests) rows.push({ ...base, ...empty, test_file: t.file, test_line: t.line, test_status: 'linked' });
      continue;
    }
    for (const l of links) {
      const linkCols = {
        file: l.file, anchor: l.scope === 'file' ? '' : l.anchor, scope: l.scope, tier: l.tier, confidence: l.confidence || '',
        link_state: l.state, suspect_side: l.side || '', code_fp: l.exact || '',
        reviewed_revision: l.entry?.revision || '', reviewed_date: l.entry?.date || '', key: l.key,
      };
      if (!tests.length) rows.push({ ...base, ...linkCols, test_file: '', test_line: '', test_status: '' });
      for (const t of tests) {
        const chain = (l.tests || []).find(x => x.file === t.file && x.line === t.line);
        rows.push({ ...base, ...linkCols, test_file: t.file, test_line: t.line, test_status: chain ? chain.status : 'linked' });
      }
    }
  }
  rows.sort((a, b) => byteCompare(a.requirement, b.requirement) || byteCompare(a.file, b.file) || byteCompare(a.anchor, b.anchor)
    || byteCompare(a.test_file, b.test_file) || (Number(a.test_line) || 0) - (Number(b.test_line) || 0));
  return { rows, requirements: [...requirements.values()].sort((a, b) => byteCompare(a.identity, b.identity)) };
}

const GRAPH_LANGS = new Set(['js', 'ts', 'python']);
export const DEFAULT_FAN_OUT_LIMIT = 10;

/** The top-level name a changed anchor exports, or null (a route, a module statement). */
function exportedNameOf(link) {
  if (link.scope === 'symbol') return link.anchor.split(/[.#(]/)[0];
  if (link.scope === 'statement') {
    const owner = link.anchor.split('>stmt:')[0];
    return owner === '<module>' ? null : owner.split('.')[0];
  }
  return null;
}

/** Whether `importer` binds `name` from the changed file, by its import edge. */
function bindsName(projectDir, importer, names, name) {
  if (!names || names.all) return true; // unknown or re-exported: conservative
  if (names.named.includes(name)) return true;
  if (name === 'default' && names.default) return true;
  if (names.namespace) {
    let text = '';
    try { text = readFileSync(resolve(projectDir, importer), 'utf8'); } catch { return true; }
    const ns = names.namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${ns}\\.${name}\\b`).test(text);
  }
  return false;
}

/**
 * FR-031: for each link whose code changed (a code-side suspect at symbol or
 * statement scope), the anchored links in files that import it and use the
 * changed exported name, up to the two hops `diff --since` walks, hubs
 * excluded. Hop-one importers must bind the name; hop-two files are reported
 * at low confidence (which of their imports reaches the change is not
 * known without a call graph, which this deliberately does not build). More
 * than `anchors.fanOutLimit` files collapse into one summary. Advisory only:
 * ripple never produces a guard finding.
 */
function addRipple(projectDir, config, links) {
  const changed = links.filter(l => l.state === 'suspect' && (l.side === 'code' || l.side === 'both') && l.scope !== 'file');
  if (!changed.length) return;
  const limit = Number.isInteger(config.anchors?.fanOutLimit) && config.anchors.fanOutLimit > 0 ? config.anchors.fanOutLimit : DEFAULT_FAN_OUT_LIMIT;
  const graph = buildImportGraph(projectDir, config);
  const { reverseEdges, isHub } = reverseImportIndex(graph);
  const edgeNames = new Map(graph.edges.map(e => [`${e.from}\u0000${e.to}`, e.names ?? null]));
  const linksByFile = new Map();
  for (const l of links) {
    if (!linksByFile.has(l.file)) linksByFile.set(l.file, []);
    linksByFile.get(l.file).push(l.key);
  }
  for (const link of changed) {
    if (!GRAPH_LANGS.has(languageOf(link.file))) { link.ripple = { unavailable: `no import graph for ${link.file}` }; continue; }
    const name = exportedNameOf(link);
    const ancestors = reverseImportAncestors(link.file, reverseEdges);
    const hopOne = new Set();
    const hits = [];
    for (const [file, hops] of [...ancestors].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))) {
      if (isHub(file)) continue;
      if (hops === 1) {
        if (name && !bindsName(projectDir, file, edgeNames.get(`${file}\u0000${link.file}`), name)) continue;
        hopOne.add(file);
      } else if (![...hopOne].some(h => (reverseEdges.get(h) || []).includes(file))) continue;
      const anchored = (linksByFile.get(file) || []).filter(k => k !== link.key);
      if (!anchored.length) continue;
      const via = hops === 1 ? link.file : [...hopOne].find(h => (reverseEdges.get(h) || []).includes(file));
      hits.push({ file, via, hops, confidence: hops === 1 ? 'high' : 'low', links: anchored });
    }
    link.ripple = hits.length > limit
      ? { collapsed: true, count: hits.length, files: hits.slice(0, limit).map(h => h.file) }
      : hits;
  }
}

