import { docRolePath, resolveDocRole } from '../shared-doc-roles.mjs';
import { roleDocument } from '../shared-doc-role-hint.mjs';
/**
 * Test Spec Validator — Checks that tests exist per TEST-SPEC.md coverage rules
 * Now respects projectTypeConfig (e.g., skip E2E for CLI tools)
 *
 * v0.29: migrated to structured findings (TSP001–TSP007). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings, so counts, exit codes, and
 * existing tests are unaffected; guard just renders richer output.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveSourceRoots } from '../shared-source.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { contractFields } from '../shared-result-contract.mjs';

/**
 * The tests a project has, by the three signals Test-Spec uses: a top-level
 * test directory, co-located test files under a source root, or a Vitest/Jest
 * configuration. Returns what it found, or null when the project has none.
 */
function detectTests(projectDir, config) {
  // 1. Check top-level test dirs
  // Match by normalised name rather than exact spelling: `Tests/`, `testing/`,
  // `e2e/` and `integration/` are the same signal as `tests/`, and probing for
  // literal names was case-insensitive only by accident (it matched on macOS
  // and not on Linux, so CI and a laptop disagreed).
  const TEST_DIR_NAMES = new Set([
    'tests', 'test', 'spec', 'specs', 'testing',
    'e2e', 'integration', 'unit', 'acceptance',
  ]);
  const normaliseDir = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  let testDir = null;
  try {
    testDir = readdirSync(projectDir, { withFileTypes: true })
      .find(e => e.isDirectory() && TEST_DIR_NAMES.has(normaliseDir(e.name)))?.name || null;
  } catch { /* unreadable root: fall through to the other signals */ }
  if (testDir) return { evidence: `the test directory ${testDir}/` };

  // 2. Check co-located tests (honors config.sourceRoot + workspaces)
  for (const rootPath of resolveSourceRoots(projectDir, config)) {
    if (hasTestFilesRecursive(rootPath)) return { evidence: 'co-located *.test.* / *.spec.* files under a source root' };
  }

  // 3. Check vitest/jest config for custom patterns
  const configs = ['vitest.config.ts', 'vitest.config.js', 'jest.config.ts', 'jest.config.js'];
  const found = configs.find(f => existsSync(resolve(projectDir, f)));
  return found ? { evidence: `the test runner configuration ${found}` } : null;
}

/**
 * Whether Test-Spec's kind of check belongs to the project: it applies when the
 * project has tests to map (see `detectTests`), whether or not TEST-SPEC.md
 * exists yet, and when a TEST-SPEC.md exists whatever the project holds. A
 * project with no tests and no test spec has nothing to map.
 * @implements docguard.strict-by-default#FR-006
 */
export function applies(projectDir, config = {}) {
  const specPath = resolveDocRole(projectDir, config, 'testSpec');
  if (existsSync(specPath)) return { applies: true, evidence: `${docRolePath(config, 'testSpec')} exists` };
  const tests = detectTests(projectDir, config);
  return tests
    ? { applies: true, evidence: `the project has tests (${tests.evidence}) and no ${docRolePath(config, 'testSpec')}` }
    : { applies: false, evidence: `no test directory (tests/, test/, spec/, e2e/ and similar), no co-located *.test.* or *.spec.* file and no Vitest or Jest configuration, and no ${docRolePath(config, 'testSpec')}` };
}

