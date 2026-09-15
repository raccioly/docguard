/**
 * Traceability Validator — Checks that canonical docs are linked to source code
 * 
 * Two modes:
 *   1. Source Traceability: Canonical docs reference actual source files
 *   2. Requirement Traceability (V-Model): Requirement IDs in docs trace to tests
 *
 * Requirement traceability is opt-in by convention — if no requirement IDs are
 * defined or explicitly annotated (REQ-001, FR-001, etc.), the check silently passes. Once you add IDs,
 * DocGuard automatically enforces traceability.
 *
 * Inspired by ISO/IEC/IEEE 29119, IEEE 1016, and V-Model methodology.
 * V-Model concepts informed by spec-kit-v-model (github.com/leocamello/spec-kit-v-model).
 * @implements docguard.document-lifecycle#FR-013
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, basename, extname } from 'node:path';
import { TRACE_MAP, isTraceableSource } from '../shared-trace-patterns.mjs';
import { walkFiles as sharedWalkFiles, listCanonicalDocs } from '../shared-ignore.mjs';
/** @implements docguard.adoption-workflow-integrity#FR-006 */
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { tokenize } from '../shared-diff.mjs';
import { rankBySimilarity } from '../shared-ir.mjs';
import {
  isTestSource,
  resolveRequirementReferences as resolveRequirementReferencesShared,
  scanTestFilesForReferences as scanTestFilesForReferencesShared,
} from '../scanners/requirement-evidence.mjs';
import {
  DEFAULT_REQ_PATTERNS,
  collectRequirementIdsFromContent,
  requirementPatterns,
} from '../shared-requirements.mjs';
import { readRetirementManifest } from '../scanners/retirement-manifest.mjs';
import {
  parseSpecId,
  trustedSpecLifecycleIndex,
  uncommittedPlannedSpecLifecycleIndex,
} from '../scanners/spec-registry.mjs';

/**
 * Optional graphify interop (github.com/Graphify-Labs/graphify, MIT).
 * Teams that commit `graphify-out/graph.json` already carry a knowledge graph
 * whose CODE side is deterministic tree-sitter extraction. If it's there, its
 * doc↔code edges are one more linkage-evidence source for traceability.
 *
 * Trust rules (the determinism anchor):
 *   - ONLY edges tagged confidence:"EXTRACTED" count — INFERRED/AMBIGUOUS
 *     edges can come from graphify's LLM pass and must not vouch for a doc.
 *   - Evidence-only: this can turn a would-be "unlinked doc" into a pass;
 *     it never produces a finding.
 *   - Zero-dep: one JSON read. Any parse/shape mismatch → null (no evidence).
 *
 * @returns {Map<string, Set<string>>|null} doc basename → linked code files
 */
function loadGraphifyDocLinks(projectDir) {
  const p = resolve(projectDir, 'graphify-out', 'graph.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
    // networkx serializes edges as "links"; older graphify exports used "edges".
    const links = Array.isArray(raw.links) ? raw.links
      : Array.isArray(raw.edges) ? raw.edges : [];
    const nodeFile = new Map(); // node id → source_file
    for (const n of nodes) {
      if (n && n.id !== undefined && typeof n.source_file === 'string') {
        nodeFile.set(n.id, n.source_file);
      }
    }
    const docLinks = new Map();
    for (const l of links) {
      if (!l || l.confidence !== 'EXTRACTED') continue;
      const sf = nodeFile.get(l.source);
      const tf = nodeFile.get(l.target);
      if (!sf || !tf) continue;
      for (const [a, b] of [[sf, tf], [tf, sf]]) {
        if (a.endsWith('.md') && !b.endsWith('.md') && isTraceableSource(b)) {
          const doc = basename(a);
          if (!docLinks.has(doc)) docLinks.set(doc, new Set());
          docLinks.get(doc).add(b);
        }
      }
    }
    return docLinks.size > 0 ? docLinks : null;
  } catch {
    return null; // malformed graph = no evidence, never a finding
  }
}

