import { docRolePath } from '../shared-doc-roles.mjs';
/**
 * Semantic claim extractor (LLM field report #5).
 *
 * The highest-value class of doc bug is SEMANTIC: a documented number/enum/limit
 * that no longer matches the code — DLP retention "30 days" vs code 730, a status
 * enum "PENDING/IDLE" vs "WAITING", "100/min" vs "500 req/s", "29+ roles" vs 44,
 * "4 GSIs" vs 6. Regex/AST can't judge these (the doc value and the code value
 * are both just numbers), so they slip through every deterministic validator.
 *
 * DocGuard is zero-dependency and does NOT call an LLM itself. So this is an
 * EXTRACTOR: it surfaces the verifiable claims — value, unit, doc:line, section,
 * and the nearest cited code path — as a structured task list. The agent running
 * `docguard verify --semantic` does the actual comparison against the code. This
 * mirrors the `docguard agent` task-graph: deterministic discovery, LLM judgment.
 *
 * Precision over recall: a number is only a claim when it carries a recognized
 * unit (days/ms/req-s/GSIs/roles/…); an enum only when it's a list of 2+
 * UPPER_SNAKE tokens in a status/state/enum context. Bare version strings, dates,
 * and prose numbers are ignored.
 *
 * Zero npm dependencies — pure Node.js built-ins.
 */