function testSpecContract(projectDir, config, { performed, found, mapped }) {
  const specDoc = docRolePath(config, 'testSpec');
  return contractFields({
    performed, found, ran: `checked ${performed} row(s) of the Source-to-Test Map and journeys of ${specDoc} against the files on disk`,
    decide: () => applies(projectDir, config),
    empty: (decision) => {
      if (!decision.applies) return { note: `Test-Spec found no tests and no ${specDoc}, so there is no test mapping to check.`, howToConfigure: `Nothing to configure unless the project has tests: then map them in ${specDoc}.` };
      if (!existsSync(resolveDocRole(projectDir, config, 'testSpec'))) {
        const role = roleDocument(projectDir, config, 'testSpec');
        const table = '"## Source-to-Test Map" table (the older "## Service-to-Test Map" heading is read too), `| Source File | Unit Test | Status |`, one row per source file and its test file';
        return { emptyCause: 'needs-declaration', note: `Test-Spec found tests (${decision.evidence}) but no ${specDoc}, so it checked no mapping.`, howToConfigure: role.lead ? `${role.lead}The document needs a ${table}.` : `Create ${specDoc} with a ${table} (\`docguard generate\` drafts the document).` };
      }
      return mapped
        ? { emptyCause: 'needs-content', note: `The Source-to-Test Map in ${specDoc} has a table but no row Test-Spec could check (a row needs a source file path or a test file path).`, howToConfigure: `Add a row for each source file to the Source-to-Test Map (or the older Service-to-Test Map) in ${specDoc}: \`| src/a.js | tests/a.test.js | ✅ |\`; Test-Spec checks that both files exist.` }
        : { emptyCause: 'needs-declaration', note: `${specDoc} declares no service-to-test mappings, so Test-Spec checked no source or test file.`, howToConfigure: `Add a "## Source-to-Test Map" table (or the older "## Service-to-Test Map") to ${specDoc}: column 1 the source, column 2 the test file, the last column the status (\`| Source File | Unit Test | Status |\`); \`docguard explain testSpec\` describes the shapes it reads.` };
    },
  });
}

/**
 * The sections of a test spec that map sources to tests: a heading of level 2 to 4, optionally numbered
 * ("### 2. Service-to-Test Map"), named "Source-to-Test Map" or the older "Service-to-Test Map", up to the
 * next heading of the same or a higher level.
 */
function findMapSections(content) {
  const lines = content.split('\n');
  const sections = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = /^(#{2,4})[ \t]+(?:\d+[.)]?[ \t]+)?(?:Service|Source)[- ]to[- ]Test Map\b/i.exec(lines[i]);
    if (!heading) continue;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const next = /^(#{1,6})[ \t]/.exec(lines[j]);
      if (next && next[1].length <= heading[1].length) { end = j; break; }
    }
    sections.push(lines.slice(i, end).join('\n'));
    i = end - 1;
  }
  return sections;
}