// IR soft-link recovery (feat 5): tokenize test files once so an untraced
// requirement can be matched to the test that most likely already covers it
// (TF-IDF cosine, VSM). Capped so a huge test suite can't blow up guard.
function buildTestCorpus(projectDir, projectFiles, { maxFiles = 250, maxTokens = 400 } = {}) {
  const testFiles = projectFiles.filter(isTestSource).slice(0, maxFiles);
  const corpus = [];
  for (const relPath of testFiles) {
    try {
      const content = readFileSync(resolve(projectDir, relPath), 'utf-8');
      corpus.push({ id: relPath, tokens: tokenize(content).slice(0, maxTokens) });
    } catch { /* skip unreadable */ }
  }
  return corpus;
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.cache', '__pycache__', '.venv', 'vendor', '.turbo', '.vercel',
  '.amplify-hosting', '.serverless',
]);


/**
 * Validate traceability — ensures canonical docs have corresponding source artifacts,
 * and requirement IDs trace through to test files.
 * Respects config.requiredFiles.canonical — only checks docs the user requires.
 *
 * v0.29: migrated to structured findings (TRC001–TRC005). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings array.
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateTraceability(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;

  const docsDir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(docsDir) && getRequirementDocPaths(projectDir, config).length === 0) {
    // No docs-canonical dir at all — structure validator handles this
    return resultFromFindings([], { passed: 0, total: 0 });
  }

  // Build set of required doc basenames from config
  const requiredDocs = new Set(
    (config.requiredFiles?.canonical || []).map(f => basename(f))
  );

  // Scan project files once
  const projectFiles = [];
  scanDir(projectDir, projectDir, projectFiles);

  // Optional graphify interop: a committed knowledge graph is one more
  // deterministic evidence source for doc↔code linkage.
  const graphifyLinks = loadGraphifyDocLinks(projectDir);

  // Scan source files for `// @doc <filename>.md` annotations. An annotation
  // is an explicit author signal that a source file documents (or is
  // documented by) a canonical doc. It is the user-facing escape hatch when
  // a project's directory layout doesn't match the built-in TRACE_MAP globs
  // (e.g. a route file outside any `routes/` / `app/api/` tree). The
  // annotation is also shown in templates and templates/commands docs, so
  // users have been told it works — actually honoring it is the fix here.
  const docAnnotations = scanDocAnnotations(projectFiles, projectDir);

  // ── Part 1: Source Traceability (existing) ──
  for (const [docName, traceInfo] of Object.entries(TRACE_MAP)) {
    // Skip docs not in the user's required list
    if (!requiredDocs.has(docName)) continue;

    const configuredPath = (config.requiredFiles?.canonical || []).find(file => basename(file) === docName);
    const docPath = configuredPath && (configuredPath.includes('/') || existsSync(resolve(projectDir, configuredPath)))
      ? resolve(projectDir, configuredPath) : resolve(docsDir, docName);
    const docExists = existsSync(docPath);
    // Discovering feature specs must not activate missing-canonical findings
    // for a repository without a canonical home. Structure owns that absence.
    if (!existsSync(docsDir) && !docExists) continue;
    total++;

    if (!docExists) {
      findings.push(mkFinding({
        code: 'TRC001',
        validator: 'traceability',
        severity: 'warn',
        message: `${docName} — required but missing, no traceability possible`,
        location: relative(projectDir, docPath),
        suggestion: { kind: 'fix', text: 'Create the required doc from the professional template', command: 'docguard init' },
      }));
      continue;
    }

    // Explicit `// @doc <docName>` annotation counts as a link regardless of
    // whether the file path matches any built-in pattern. Checked first so
    // path-pattern misses don't drown out explicit author intent.
    if (docAnnotations.has(docName) && docAnnotations.get(docName).size > 0) {
      passed++;
      continue;
    }

    // Count matching source files
    // ⚡ Bolt: Fast early return using .some() instead of .filter()
    // v0.24: skip .md files — a doc isn't "linked" just because another doc's
    // name matches the glob (e.g. SECURITY's `guard` matching docguard.guard.md);
    // that masked genuinely unlinked docs (field report).
    let hasSource = false;
    for (const pattern of traceInfo.sourcePatterns) {
      if (projectFiles.some(f => isTraceableSource(f) && pattern.glob.test(f))) {
        hasSource = true;
        break;
      }
    }

    // Graphify interop: an EXTRACTED doc↔code edge in a committed
    // graphify-out/graph.json is author-grade linkage evidence (the graph's
    // code side is deterministic AST extraction). Only trusted when at least
    // one linked code file still exists — a stale graph must not vouch.
    if (!hasSource && graphifyLinks && graphifyLinks.has(docName)) {
      hasSource = [...graphifyLinks.get(docName)]
        .some(f => existsSync(resolve(projectDir, f)) || existsSync(f));
    }

    if (hasSource) {
      passed++;
    } else {
      findings.push(mkFinding({
        code: 'TRC002',
        validator: 'traceability',
        severity: 'warn',
        message: `${docName} — exists but no matching source code found (unlinked doc)`,
        location: relative(projectDir, docPath),
        suggestion: {
          kind: 'fix',
          text: 'Link a source file explicitly with a header annotation if the code lives in a non-standard location',
          pragma: `// @doc ${docName}`,
        },
      }));
    }
  }

  // ── Detect orphaned files (exist but not required) ──
  // Recursive — a nested stray doc must be visible too. TRACE_MAP/requiredDocs
  // matching stays keyed by bare basename (TRACE_MAP's own keys are
  // conventional top-level names); `location` uses the real path so the
  // finding points at the actual file instead of a fabricated flat one — for
  // a flat tree `doc.rel` already equals the old `docs-canonical/${docFile}`
  // template exactly, so this is a no-op on the flat case.
  for (const doc of listCanonicalDocs(projectDir, { config })) {
    const docFile = basename(doc.rel);
    if (!requiredDocs.has(docFile) && TRACE_MAP[docFile]) {
      findings.push(mkFinding({
        code: 'TRC003',
        validator: 'traceability',
        severity: 'warn',
        message: `${docFile} — file exists in docs-canonical/ but is not in your requiredFiles config. Consider deleting it or adding it to .docguard.json requiredFiles.canonical`,
        location: doc.rel,
        suggestion: { kind: 'review', text: 'Delete the doc, or add it to requiredFiles.canonical in .docguard.json so it gets validated' },
      }));
    }
  }

  // ── Part 2: Requirement ID Traceability (V-Model) ──
  const reqResult = validateRequirementTraceability(projectDir, config, projectFiles);
  findings.push(...reqResult.findings);
  passed += reqResult.passed;
  total += reqResult.total;

  const result = resultFromFindings(findings, { passed, total });
  result.requirementCoverage = reqResult.requirementCoverage;
  return result;
}

// ──── Requirement ID Traceability ────────────────────────────────────────────

/**
 * Scan docs for requirement IDs and verify they appear in test files.
 *
 * Behavior:
 *   - If no definitions or test declarations exist → silently passes (0 checks)
 *   - If IDs found → validates each has a matching test reference
 *   - Reports untraced requirements and orphaned test refs
 */
