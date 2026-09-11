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
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, basename, extname } from 'node:path';
import { TRACE_MAP, TEST_PATTERNS, isTraceableSource } from '../shared-trace-patterns.mjs';
import { walkFiles as sharedWalkFiles, listCanonicalDocs } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { tokenize } from '../shared-diff.mjs';
import { rankBySimilarity } from '../shared-ir.mjs';
import { parseJsTs, walk } from '../scanners/js-ast.mjs';

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

// A test directory also contains fixtures and configuration. Only source files
// are eligible for annotations or candidate-test similarity hints.
function isTestSource(file) {
  return /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|sh)$/.test(file)
    && (TEST_PATTERNS.some(pattern => pattern.test(file)) || /(?:^|\/)(?:__tests__|tests?)\//.test(file));
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


// ──── Default requirement ID patterns ────
// Users can override via config.traceability.requirementPattern
// Includes spec-kit standard IDs: FR-xxx, SC-xxx, T-xxx
const DEFAULT_REQ_PATTERNS = [
  /\b(REQ)-(\d{2,4})\b/g,
  /\b(FR)-(\d{2,4})\b/g,
  /\b(NFR)-(\d{2,4})\b/g,
  /\b(US)-(\d{2,4})\b/g,
  /\b(STORY)-(\d{2,4})\b/g,
  /\b(AC)-(\d{2,4})\b/g,
  /\b(UC)-(\d{2,4})\b/g,
  /\b(SYS)-(\d{2,4})\b/g,
  /\b(ARCH)-(\d{2,4})\b/g,
  /\b(MOD)-(\d{2,4})\b/g,
  /\b(SC)-(\d{2,4})\b/g,     // Spec Kit: Success Criteria
  // Spec Kit task IDs (T001, T002). Unlike the hyphenated IDs above, a bare
  // `T350` over-matches prose (timeouts, model names, status codes), forcing
  // spurious "untraced requirement" warnings. Anchor to the two contexts where
  // a real task ID actually appears: a markdown checklist marker (`- [ ] T001`,
  // the spec-kit tasks.md format) or a test annotation (`@req T001`/`@task`).
  /(?<=\[[ xX]\]\s|@(?:req|task|covers)\s)(T)(\d{3,4})\b/g,
];

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

  return resultFromFindings(findings, { passed, total });
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
  const customPattern = config.traceability?.requirementPattern;
  const patterns = customPattern
    ? [new RegExp(customPattern, 'g')]
    : DEFAULT_REQ_PATTERNS;

  // ── Step 1: Collect requirement IDs from documentation ──
  const reqIds = collectRequirementIds(projectDir, config, patterns);

  // ── Step 2: Scan test files for requirement ID references ──
  const testRefs = scanTestFilesForReferences(projectDir, projectFiles, patterns);

  // ── Step 3: Report traceability results ──

  // IR soft-link recovery (feat 5): build the tokenized test corpus once, only
  // if there are untraced requirements to match. Threshold is deliberately low
  // — short requirement text vs a whole test file yields modest cosine scores;
  // the hint is a suggestion, not proof.
  const softThreshold = config.traceability?.irSoftThreshold ?? 0.10;
  let testCorpus = null;

  // Check each documented requirement has at least one test reference
  for (const [reqId, location] of reqIds) {
    total++;
    if (testRefs.has(reqId)) {
      passed++;
    } else {
      // Try to recover a likely-but-unannotated test via TF-IDF cosine.
      let softHint = '';
      let softText = `Review existing tests for this requirement. If a test verifies it, add an @req ${reqId} annotation or requirement ID test label; write a test only if behavioral coverage is actually missing.`;
      const queryText = location.text && location.text.length > reqId.length ? location.text : reqId;
      if (testCorpus === null) testCorpus = buildTestCorpus(projectDir, projectFiles);
      if (testCorpus.length > 0) {
        const ranked = rankBySimilarity(tokenize(queryText), testCorpus);
        const top = ranked[0];
        if (top && top.score >= softThreshold) {
          const pct = (top.score * 100).toFixed(0);
          softHint = ` — IR soft-match: ${top.id} (${pct}% similar) may already cover it`;
          softText = `Review ${top.id} as a candidate (${pct}% text similarity, not coverage evidence). Add @req ${reqId} only if it verifies the requirement; otherwise inspect other tests before deciding a new test is needed.`;
        }
      }
      findings.push(mkFinding({
        code: 'TRC004',
        validator: 'traceability',
        severity: 'warn',
        message: `Requirement ${reqId} (${location.file}:${location.line}) has no recognized test annotation or label; behavioral coverage is unknown.${softHint}`,
        location: `${location.file}:${location.line}`,
        suggestion: { kind: 'review', text: softText },
      }));
    }
  }

  // Check for orphaned test refs (tests referencing non-existent requirements)
  for (const [reqId, refs] of testRefs) {
    if (!reqIds.has(reqId)) {
      total++;
      findings.push(mkFinding({
        code: 'TRC005',
        validator: 'traceability',
        severity: 'warn',
        message: `Test references ${reqId} (${refs[0].file}:${refs[0].line}) but no requirement ` +
          `with this ID exists in documentation. Remove the reference or add the requirement to docs`,
        location: `${refs[0].file}:${refs[0].line}`,
        suggestion: { kind: 'review', text: 'Remove the stale reference, or add the requirement to the documentation' },
      }));
    }
  }

  return { findings, passed, total };
}