import { lstatSync, realpathSync, readdirSync, openSync, readSync, fstatSync, closeSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { loadIgnorePatterns } from '../shared.mjs';


// Numbers are only claims when adjacent to a recognized unit.
const NUMBER_PATTERNS = [
  { kind: 'duration', re: /\b(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b/gi },
  { kind: 'rate',     re: /\b(\d+)\s*(?:\/|\bper\b|\breq(?:uests?)?\s*\/?)\s*(s|sec|seconds?|min|minutes?|hours?|h)\b/gi },
  // Field report #6: the noun list IS the precision mechanism — a number is only
  // a claim when it sits next to a recognized "registered-unit" noun. The gap that
  // shipped a wrong "16 extractors" past every check was simply that "extractors"
  // (and its domain-collection siblings) weren't in this list. Added the common
  // pluggable-architecture nouns. Deliberately NOT added: generic prose nouns that
  // collide with running-text numbers (steps, items, checks, modules, services).
  { kind: 'count',    re: /\b(\d+)\s*\+?\s*(GSIs?|LSIs?|indexes|indices|roles?|permissions?|scopes?|tables?|queues?|topics?|buckets?|endpoints?|routes?|validators?|columns?|fields?|shards?|partitions?|replicas?|retries|workers?|threads?|connections?|extractors?|plugins?|detectors?|scanners?|analyzers?|collectors?|commands?|subcommands?|rules?|hooks?|providers?|adapters?|handlers?|middlewares?|transformers?|processors?|generators?|parsers?|exporters?|importers?|integrations?|formatters?|linters?|agents?|skills?)\b/gi },
];

// A list of 2+ UPPER_SNAKE tokens separated by / , | or "or" — an enum claim,
// but only when the line or its heading reads like a status/state/enum context.
const ENUM_LIST_RE = /\b[A-Z][A-Z0-9_]{2,}(?:\s*(?:\/|,|\||\bor\b)\s*[A-Z][A-Z0-9_]{2,}){1,}\b/g;
const ENUM_CONTEXT_RE = /\b(status|state|enum|values?|one of|phase|stage|transitions?)\b/i;

export const SEMANTIC_COVERAGE_LIMITATION = 'Semantic claim discovery is limited to docs-canonical/**/*.md, explicitly mapped Markdown document roles, README.md, and AGENTS.md, subject to ignores, safety checks, and scan budgets. Other resolved documentation homes are unscanned/unsupported by this extractor; guard coverage labels do not extend this scope. Hashes cover only captured document and cited-source inputs, not all documentation or factual correctness.';

const MAX_CLAIMS = 80;
const MAX_EVIDENCE_FILE_BYTES = 1024 * 1024;
const MAX_EVIDENCE_BYTES = 8 * MAX_EVIDENCE_FILE_BYTES;
const MAX_EVIDENCE_FILES = 128;
const MAX_CITED_SOURCES = 8;

export function contentHash(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function unknownFile(path, reason) {
  return { path: path || null, status: 'unknown', hash: null, reason };
}

function privateSegment(part) {
  return part.toLowerCase() === '.local' || /^\.env(?:\.|$)/i.test(part);
}

/** Per-run bounded cache. Never follows symlinks, reads secrets, or leaves root. */
export function createEvidenceReader(projectDir) {
  let root;
  try { root = realpathSync(projectDir); } catch { /* unknown root */ }
  const cache = new Map();
  let bytes = 0;
  return (citation) => {
    const path = typeof citation === 'string' ? citation.replace(/:\d+(?:-\d+)?$/, '') : null;
    if (!path) return { evidence: unknownFile(path, 'not-cited'), content: null };
    if (cache.has(path)) return cache.get(path);
    const fail = (reason) => ({ evidence: unknownFile(path, reason), content: null });
    if (!root || isAbsolute(path) || /[\\:\0]/.test(path) || path.split('/').some(p => p === '..' || privateSegment(p))) {
      return fail('unsafe-path');
    }
    if (cache.size >= MAX_EVIDENCE_FILES) return fail('file-budget');
    let result;
    let fd;
    try {
      let full = root;
      let inspected;
      for (const part of path.split('/').filter(p => p && p !== '.')) {
        full = resolve(full, part);
        inspected = lstatSync(full);
        if (inspected.isSymbolicLink()) throw new Error('symlink');
      }
      const actual = realpathSync(full);
      const rel = relative(root, actual);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || rel.split(sep).some(privateSegment)) {
        throw new Error('unsafe-path');
      }
      fd = openSync(actual, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(fd);
      if (!stat.isFile()) throw new Error('not-file');
      if (stat.dev !== inspected?.dev || stat.ino !== inspected?.ino) throw new Error('changed-during-read');
      if (stat.size > MAX_EVIDENCE_FILE_BYTES) throw new Error('file-too-large');
      if (bytes + stat.size > MAX_EVIDENCE_BYTES) throw new Error('byte-budget');
      const buffer = Buffer.alloc(stat.size);
      let offset = 0;
      while (offset < buffer.length) {
        const n = readSync(fd, buffer, offset, buffer.length - offset, offset);
        if (!n) break;
        offset += n;
      }
      bytes += offset;
      const after = fstatSync(fd);
      if (offset !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
        throw new Error('changed-during-read');
      }
      result = { evidence: { path, status: 'snapshot', hash: contentHash(buffer) }, content: buffer.toString('utf8') };
    } catch (err) {
      const reasons = ['symlink', 'unsafe-path', 'not-file', 'file-too-large', 'byte-budget', 'changed-during-read'];
      result = fail(reasons.includes(err.message) ? err.message : 'unavailable');
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    cache.set(path, result);
    return result;
  };
}

/** Candidate paths only; the reader decides whether they can be used safely. */
export function citedSources(text, limit = MAX_CITED_SOURCES) {
  const paths = [];
  for (const match of String(text || '').slice(0, 32768).matchAll(/`([^`\n]+)`|([^\s`]+)/g)) {
    const candidate = match[1] || match[2].replace(/^[(["']+|[)\],;.!"']+$/g, '');
    if (!/(?:\.(?:ts|tsx|js|mjs|cjs|jsx|py|go|rs|java|kt|rb|php|sql|yaml|yml|json)|(?:^|\/)\.env(?:\.[\w.-]+)?)(?::\d+(?:-\d+)?)?$/.test(candidate)) continue;
    if (!paths.includes(candidate)) paths.push(candidate);
    if (paths.length >= limit) break;
  }
  return paths;
}

/** Stable identity excludes line numbers, discovery order, and content hashes. */
export function semanticClaimId(claim) {
  return `claim.${contentHash(JSON.stringify([
    claim.doc, claim.section, claim.kind, claim.subkind, claim.value, claim.unit,
    String(claim.text || '').replace(/\s+/g, ' ').trim(),
    (claim.citedCode || '').replace(/:\d+(?:-\d+)?$/, ''),
  ])).slice(7)}`;
}

/** Hashes bind a snapshot to its inputs; they are never evidence of review. */
export function taskEvidence(read, doc, citations = [], taskContent = '') {
  const document = read(doc).evidence;
  const citedSourceFiles = [...new Set(citations)].slice(0, MAX_CITED_SOURCES).map(p => read(p).evidence);
  const snapshot = { document, citedSources: citedSourceFiles, taskContentHash: contentHash(taskContent) };
  return {
    kind: 'snapshot', verification: 'unverified', factualAccuracy: 'unknown',
    limitation: SEMANTIC_COVERAGE_LIMITATION,
    ...snapshot,
    sourceCoverage: citedSourceFiles.length && citedSourceFiles.every(s => s.status === 'snapshot') ? 'cited-only' : 'unknown',
    snapshotHash: contentHash(JSON.stringify(snapshot)),
  };
}

/** Two bounded read-only Git queries per artifact, never per task. */
export function gitEvidence(projectDir) {
  const result = { revision: null, dirty: null, status: 'unknown' };
  const options = { cwd: projectDir, encoding: 'utf8', timeout: 1500, maxBuffer: 65536,
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } };
  try {
    const revision = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], options).trim();
    if (/^[a-f0-9]{40,64}$/.test(revision)) result.revision = revision;
  } catch { /* missing Git/revision stays unknown */ }
  try {
    result.dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], options).length > 0;
  } catch { /* dirty state unknown */ }
  if (result.revision !== null && result.dirty !== null) result.status = 'snapshot';
  return result;
}