function validateRequirementTraceability(projectDir, config, projectFiles) {
  const findings = [];
  let passed = 0;
  let total = 0;

  // Get requirement patterns (user-configurable or defaults)
  const patterns = requirementPatterns(config);

  // ── Step 1: Collect requirement IDs from documentation ──
  const reqIds = collectRequirementIds(projectDir, config, patterns);
  const retiredReqIds = loadRetiredRequirementIds(projectDir);
  const lifecycleIndex = trustedSpecLifecycleIndex(projectDir);
  const uncommittedPlannedIndex = uncommittedPlannedSpecLifecycleIndex(projectDir);

  // ── Step 2: Scan test files for requirement ID references ──
  const testRefs = scanTestFilesForReferences(projectDir, projectFiles, patterns);
  const resolvedRefs = resolveRequirementReferences(reqIds, testRefs, retiredReqIds);
  const definitionCounts = new Map();
  for (const def of reqIds.values()) definitionCounts.set(def.id, (definitionCounts.get(def.id) || 0) + 1);
  const retiredDefinitionCounts = new Map();
  for (const key of retiredReqIds) {
    const id = key.slice(key.lastIndexOf('#') + 1);
    retiredDefinitionCounts.set(id, (retiredDefinitionCounts.get(id) || 0) + 1);
  }

  // ── Step 3: Report traceability results ──

  // IR soft-link recovery (feat 5): build the tokenized test corpus once, only
  // if there are untraced requirements to match. Threshold is deliberately low
  // — short requirement text vs a whole test file yields modest cosine scores;
  // the hint is a suggestion, not proof.
  const softThreshold = config.traceability?.irSoftThreshold ?? 0.10;
  let testCorpus = null;

  let deferred = 0;
  let lifecycleUnknown = 0;
  // Planned specs are intent awaiting implementation. Only committed,
  // digest-current reviewed lifecycle can defer their test linkage.
  for (const [key, location] of reqIds) {
    const reqId = location.id;
    const lifecycleKey = location.specId ? `${location.specId}\0${location.file}` : null;
    const lifecycle = lifecycleKey ? lifecycleIndex.get(lifecycleKey) : null;
    if (lifecycle?.delivery === 'planned') {
      deferred++;
      continue;
    }
    const uncommittedPlanned = lifecycleKey && uncommittedPlannedIndex.has(lifecycleKey);
    if (location.specId && !lifecycle) lifecycleUnknown++;
    total++;
    if (resolvedRefs.has(key)) {
      passed++;
    } else {
      // Try to recover a likely-but-unannotated test via TF-IDF cosine.
      let softHint = '';
      let softText = uncommittedPlanned
        ? 'The on-disk lifecycle registry says this requirement is planned, but .docguard-specs.json is not a clean tracked Git artifact. Restore it to its committed state, or commit the registry and its current spec artifacts, before treating the requirement as deferred; do not add an @req marker merely to silence this warning.'
        : `Review existing tests for this requirement. If a test verifies it, add an @req ${key} annotation or requirement ID test label; write a test only if behavioral coverage is actually missing.`;
      const queryText = location.text && location.text.length > reqId.length ? location.text : reqId;
      if (!uncommittedPlanned && testCorpus === null) testCorpus = buildTestCorpus(projectDir, projectFiles);
      if (!uncommittedPlanned && testCorpus.length > 0) {
        const ranked = rankBySimilarity(tokenize(queryText), testCorpus);
        const top = ranked[0];
        if (top && top.score >= softThreshold) {
          const pct = (top.score * 100).toFixed(0);
          softHint = ` — IR soft-match: ${top.id} (${pct}% similar) may already cover it`;
          softText = `Review ${top.id} as a candidate (${pct}% text similarity, not coverage evidence). Add @req ${key} only if it verifies the requirement; otherwise inspect other tests before deciding a new test is needed.`;
        }
      }
      findings.push(mkFinding({
        code: 'TRC004',
        validator: 'traceability',
        severity: 'warn',
        message: `Requirement ${reqId} (${location.file}:${location.line}) has no recognized test annotation or label; behavioral coverage is unknown.${definitionCounts.get(reqId) > 1 ? ` This ID occurs in multiple documents; use ${key} to disambiguate test references.` : ""}${softHint}`,
        location: `${location.file}:${location.line}`,
        suggestion: { kind: 'review', text: softText },
      }));
    }
  }
  const applicableRequirements = total;
  const tracedRequirements = passed;

  // Check for orphaned test refs (tests referencing non-existent requirements)
  for (const [reqId, refs] of testRefs) {
    const orphan = refs.find(ref => ref.scope
      ? resolveRequirementReferences(reqIds, new Map([[reqId, [ref]]]), retiredReqIds).size === 0
      : !definitionCounts.has(reqId) && !retiredDefinitionCounts.has(reqId));
    if (orphan) {
      total++;
      findings.push(mkFinding({
        code: 'TRC005',
        validator: 'traceability',
        severity: 'warn',
        message: `Test references ${orphan.scope ? `${orphan.scope}#` : ""}${reqId} (${orphan.file}:${orphan.line}) but no requirement ` +
          `with this ID exists in documentation. Remove the reference or add the requirement to docs`,
        location: `${orphan.file}:${orphan.line}`,
        suggestion: { kind: 'review', text: 'Remove the stale reference, or add the requirement to the documentation' },
      }));
    }
  }

  return {
    findings, passed, total,
    requirementCoverage: {
      discovered: reqIds.size,
      applicable: applicableRequirements,
      traced: tracedRequirements,
      missing: findings.filter(finding => finding.code === 'TRC004').length,
      deferred,
      lifecycleUnknown,
    },
  };
}

