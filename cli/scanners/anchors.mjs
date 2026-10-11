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
import { ANCHOR_LOCK_PATH, GITATTRIBUTES_LINE, gitattributesDeclaresUnion, readAnchorLock } from './anchor-lock.mjs';
import { FILE_TIER, pythonCandidateLines, resolveFileAnchors } from './anchor-tags.mjs';
import { BABEL_TIER, V1_PREFIX, dg1 } from './fingerprint.mjs';
import { PATTERN_ALGO, languageOf } from './pattern-lexer.mjs';
import { pythonBatch, pythonTier } from './py-anchors.mjs';
import { isTestSource } from './requirement-evidence.mjs';
import { collectRequirementIds } from './requirement-docs.mjs';
import { readRetirementManifest } from './retirement-manifest.mjs';

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
  return { byQualified, byId, retired };
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
    files.push({ path: source.rel, sha: source.sha, tier: result.tier, confidence: result.confidence, degraded: result.degraded || null, error: result.error || null });
    const ordinals = new Map();
    const symbolStarts = new Map();
    for (const a of result.anchors) {
      const tag = a.tag;
      for (const problem of a.problems || []) {
        problems.push({ code: 'ANC006', file: source.rel, line: tag.line, tier: a.tier, confidence: a.confidence, message: `@${tag.verb} ${tag.qualifier ? `${tag.qualifier}#` : ''}${tag.id} ${problem}` });
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
  const requirements = new Set([...index.byQualified.values()].map(e => e.identity));
  return { activated: anchorsActivated(projectDir, config), links, problems, files, summary, cache: { enabled: cache.enabled, reason: cache.reason }, python: { tier: pyTier, reason: pythonReason }, requirements, retired: index.retired };
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
        message: `${link.requirement} changed its text since ${describeLink(link)} was ${entry.state} (${entry.date})` });
    }
    return { ...withEntry, state: 'suspect', side: cmp.side };
  });
  const lost = [];
  for (const [key, entry] of lock.links) {
    if (current.has(key)) continue;
    const exists = base.requirements?.has(entry.requirement);
    const retired = !exists && base.retired?.has(entry.requirement);
    const item = { key, requirement: entry.requirement, file: entry.file, anchor: entry.anchor, scope: entry.scope, tier: entry.tier, entry, state: retired ? 'retired-target' : 'lost' };
    lost.push(item);
    if (retired) continue;
    problems.push({ code: 'ANC003', file: entry.file, line: null, tier: entry.tier, confidence: 'high', key, scope: entry.scope, reviewedState: entry.state, requirement: entry.requirement,
      message: `${describeLink(entry)} was ${entry.state} on ${entry.date}, but no tag anchors it any more${exists ? ' while the requirement still exists' : ' and the requirement is no longer declared'}; restore the tag where the requirement is implemented, or run \`docguard anchors accept --remove '${key}' --reason "…"\`` });
  }
  const byState = {};
  for (const l of [...links, ...lost]) byState[l.state] = (byState[l.state] || 0) + 1;
  const baselined = byState.baselined || 0;
  const summary = { ...base.summary, byState, baselinedShare: links.length ? Number((baselined / links.length).toFixed(3)) : 0 };
  return { ...base, links, lost, problems, lock: lockSummary, notes, summary };
}