export function validateTestSpec(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;
  let note;

  const specDoc = docRolePath(config, 'testSpec');
  const testSpecPath = resolveDocRole(projectDir, config, 'testSpec');
  if (!existsSync(testSpecPath)) {
    // Structure validator catches this. Keep the exact legacy shape here
    // (no `findings` key) — tests deep-equal this early return.
    return { name: 'test-spec', errors: [], warnings: [], passed: 0, total: 0, ...testSpecContract(projectDir, config, { performed: 0, found: false, mapped: false }) };
  }

  const content = readFileSync(testSpecPath, 'utf-8');
  const ptc = config.projectTypeConfig || {};

  // Parse the Source-to-Test Map (new header) / Service-to-Test Map (old).
  //
  // Column-HEADER-aware: read the header row to locate the source column, the
  // status column, and EVERY test-file column (Unit Test, Integration Test, …),
  // then map each data row by index WITHOUT discarding empty cells. The old
  // parser filtered empty cells — which shifted every column rightward whenever
  // a cell was blank (e.g. an empty Integration Test) — and only ever checked
  // the 2nd column, so the generated 4-column table's Integration Test was
  // never verified (#9). Splitting on the outer pipes and trimming preserves
  // column alignment so a blank cell stays an empty string in its own slot.
  // Every section of that name is read, each with its own header row: a project that kept the old heading and
  // appended a new one has both, and the first one no longer hides the second.
  const mapSections = findMapSections(content);
  const mapSection = mapSections.length > 0;
  for (const sectionText of mapSections) {
    const splitRow = (line) => {
      const parts = line.split('|');
      parts.shift();   // text before the first pipe
      parts.pop();     // text after the last pipe
      return parts.map(s => s.trim());
    };
    const pipeRows = sectionText
      .split('\n')
      .filter(l => l.trim().startsWith('|') && !/^\s*\|[\s|:-]+\|\s*$/.test(l)); // drop the `---` separator
    const headerCells = pipeRows.length ? splitRow(pipeRows[0]) : [];
    const header = headerCells.map(h => h.toLowerCase());

    // Classify columns by header name, with positional fallbacks.
    let sourceIdx = header.findIndex(h => /\bsource\b/.test(h));
    if (sourceIdx < 0) sourceIdx = 0;
    let statusIdx = header.findIndex(h => /\bstatus\b/.test(h));
    if (statusIdx < 0) statusIdx = header.length - 1;
    let testIdxs = header
      .map((h, i) => (/\btest\b|\be2e\b/.test(h) ? i : -1))
      .filter(i => i >= 0 && i !== sourceIdx && i !== statusIdx);
    if (testIdxs.length === 0) {
      const fallback = sourceIdx === 1 ? 0 : 1; // the non-source early column
      if (fallback !== statusIdx && fallback < header.length) testIdxs = [fallback];
    }

    const isPlaceholder = (v) =>
      !v || v === '—' || v.includes('N/A') ||
      ['source file', 'test file', 'unit test', 'integration test', 'e2e test'].includes(v.toLowerCase());

    // Only existence-check a cell that actually LOOKS like a file path: no
    // internal spaces, and either a directory separator or a file extension.
    // A `## Service-to-Test Map` section often holds several sub-tables of
    // different shapes (Controllers, Services, an "Integration Tests" inventory
    // like `| test-file | what it covers |`). Without this guard a prose
    // "what it covers" cell — "Health endpoint with real dependencies" — gets
    // checked as a missing test file (false positive; field test: downstream-project).
    const isPathLike = (v) => !!v && !/\s/.test(v) && (/[\\/]/.test(v) || /\.[A-Za-z0-9]{1,6}$/.test(v));

    for (const row of pipeRows.slice(1)) { // skip the header row
      const cells = splitRow(row);
      const sourceFile = cells[sourceIdx] || '';
      const status = cells[statusIdx] || '';

      // Skip template/example rows and italic placeholder rows.
      if (!sourceFile || sourceFile.startsWith('<!--') || sourceFile === 'Source File' || sourceFile.startsWith('*')) continue;

      // Author-declared gaps (❌/⚠️) are surfaced as warnings. A ✅ glyph is the
      // author's CLAIM, not proof — it is NOT counted as a pass. The real pass
      // comes from the file-existence checks below (code truth, not the glyph).
      if (status.includes('❌')) {
        total++;
        findings.push(mkFinding({
          code: 'TSP001',
          validator: 'testSpec',
          severity: 'warn',
          message: `TEST-SPEC declares ${sourceFile} as ❌ — missing tests`,
          location: specDoc,
          suggestion: { kind: 'fix', text: 'Write the missing tests, then update the row status to ✅' },
        }));
      } else if (status.includes('⚠️')) {
        total++;
        findings.push(mkFinding({
          code: 'TSP002',
          validator: 'testSpec',
          severity: 'warn',
          message: `TEST-SPEC declares ${sourceFile} as ⚠️ — partial coverage`,
          location: specDoc,
          suggestion: { kind: 'fix', text: 'Extend coverage for this source, then update the row status to ✅' },
        }));
      }

      // ── File existence checks ───────────────────────────────────────
      // Verify source file still exists (catch stale map entries).
      const cleanSource = sourceFile.replace(/`/g, '').trim();
      if (cleanSource && cleanSource !== '—' && cleanSource !== 'Source File' && isPathLike(cleanSource)) {
        total++;
        if (existsSync(resolve(projectDir, cleanSource))) {
          passed++;
        } else {
          findings.push(mkFinding({
            code: 'TSP003',
            validator: 'testSpec',
            severity: 'warn',
            confidence: 'low',
            message: `Source-to-Test Map: source file \`${cleanSource}\` not found on disk — stale entry?`,
            location: specDoc,
            suggestion: { kind: 'review', text: 'Update or remove the stale row if the source file moved or was deleted' },
          }));
        }
      }

      // Verify EVERY declared test file exists — Unit Test AND Integration Test
      // (the old parser only checked one column).
      for (const ti of testIdxs) {
        const cleanTest = (cells[ti] || '').replace(/`/g, '').trim();
        if (isPlaceholder(cleanTest) || !isPathLike(cleanTest)) continue;
        total++;
        if (existsSync(resolve(projectDir, cleanTest))) {
          passed++;
        } else {
          findings.push(mkFinding({
            code: 'TSP004',
            validator: 'testSpec',
            severity: 'warn',
            message: `Source-to-Test Map: test file \`${cleanTest}\` not found — referenced by ${cleanSource}`,
            location: specDoc,
            suggestion: { kind: 'fix', text: 'Create the test file, or point the row at the actual test path' },
          }));
        }
      }
    }
  }

  // Parse Critical User Journeys OR Critical CLI Flows
  // Only check E2E journeys if the project type needs E2E
  if (ptc.needsE2E !== false) {
    const journeyMatch = content.match(
      /## Critical (?:User Journeys|CLI Flows)[\s\S]*?\n\|.*\|.*\|.*\|.*\|([\s\S]*?)(?=\n##|\n---|\n$|$)/
    );

    if (journeyMatch) {
      const tableContent = journeyMatch[1];
      const rows = tableContent
        .split('\n')
        .filter(line => line.startsWith('|') && !line.includes('---'));

      for (const row of rows) {
        const cells = row
          .split('|')
          .map(s => s.trim())
          .filter(s => s.length > 0);

        if (cells.length < 4) continue;

        const [num, journey, testFile, status] = cells;
        // Skip template rows (comments), headers
        if (num.startsWith('<!--') || num === '#' || journey.startsWith('<!--')) continue;

        if (status && status.includes('❌')) {
          total++;
          findings.push(mkFinding({
            code: 'TSP005',
            validator: 'testSpec',
            severity: 'warn',
            message: `E2E Journey #${num} (${journey}) — missing test: ${testFile}`,
            location: specDoc,
            suggestion: { kind: 'fix', text: 'Implement the journey test, then update the row status to ✅' },
          }));
          continue;
        }

        // For a ✅ journey, verify the referenced test file(s) actually exist
        // rather than trusting the glyph. Cells may list multiple paths in
        // backticks separated by commas (e.g. `a.test.ts`, `b.test.ts`) and
        // may include "(N suites)" annotations or globs.
        if (testFile && testFile.trim() !== '—' && !testFile.includes('N/A')) {
          const paths = parseTestPathCell(testFile);
          if (paths.length > 0) {
            total++;
            const anyExists = paths.some(p => testEvidenceExists(projectDir, p));
            if (anyExists) {
              passed++;
            } else {
              findings.push(mkFinding({
                code: 'TSP006',
                validator: 'testSpec',
                severity: 'warn',
                message: `E2E Journey #${num} (${journey}) marked ✅ but test file not found: ${paths.join(', ')}`,
                location: specDoc,
                suggestion: { kind: 'review', text: 'Fix the test path in the row, or restore the missing test file' },
              }));
            }
          }
        }
      }
    }
  }

  // If TEST-SPEC.md declared no service-to-test mappings, there is nothing to
  // verify against. Do NOT manufacture a 1/1 pass just because tests exist
  // somewhere — that rendered a confident green ✅ for a doc that mapped nothing.
  if (total === 0) {
    const detected = detectTests(projectDir, config);
    if (detected) {
      // Tests exist but the spec maps none of them → not applicable, not a pass.
      // v0.24: the validator reads column 1 as source, column 2 as the test
      // file, and the last as status — so both the minimal 3-column shape and
      // the 4-column table `docguard generate` emits are accepted. Say so, since
      // the guidance previously contradicted the generated skeleton (field report).
      note = 'TEST-SPEC.md declares no service-to-test mappings. Add a "## Source-to-Test Map" table — column 1 is the source, column 2 the test file, the last column the status. Both `| Source | Test file | Status |` and the generated `| Source File | Unit Test | Integration Test | Status |` shapes work. Run `docguard explain testSpec` for details.';
    } else {
      findings.push(mkFinding({
        code: 'TSP007',
        validator: 'testSpec',
        severity: 'warn',
        message: 'No test directory or co-located test files found. ' +
          'Expected: tests/, src/**/__tests__/, or src/**/*.test.* files',
        location: null,
        suggestion: { kind: 'fix', text: 'Create a tests/ directory or co-located *.test.* files, then map them in TEST-SPEC.md' },
      }));
    }
  }

  const res = { name: 'test-spec', ...resultFromFindings(findings, { passed, total }), ...testSpecContract(projectDir, config, { performed: total, found: findings.length > 0, mapped: Boolean(mapSection) }) };
  // The legacy sentence stays for a project that has tests and a spec that maps none of them; the contract's own
  // sentence replaces it only on an empty result, where the cause says the same with the exact fix.
  if (note && res.note === undefined) res.note = note;
  return res;
}