/**
 * Retired requirement identities remain known without restoring obsolete prose
 * to active context. Invalid manifests supply no evidence; Document-Lifecycle
 * reports their integrity failure separately.
 */
function loadRetiredRequirementIds(projectDir) {
  const manifest = readRetirementManifest(projectDir);
  if (!manifest.ok) return new Set();
  const ids = new Set();
  for (const entry of manifest.entries) {
    if (!Array.isArray(entry.requirementIds)) continue;
    const path = entry.path.replaceAll('\\', '/').replace(/^\.\//, '');
    for (const id of entry.requirementIds) {
      if (typeof id === 'string' && id.length <= 128 && /^[^\s#\0]+$/.test(id)) {
        ids.add(`${path}#${id}`);
      }
    }
  }
  return ids;
}

export function collectRequirementIds(projectDir, config, patterns = DEFAULT_REQ_PATTERNS) {
  const reqIds = new Map(); // reqId → { file, line }
  const docSearchPaths = getRequirementDocPaths(projectDir, config);

  for (const docPath of docSearchPaths) {
    if (!existsSync(docPath)) continue;

    const docName = relative(projectDir, docPath).replaceAll("\\", "/");
    const content = readFileSync(docPath, 'utf-8');
    const specId = parseSpecId(content);
    for (const [key, definition] of collectRequirementIdsFromContent(content, docName, patterns)) {
      if (!reqIds.has(key)) reqIds.set(key, { ...definition, specId });
    }
  }

  return reqIds;
}

/** Resolve positive test links without sharing evidence between document scopes. */
export function resolveRequirementReferences(definitions, references, retiredDefinitions = new Set()) {
  return resolveRequirementReferencesShared(definitions, references, retiredDefinitions);
}

/**
 * Read explicit requirement annotations and test labels from eligible test sources.
 * Shared by validation and feature scoring; fixture data is not linkage evidence.
 * Callers supply project-relative candidate paths and global requirement regexes.
 * No files are written and no findings or suppression policy are consulted.
 * @returns {Map<string, Array<{file: string, line: number}>>} ID to declaration locations
 */
export function scanTestFilesForReferences(projectDir, projectFiles, patterns) {
  return scanTestFilesForReferencesShared(projectDir, projectFiles, patterns);
}

/**
 * Get all file paths where requirement IDs might be defined.
 * Checks: docs-canonical/*.md, spec.md, REQUIREMENTS.md, specs/[feature]/spec.md
 */
function getRequirementDocPaths(projectDir, config) {
  const paths = [];

  // docs-canonical/ directory — recursive. Consumer re-derives the display
  // path via relative(projectDir, docPath), so nested docs already report
  // their real path with no further change needed there.
  for (const doc of listCanonicalDocs(projectDir, { config })) paths.push(doc.abs);

  // Root-level docs
  const rootDocs = ['REQUIREMENTS.md', 'spec.md', 'README.md'];
  for (const doc of rootDocs) {
    const p = resolve(projectDir, doc);
    if (existsSync(p)) paths.push(p);
  }

  // User-configured requirement docs
  const configDocs = [...(config.requiredFiles?.canonical || []), ...(config.traceability?.requirementDocs || [])];
  for (const doc of configDocs) {
    const p = resolve(projectDir, doc);
    const rel = relative(projectDir, p);
    if (rel === '..' || rel.startsWith('../') || rel.split(/[\\/]/).includes('.local')) continue;
    try {
      if (statSync(p).isFile() && !paths.includes(p)) paths.push(p);
      else if (statSync(p).isDirectory()) {
        for (const entry of listCanonicalDocs(projectDir, { dirName: doc, config: {} })) {
          if (!paths.includes(entry.abs)) paths.push(entry.abs);
        }
      }
    } catch { /* Structural validators own missing or unreadable doc paths. */ }
  }

  // Spec Kit artifacts: .specify/specs/*/spec.md (v3+) and specs/*/spec.md (legacy)
  const specKitDirs = [
    resolve(projectDir, '.specify', 'specs'),  // v3+ standard
    resolve(projectDir, 'specs'),               // legacy
  ];
  for (const specsDir of specKitDirs) {
    if (existsSync(specsDir)) {
      try {
        for (const feature of readdirSync(specsDir)) {
          const specPath = join(specsDir, feature, 'spec.md');
          if (existsSync(specPath) && !paths.includes(specPath)) paths.push(specPath);
        }
      } catch { /* ignore */ }
    }
  }

  return paths;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Scan code files for `// @doc <name>.md` annotations. Returns a Map from
 * canonical doc basename → Set of source file paths that annotate it.
 *
 * Annotation forms accepted:
 *   - `// @doc API-REFERENCE.md`
 *   - `// @doc docs-canonical/API-REFERENCE.md`  (basename is what matters)
 *   - `/* @doc API-REFERENCE.md *​/`              (block comment, single line)
 *   - `# @doc API-REFERENCE.md`                  (Python / Ruby comment style)
 *
 * Only the basename of the referenced doc is keyed; callers compare against
 * the doc basename (e.g. `API-REFERENCE.md`). We cap how many files we open
 * to keep this scan O(N) and stop reading the rest of a file after the
 * first 4 KB — annotations belong at the top of a file by convention, and
 * reading every byte of every source file just to find a header comment
 * would balloon scan time on large monorepos.
 */
function scanDocAnnotations(projectFiles, projectDir) {
  const map = new Map();
  const annotationRe = /(?:\/\/|\/\*|#)\s*@doc\s+(\S+\.md)/g;
  const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java']);
  const HEAD_BYTES = 4096;

  for (const relPath of projectFiles) {
    const ext = extname(relPath);
    if (!CODE_EXT.has(ext)) continue;
    const full = resolve(projectDir, relPath);
    let content;
    try { content = readFileSync(full, 'utf-8'); } catch { continue; }
    // Annotations live near the top of the file. Slicing avoids reading
    // megabytes of bundled / minified output looking for a header comment.
    const head = content.length > HEAD_BYTES ? content.slice(0, HEAD_BYTES) : content;
    if (!head.includes('@doc')) continue;
    annotationRe.lastIndex = 0;
    let m;
    while ((m = annotationRe.exec(head)) !== null) {
      const docName = basename(m[1]);
      if (!map.has(docName)) map.set(docName, new Set());
      map.get(docName).add(relPath);
    }
  }
  return map;
}

// v0.29 consolidation: traversal delegates to the shared canonical walker.
// keepDot preserves the traceability-relevant dot entries (.env, .env.example,
// .gitignore, .github/) that a doc may legitimately reference.
function scanDir(rootDir, dir, files) {
  sharedWalkFiles(dir, (full) => files.push(relative(rootDir, full)), {
    ignoreDirs: IGNORE_DIRS,
    keepDot: (entry) => entry === '.env' || entry === '.env.example'
      || entry === '.gitignore' || entry.startsWith('.github'),
  });
}