/** Bounded canonical inventory that does not traverse private or symlink dirs. */
export function evidenceDocs(projectDir, config = {}) {
  const docs = [];
  let directories = 0;
  const walk = (rel) => {
    if (++directories > MAX_EVIDENCE_FILES || docs.length >= MAX_EVIDENCE_FILES) return;
    try {
      if (lstatSync(resolve(projectDir, rel)).isSymbolicLink()) return;
      for (const entry of readdirSync(resolve(projectDir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (docs.length >= MAX_EVIDENCE_FILES) break;
        if (entry.isSymbolicLink() || privateSegment(entry.name)) continue;
        const path = `${rel}/${entry.name}`;
        if (entry.isDirectory() && !entry.name.startsWith('.')) walk(path);
        else if (entry.isFile() && /\.md$/i.test(entry.name)) docs.push(path);
      }
    } catch { /* inventory is heuristic, not proof of coverage */ }
  };
  walk('docs-canonical');
  for (const role of Object.keys(config.docs?.roles || {})) {
    const path = docRolePath(config, role);
    if (/\.md$/i.test(path) && !docs.includes(path)) docs.push(path);
  }
  return docs;
}

/** Canonical docs + root docs, honoring the existing ignore contract. */
function claimSourceDocs(projectDir, read, config) {
  // The legacy matcher reads its file itself; never call it for an unsafe file.
  const isIgnored = read('.docguardignore').content === null ? () => false : loadIgnorePatterns(projectDir);
  return [...evidenceDocs(projectDir, config), 'README.md', 'AGENTS.md'].filter(doc => !isIgnored(doc));
}

/** True if a line is inside a fenced code block (toggled by the caller). */
function findCitedCode(lines, idx) {
  // Search the claim line first, then the immediately adjacent lines. A tight
  // window avoids cross-attributing a path from an unrelated nearby claim (e.g.
  // a rate limit grabbing the retention doc's cited file three lines up).
  for (let d = 0; d <= 1; d++) {
    for (const j of d === 0 ? [idx] : [idx - d, idx + d]) {
      if (j < 0 || j >= lines.length) continue;
      const cited = citedSources(lines[j], 1)[0];
      if (cited) return cited;
    }
  }
  return null;
}

/**
 * Extract semantic claims from a project's canonical docs.
 * @returns {Array<{ doc, line, section, kind, subkind, value, unit, text, citedCode }>}
 */
export function extractSemanticClaims(projectDir, config = {}, read = createEvidenceReader(projectDir)) {
  const claims = [];
  const seen = new Set();

  for (const doc of claimSourceDocs(projectDir, read, config)) {
    const { content } = read(doc);
    if (content === null) continue;
    const lines = content.split('\n');
    let section = '';
    let inFence = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue; // numbers in code samples are examples, not claims
      const h = line.match(/^#{1,6}\s+(.*)$/);
      if (h) { section = h[1].trim(); continue; }

      const lineNo = i + 1;
      const push = (claim) => {
        const key = `${doc}:${lineNo}:${claim.kind}:${claim.value}:${claim.unit || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        if (claims.length >= MAX_CLAIMS) return;
        const candidate = { doc, line: lineNo, section, citedCode: findCitedCode(lines, i), text: line.trim().slice(0, 200), ...claim };
        candidate.stableId = semanticClaimId({ ...candidate, text: line.trim() });
        candidate.evidence = taskEvidence(read, doc, candidate.citedCode ? [candidate.citedCode] : [], line.trim());
        claims.push(candidate);
      };

      for (const { kind, re } of NUMBER_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          push({ kind: 'number', subkind: kind, value: m[1], unit: m[2].toLowerCase() });
        }
      }

      if (ENUM_CONTEXT_RE.test(line) || ENUM_CONTEXT_RE.test(section)) {
        ENUM_LIST_RE.lastIndex = 0;
        let m;
        while ((m = ENUM_LIST_RE.exec(line)) !== null) {
          // Skip all-caps acronym runs joined by slash that are really one token.
          const values = m[0].split(/\s*(?:\/|,|\||\bor\b)\s*/).filter(Boolean);
          if (values.length >= 2) push({ kind: 'enum', subkind: 'enum-list', value: values.join('/'), unit: null });
        }
      }

      if (claims.length >= MAX_CLAIMS) return claims;
    }
  }
  return claims;
}

/**
 * Turn extracted claims into agent-executable verification tasks (one per claim).
 * Pure — reused by the command and any task-graph consumer.
 */
export function buildSemanticVerifyTasks(claims) {
  return claims.map((c, i) => {
    const where = c.citedCode ? ` Start at the cited code: ${c.citedCode}.` : ' No code path is cited nearby — grep the codebase for the relevant constant/config.';
    const what = c.kind === 'enum'
      ? `the enum/status set "${c.value}"`
      : `the ${c.subkind} value ${c.value}${c.unit ? ` ${c.unit}` : ''}`;
    return {
      id: `verify.semantic.${i + 1}`,
      stableId: c.stableId || semanticClaimId(c),
      evidence: c.evidence || taskEvidence(path => ({ evidence: unknownFile(path, 'not-captured') }), c.doc, c.citedCode ? [c.citedCode] : []),
      doc: c.doc,
      line: c.line,
      section: c.section,
      kind: c.kind,
      value: c.value,
      unit: c.unit,
      citedCode: c.citedCode,
      claim: c.text,
      instruction: `Verify ${what} documented in ${c.doc}:${c.line}${c.section ? ` (section "${c.section}")` : ''} against the code.${where} If the code disagrees, the doc (or the code) is wrong — report the mismatch with both values. Attached hashes capture an unverified snapshot; guard does not verify this claim.`,
      confidence: 'requires-human',
    };
  });
}