function collectRequirementIds(projectDir, config, patterns) {
  const reqIds = new Map(); // reqId → { file, line }
  const docSearchPaths = getRequirementDocPaths(projectDir, config);

  for (const docPath of docSearchPaths) {
    if (!existsSync(docPath)) continue;

    const content = readFileSync(docPath, 'utf-8');

    // Fast early-return: skip expensive string split if no requirement patterns exist
    const hasMatch = patterns.some(p => { p.lastIndex = 0; return p.test(content); });
    if (!hasMatch) continue;

    const lines = content.split('\n');
    const docName = relative(projectDir, docPath);

    let fence = null;
    let exampleLevel = null;
    let inComment = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (/^(?: {4}|\t)/.test(line) && !fence && !inComment) continue;
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length
          && line.slice(marker[0].length).trim() === '') fence = null;
        continue;
      }
      if (marker) { fence = marker[1]; continue; }
      // Comments and fenced examples cannot define requirements. Preserve
      // physical line numbers instead of scanning a compacted document.
      line = line.replace(/<!--[\s\S]*?-->/g, '');
      if (inComment) {
        const close = line.indexOf('-->');
        if (close < 0) continue;
        line = line.slice(close + 3);
        inComment = false;
      }
      const open = line.indexOf('<!--');
      if (open >= 0) { line = line.slice(0, open); inComment = true; }
      const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)/);
      if (heading) {
        if (exampleLevel !== null && heading[1].length <= exampleLevel) exampleLevel = null;
        if (exampleLevel === null && /^(?:(?:requirement|task)[ -]+)?(?:examples?|ID[ -]+(?:formats?|syntax|examples?)|(?:formats?|syntax)[ -]+(?:of[ -]+)?IDs?)\b/i.test(heading[2])) {
          exampleLevel = heading[1].length;
        }
      }
      if (exampleLevel !== null) continue;
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line)) !== null) {
          // Definitions lead a line, heading, list item or first table cell.
          // Later prose references must not satisfy a missing requirement ID.
          const prefix = line.slice(0, match.index);
          if (!/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|\|\s*)?[\s*`_]*$/.test(prefix)) {
            if (!match[0].length) pattern.lastIndex++;
            continue;
          }
          const reqId = match[0];
          if (!reqId.length) { pattern.lastIndex++; continue; }
          if (!reqIds.has(reqId)) {
            reqIds.set(reqId, { file: docName, line: i + 1, text: line.trim() });
          }
        }
      }
    }
  }

  return reqIds;
}

// A mention in fixture data is not a coverage declaration. Keep the same ID
// patterns, but apply them only to annotations and test labels. In particular,
// prose discussing an annotation ("never annotates @req ...") is not one.
function testDeclarations(content, filename) {
  const declarations = [];
  const comment = (text, line) => {
    for (const [offset, raw] of text.split('\n').entries()) {
      const body = raw.replace(/^\s*\*?\s*/, '');
      if (/^(?:@(?:req|task|covers)\s|Testing\s)/i.test(body)) {
        declarations.push({ text: body, line: line + offset });
      }
    }
  };
  const labelName = /^(?:test|it|describe|context|specify|Run|DisplayName)$/;
  const ext = extname(filename);
  if (/^\.(?:[cm]?[jt]s|[jt]sx)$/.test(ext)) {
    const { ast, ok } = parseJsTs(content, filename);
    if (ok) {
      for (const c of ast.comments || []) comment(c.value, c.loc.start.line);
      const isLabelCall = (callee) => {
        if (callee?.type === 'Identifier') return labelName.test(callee.name);
        if (callee?.type !== 'MemberExpression' || callee.computed) return false;
        return labelName.test(callee.property.name)
          || (/^(?:only|skip|todo|concurrent|serial)$/.test(callee.property.name)
            && isLabelCall(callee.object));
      };
      walk(ast.program, node => {
        if (node.type !== 'CallExpression' || !isLabelCall(node.callee)) return;
        const label = node.arguments[0];
        if (label?.type === 'StringLiteral'
          || (label?.type === 'TemplateLiteral' && label.expressions.length === 0)) {
          // Scan source spelling to retain physical lines and custom patterns.
          declarations.push({ text: content.slice(label.start + 1, label.end - 1), line: label.loc.start.line });
        }
      });
      return declarations.sort((a, b) => a.line - b.line);
    }
  }

  // Other languages, and JS/TS without the optional parser: lex comments and
  // strings together so comment-like text inside a fixture stays opaque.
  // This is deliberately a best-effort tier, like the multilingual scanners.
  const tokens = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|\#[^\n]*|"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g;
  const hashComments = /\.(?:py|rb|php|sh)$/.test(ext);
  let end = 0;
  let line = 1;
  let code = '';
  for (const token of content.matchAll(tokens)) {
    const gap = content.slice(end, token.index);
    line += (gap.match(/\n/g) || []).length;
    code += gap;
    const text = token[0];
    if (text.startsWith('//') || text.startsWith('/*') || (hashComments && text.startsWith('#'))) {
      comment(text.replace(/^(?:\/\/|\/\*|#)/, ''), line);
    } else if (/^["'`]/.test(text)
      && /\b(?:test|it|describe|context|specify|Run|DisplayName)(?:\.(?:only|skip|todo|concurrent|serial))*\s*\(?\s*$/.test(code)) {
      declarations.push({ text: text.slice(1, -1), line });
    }
    line += (text.match(/\n/g) || []).length;
    // Strings must break a possible label prefix; comments are whitespace.
    code = text.startsWith('/') || text.startsWith('#') ? code + ' ' : ';';
    end = token.index + text.length;
  }
  return declarations;
}

function scanTestFilesForReferences(projectDir, projectFiles, patterns) {
  const testFiles = projectFiles.filter(isTestSource);

  const testRefs = new Map(); // reqId → [{ file, line }]

  for (const relPath of testFiles) {
    const fullPath = resolve(projectDir, relPath);
    if (!existsSync(fullPath)) continue;

    let content;
    try { content = readFileSync(fullPath, 'utf-8'); } catch { continue; }

    // Fast early-return: skip expensive string split if no requirement patterns exist
    const hasMatch = patterns.some(p => { p.lastIndex = 0; return p.test(content); });
    if (!hasMatch) continue;

    for (const declaration of testDeclarations(content, relPath)) {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(declaration.text)) !== null) {
          if (!match[0]) { pattern.lastIndex++; continue; }
          const reqId = match[0];
          if (!testRefs.has(reqId)) testRefs.set(reqId, []);
          const line = declaration.line + (declaration.text.slice(0, match.index).match(/\n/g) || []).length;
          testRefs.get(reqId).push({ file: relPath, line });
        }
      }
    }
  }

  return testRefs;
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