/**
 * Parse a TEST-SPEC.md table cell into a list of test path strings.
 *
 * Real-world Journey rows commonly list multiple test files in one cell:
 *   `path/a.test.ts`, `path/b.test.ts`
 *   `idor_*.test.ts (3 suites)`
 *
 * Strategy:
 *   1. Split on commas that are OUTSIDE backticks.
 *   2. For each segment: strip backticks, strip trailing "(N suites)" or
 *      "(N tests)" annotations, trim whitespace.
 *   3. Drop empties.
 *
 * The "(N suites)" annotation is preserved as evidence — if a glob like
 * `idor_*.test.ts` doesn't expand to a literal file, testEvidenceExists()
 * accepts the annotation as the author's claim of coverage.
 */
export function parseTestPathCell(cell) {
  if (!cell) return [];
  // Split on commas that are NOT inside backticks. Track backtick parity.
  const segments = [];
  let buf = '';
  let inBackticks = false;
  for (const ch of cell) {
    if (ch === '`') { inBackticks = !inBackticks; buf += ch; continue; }
    if (ch === ',' && !inBackticks) {
      segments.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf) segments.push(buf);

  const result = [];
  for (let seg of segments) {
    seg = seg.replace(/`/g, '').trim();
    if (!seg || seg === '—') continue;
    result.push(seg);
  }
  return result;
}

/**
 * True if a TEST-SPEC.md path segment has supporting evidence on disk.
 *
 * Accepts: exact file match, glob expansion (e.g. `foo_*.test.ts`), or an
 * "(N suites)" / "(N tests)" annotation when the literal path doesn't exist.
 * The annotation is the author's explicit claim of coverage — believe it
 * rather than reject the row outright; the audit trail is in the markdown.
 */
export function testEvidenceExists(projectDir, pathSegment) {
  if (!pathSegment) return false;

  // Strip a trailing "(N suites)" / "(N tests)" annotation for the file check.
  const annotationMatch = pathSegment.match(/\s*\((\d+)\s+(?:suites?|tests?)\)\s*$/i);
  const pathOnly = annotationMatch ? pathSegment.slice(0, annotationMatch.index).trim() : pathSegment;
  const hasAnnotation = !!annotationMatch;

  if (!pathOnly) return hasAnnotation;

  // Glob support — if the segment contains *, ?, or [, walk the parent dir.
  if (/[*?[]/.test(pathOnly)) {
    const matches = expandGlob(projectDir, pathOnly);
    if (matches.length > 0) return true;
    // Glob with annotation but no expansion → trust the annotation.
    return hasAnnotation;
  }

  // Plain path — must exist on disk.
  if (existsSync(resolve(projectDir, pathOnly))) return true;
  // Plain path with explicit annotation → still trust the author's claim.
  return hasAnnotation;
}

/**
 * Minimal glob expansion: only handles the `*` and `?` wildcards in a single
 * path segment. e.g. `backend/src/test-helpers/security/idor_*.test.ts`.
 * Pure Node.js built-ins; zero dependencies.
 */
function expandGlob(projectDir, pattern) {
  const parts = pattern.split('/');
  const start = resolve(projectDir);
  let candidates = [start];
  for (const part of parts) {
    if (!/[*?[]/.test(part)) {
      candidates = candidates.map(c => resolve(c, part)).filter(c => existsSync(c));
      continue;
    }
    const re = globPartToRegex(part);
    const next = [];
    for (const dir of candidates) {
      let entries;
      try { entries = readdirSync(dir); } catch { continue; }
      for (const e of entries) {
        if (re.test(e)) next.push(resolve(dir, e));
      }
    }
    candidates = next;
    if (candidates.length === 0) return [];
  }
  return candidates;
}

function globPartToRegex(part) {
  const escaped = part
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\[/g, '[').replace(/\\\]/g, ']') // restore character classes
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** Recursively check if a directory contains test files */
function hasTestFilesRecursive(dir) {
  const ignore = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
  let entries;
  try { entries = readdirSync(dir); } catch { return false; }
  for (const entry of entries) {
    if (ignore.has(entry) || entry.startsWith('.')) continue;
    const full = resolve(dir, entry);
    try {
      const s = statSync(full);
      if (s.isDirectory()) {
        if (entry === '__tests__' || entry === '__test__') return true;
        if (hasTestFilesRecursive(full)) return true;
      } else if (/\.(test|spec)\.[^.]+$/.test(entry)
        // Go, pytest and Django test files are tests too; missing them reported
        // "no test files" for projects that have them (docguard.generated-docs-consistency#FR-010).
        || /_test\.go$|^test_[^/]+\.py$|_test\.py$|^tests\.py$/.test(entry)) {
        return true;
      }
    } catch { continue; }
  }
  return false;
}
