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

export function validateTestSpec(projectDir, config) {
  const findings = [];
  let passed = 0;
  let total = 0;
  let note;

  const specDoc = 'docs-canonical/TEST-SPEC.md';
  const testSpecPath = resolve(projectDir, specDoc);
  if (!existsSync(testSpecPath)) {
    // Structure validator catches this. Keep the exact legacy shape here
    // (no `findings` key) — tests deep-equal this early return.
    return { name: 'test-spec', errors: [], warnings: [], passed: 0, total: 0 };
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
  const mapSection = content.match(/## (?:Service-to-Test Map|Source-to-Test Map)[\s\S]*?(?=\n## |$)/);
  if (mapSection) {
    const splitRow = (line) => {
      const parts = line.split('|');
      parts.shift();   // text before the first pipe
      parts.pop();     // text after the last pipe
      return parts.map(s => s.trim());
    };
    const pipeRows = mapSection[0]
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
    // checked as a missing test file (false positive; field test: wu-whatsappinbox).
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
    // 1. Check top-level test dirs
    const commonTestDirs = ['tests', 'test', '__tests__', 'spec'];
    const hasTestDir = commonTestDirs.some(d =>
      existsSync(resolve(projectDir, d))
    );

    // 2. Check co-located tests (honors config.sourceRoot + workspaces)
    let hasColocated = false;
    if (!hasTestDir) {
      for (const rootPath of resolveSourceRoots(projectDir, config)) {
        if (hasTestFilesRecursive(rootPath)) { hasColocated = true; break; }
      }
    }

    // 3. Check vitest/jest config for custom patterns
    let hasConfigTests = false;
    if (!hasTestDir && !hasColocated) {
      const configs = ['vitest.config.ts', 'vitest.config.js', 'jest.config.ts', 'jest.config.js'];
      hasConfigTests = configs.some(f => existsSync(resolve(projectDir, f)));
    }

    if (hasTestDir || hasColocated || hasConfigTests) {
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

  const res = { name: 'test-spec', ...resultFromFindings(findings, { passed, total }) };
  if (note) res.note = note;
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
      } else if (/\.(test|spec)\.[^.]+$/.test(entry)) {
        return true;
      }
    } catch { continue; }
  }
  return false;
}
