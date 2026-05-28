/**
 * Explain Command — v0.16-P6.
 *
 * Asked for by a user who'd spent 5-10 minutes per warning spelunking
 * through validators/*.mjs source to understand what the validator wanted.
 * `docguard explain "<warning text>"` matches the warning back to its
 * validator and prints:
 *   - Which validator emitted it
 *   - What pattern triggered it
 *   - A passing example
 *   - The doc / spec / standard it's checking against
 *
 * Also supports `docguard explain <validator-key>` to show the whole
 * validator's purpose without needing a specific warning.
 *
 * Zero NPM dependencies. Pure lookup table.
 */

import { c } from '../shared.mjs';

/**
 * Validator-key → human-readable explainer. Keyed by the same key DocGuard
 * uses internally for severity overrides + lite-mode selection.
 *
 * Each entry has:
 *   - title:    one-line summary
 *   - what:     what the validator checks (declarative)
 *   - why:      why it matters (motivation)
 *   - triggers: array of common warning fragments and what each means
 *   - example:  a tiny passing snippet
 *   - standard: the spec/practice the validator references
 */
const EXPLAINERS = {
  structure: {
    title: 'Structure — required CDD files exist',
    what: 'Verifies the canonical files declared in .docguard.json `requiredFiles.canonical` are present, plus AGENTS.md/CLAUDE.md, CHANGELOG.md, DRIFT-LOG.md.',
    why:  'A documentation memory needs known anchor points. Missing files = broken memory.',
    triggers: [
      ['Missing required file', 'A canonical doc declared in your config doesn\'t exist on disk. Create it or remove it from `requiredFiles.canonical`.'],
      ['Missing agent file', 'No AGENTS.md or CLAUDE.md found. Create one — even a stub establishes the agent contract.'],
    ],
    example: 'docs-canonical/ARCHITECTURE.md, AGENTS.md, CHANGELOG.md all present',
    standard: 'CDD STANDARD (this project\'s STANDARD.md)',
  },
  docsSync: {
    title: 'Docs-Sync — code files are referenced in canonical docs',
    what: 'Walks route/service files in your source tree. For each, checks that the file path or basename appears in any canonical doc.',
    why:  'Code that exists but isn\'t mentioned in any doc is invisible to future contributors and AI agents.',
    triggers: [
      ['not referenced in any canonical doc', 'A route or service file has no mention anywhere in docs-canonical/. Add a one-line reference (path or filename) to ARCHITECTURE.md or DATA-MODEL.md.'],
    ],
    example: '`src/services/auth.ts` mentioned in ARCHITECTURE.md\'s Components table',
    standard: 'arc42 Component Map',
  },
  drift: {
    title: 'Drift-Comments — every `// DRIFT:` has a DRIFT-LOG entry',
    what: 'Scans code for `// DRIFT: reason` comments (also # / /* / -- variants). Each must have a row in DRIFT-LOG.md.',
    why:  'DRIFT comments document conscious deviations from canonical specs. Without log entries, the deviation is invisible.',
    triggers: [
      ['DRIFT comment but DRIFT-LOG.md doesn\'t exist', 'Create DRIFT-LOG.md or remove the DRIFT comment.'],
      ['no matching DRIFT-LOG.md entry', 'Add a row to DRIFT-LOG.md documenting the deviation, OR remove the // DRIFT: comment if the deviation is no longer current.'],
    ],
    example: '// DRIFT: using S3 SDK v2 here for compatibility — DRIFT-LOG.md has a row dated and explaining why',
    standard: 'CDD principle: log every intentional deviation',
  },
  changelog: {
    title: 'Changelog — Keep a Changelog format',
    what: 'CHANGELOG.md must have a top-level `# Changelog` heading and an `## [Unreleased]` section.',
    why:  'Standard format makes changelogs machine-readable. The Unreleased section is where new work accumulates between releases.',
    triggers: [
      ['Missing # Changelog heading', 'Start CHANGELOG.md with `# Changelog`.'],
      ['Missing ## [Unreleased] section', 'Add `## [Unreleased]` between `# Changelog` and your first dated release.'],
    ],
    example: '# Changelog\\n\\n## [Unreleased]\\n\\n## [1.0.0] - 2026-01-01',
    standard: 'Keep a Changelog v1.1.0 (https://keepachangelog.com)',
  },
  testSpec: {
    title: 'Test-Spec — declared tests exist',
    what: 'Reads TEST-SPEC.md\'s test mapping (rows linking sources to test files) and verifies each referenced test file exists.',
    why:  'A spec that claims test coverage for X but the test file is missing is a stale promise.',
    triggers: [
      ['no service-to-test mappings', 'TEST-SPEC.md has no recognized mapping table. Add a table with `| Source | Test file | Status |` columns.'],
      ['referenced test file does not exist', 'A path in TEST-SPEC.md\'s mapping doesn\'t exist. Update the path or remove the row.'],
    ],
    example: '| `src/auth.ts` | `tests/auth.test.ts` | ✅ |',
    standard: 'ISO/IEC/IEEE 29119-3 (test specification)',
  },
  environment: {
    title: 'Environment — env vars used in code are documented',
    what: 'Greps `process.env.X` and `import.meta.env.X` (plus `os.environ` for Python) across source. Each name must appear in ENVIRONMENT.md or .env.example/.env.template.',
    why:  'Undocumented env vars are runtime surprises waiting to happen.',
    triggers: [
      ['used but not documented', 'Code reads an env var that ENVIRONMENT.md doesn\'t list. Add it to the table.'],
      ['VITE_API_URL or similar prefix', 'Naked prefixes like `VITE_` (no suffix) get filtered out — they\'re convention markers, not real var names.'],
    ],
    example: '`DATABASE_URL` listed in ENVIRONMENT.md\'s Environment Variables table AND read via `process.env.DATABASE_URL` in code',
    standard: '12-Factor App III. Config',
  },
  security: {
    title: 'Security — secrets handling + auth presence',
    what: 'Checks SECURITY.md for required sections, and scans code for committed secrets / unsafe patterns.',
    why:  'OWASP ASVS baseline.',
    triggers: [
      ['Missing "Authentication" section', 'Add `## Authentication` to SECURITY.md. If the project genuinely has no auth (CLI, library), use the v0.16-P7 N/A marker: `<!-- docguard:section authentication n/a — reason -->`.'],
      ['Possible secret', 'A pattern matching common secret formats (API keys, JWT secrets) was found in committed code. Move to env var or .env.example.'],
    ],
    example: 'SECURITY.md has `## Authentication` describing JWT flow; no `sk_live_*` strings in code',
    standard: 'OWASP ASVS v4.0',
  },
  freshness: {
    title: 'Freshness — docs updated alongside code',
    what: 'For each canonical doc, counts code commits since the doc\'s last commit. >10 commits = stale.',
    why:  'Docs drift silently. This validator surfaces the drift before it becomes invisible.',
    triggers: [
      ['code commits since last doc update', 'Run `docguard sync --write` to refresh code-truth sections, then review the prose for accuracy.'],
      ['DRIFT-LOG.md may be stale', 'DRIFT comments in code outpaced log entries. Add the entries.'],
    ],
    example: 'ARCHITECTURE.md last committed within 10 code commits',
    standard: 'CDD principle: docs and code commit together',
  },
  traceability: {
    title: 'Traceability — every FR/SC ID has test coverage',
    what: 'Scans specs/ for FR-### and SC-### requirement IDs. Each must appear in a test file as `@req FR-###`.',
    why:  'Untraceable requirements drift from implementation.',
    triggers: [
      ['has no test coverage', 'Add `// @req FR-012` (or similar) as a comment in the test that verifies the requirement.'],
      ['orphaned test reference', 'A `@req` comment references an ID that doesn\'t exist in any spec. Update the ID or remove the marker.'],
    ],
    example: 'spec.md defines `**FR-012**: ...` and test file has `// @req FR-012` near the test that verifies it',
    standard: 'ISO/IEC/IEEE 29148 (requirements traceability)',
  },
  apiSurface: {
    title: 'API-Surface — endpoints in code match API-REFERENCE.md',
    what: 'Compares routes scanned from code (Express, Next, FastAPI, Spring, etc.) against endpoints listed in API-REFERENCE.md and OpenAPI specs.',
    why:  'Documented but missing endpoints are dead links. Endpoints in code that aren\'t documented are invisible.',
    triggers: [
      ['documented but absent', 'API-REFERENCE.md lists an endpoint that scanRoutes() can\'t find. Remove or fix the doc; `fix --write` removes when marked.'],
      ['present but undocumented', 'A route exists in code but API-REFERENCE.md doesn\'t list it. Add it.'],
    ],
    example: 'GET /api/users in src/routes/users.ts AND in API-REFERENCE.md\'s Endpoints table',
    standard: 'OpenAPI 3.1',
  },
  metricsConsistency: {
    title: 'Metrics-Consistency — quoted numbers match reality',
    what: 'Greps canonical + root docs for "N validators" / "N checks" claims and compares against the actual runtime count.',
    why:  'Stale numeric claims ("19 validators" when it\'s now 22) erode credibility.',
    triggers: [
      ['says "N validators" but actual count is M', 'Run `docguard fix --write` — this is auto-fixable.'],
    ],
    example: 'AGENTS.md says "22 validators" and `docguard guard` shows 22 active validators',
    standard: 'CDD principle: documented metrics match reality',
  },
  surfaceSync: {
    title: 'Surface-Sync — every code-derived list entry is documented',
    what: 'Item-level check (complementing canonical-sync\'s count-level check). For each configured surface (e.g. commands → `cli/commands/*.mjs`), compares the discovered files against the names appearing in table rows / bullet lists in target docs (README.md, AGENTS.md). Warns when a code item is missing from the doc, or a doc item is missing from code.',
    why:  'Counts can match while lists drift — README claimed "14 commands" while the table only listed 13 (demo was missing). Count validators celebrated; users hit "command not found" anyway. This check catches that case.',
    triggers: [
      ['Surface "X" drift: N in code but missing from README.md', 'Add the missing items to the relevant table / bullet list in the target doc. Or, if intentional (deprecation alias, scaffolder behind --with), add the names to the surface\'s `ignore` list in .docguard.json.'],
      ['Surface "X" drift: N listed in README.md but not found in code', 'A documented item no longer exists in code. Either remove it from the doc (it was deleted) or restore the file/command (it was deleted by mistake).'],
    ],
    example: '`cli/commands/demo.mjs` exists and `| `demo` | Zero-install preview |` appears in README.md\'s commands table',
    standard: 'CDD principle: documented surfaces match implemented surfaces',
  },
  crossReference: {
    title: 'Cross-Reference — internal markdown links resolve',
    what: 'Scans canonical docs for `[text](./OTHER.md#anchor)` and `#anchor` links. Verifies the target file exists and the anchor matches a heading.',
    why:  'Broken doc-to-doc links are the most-clicked dead ends in onboarding.',
    triggers: [
      ['broken link: target file not found', 'The file path doesn\'t exist. Fix the path or remove the link.'],
      ['broken anchor', 'Anchor doesn\'t match any heading. Hint: `(did you mean #X?)` is appended for near-misses; if marked `[auto-fixable]`, run `docguard fix --write`.'],
    ],
    example: '`[Setup](#prerequisites)` in ENVIRONMENT.md AND `## Prerequisites` heading present',
    standard: 'GitHub Flavored Markdown anchor rules',
  },
  generatedStaleness: {
    title: 'Generated-Staleness — source=code sections match scanner output',
    what: 'For each `<!-- docguard:section source=code -->` block, re-runs the memory plan scanner and compares against on-disk content. Also flags status: draft docs unmodified for > 14 days.',
    why:  'Code-truth sections must reflect what the code actually says. Forgotten drafts rot.',
    triggers: [
      ['is stale', 'A code-truth section drifted. Run `docguard sync --write` (or `docguard fix --write` since v0.14-P3 — the validator now emits a regenerate-section fix).'],
      ['status: draft for', 'A doc has been in draft for too long. Promote to `status: current` or remove. Threshold via `config.draftStalenessDays`.'],
    ],
    example: 'All source=code sections match what the scanner would produce right now',
    standard: 'CDD principle: code-truth sections are machine-owned',
  },
  todoTracking: {
    title: 'TODO-Tracking — TODOs are tracked + skipped tests explained',
    what: 'Finds TODO/FIXME/HACK comments in source. Each must be referenced in tracking docs (ROADMAP.md, GitHub issues, etc.). Also flags `it.skip()` / `test.skip()` without an adjacent `// REASON:` comment.',
    why:  'TODOs in code that no one tracks are silent debt.',
    triggers: [
      ['Skipped test without explanation', 'Add `// REASON: <why>` immediately above the skip.'],
      ['Untracked TODO', 'Reference the TODO from ROADMAP.md by file:line, OR add it to a GitHub issue and link the issue ID in the comment.'],
    ],
    example: '// REASON: waiting on upstream fix in libfoo v2.5\\ntest.skip("foo", () => {})',
    standard: 'Pragmatic Programmer (debt visibility)',
  },
  specKit: {
    title: 'Spec-Kit — spec.md/plan.md/tasks.md have required sections',
    what: 'For projects using Spec Kit, validates each spec/*.md against the spec-kit-template required sections.',
    why:  'Spec Kit\'s value comes from consistent shape across specs.',
    triggers: [
      ['Missing mandatory section', 'Add the section listed in the warning. Reference the template at .specify/templates/'],
    ],
    example: 'plan.md has Summary, Technical Context, Constitution Check, Project Structure',
    standard: 'GitHub Spec Kit',
  },
};

/**
 * Match a warning text fragment against the explainer table. Returns the
 * matching entry's key + the trigger entry that best matches, or null when
 * no match is confident enough.
 */
function matchWarning(query) {
  const q = query.toLowerCase();

  // Exact validator-key lookup (e.g. `docguard explain freshness`)
  if (EXPLAINERS[query]) return { key: query, trigger: null };
  // Also try kebab-case (e.g. `cross-reference` → `crossReference`)
  const camelized = query.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (EXPLAINERS[camelized]) return { key: camelized, trigger: null };

  // Search trigger phrases
  let best = null;
  let bestScore = 0;
  for (const [key, e] of Object.entries(EXPLAINERS)) {
    for (const [phrase, _hint] of e.triggers) {
      if (q.includes(phrase.toLowerCase())) {
        const score = phrase.length; // prefer the more-specific phrase
        if (score > bestScore) {
          best = { key, trigger: [phrase, _hint] };
          bestScore = score;
        }
      }
    }
  }
  return best;
}

export function runExplain(projectDir, _config, flags) {
  const query = (flags.args || []).join(' ').trim();
  const isJson = flags.format === 'json';

  if (!query) {
    if (isJson) {
      console.log(JSON.stringify({ validators: Object.keys(EXPLAINERS) }, null, 2));
      return;
    }
    console.log(`${c.bold}🧭 docguard explain${c.reset} ${c.dim}— usage:${c.reset}`);
    console.log(`  ${c.cyan}docguard explain <validator-key>${c.reset}    e.g. docguard explain freshness`);
    console.log(`  ${c.cyan}docguard explain "<warning text>"${c.reset}   e.g. docguard explain "no service-to-test mappings"`);
    console.log(`\n${c.dim}Known validators:${c.reset}`);
    for (const [k, e] of Object.entries(EXPLAINERS)) {
      console.log(`  ${c.cyan}${k.padEnd(22)}${c.reset} ${c.dim}${e.title}${c.reset}`);
    }
    return;
  }

  const match = matchWarning(query);
  if (!match) {
    if (isJson) {
      console.log(JSON.stringify({ query, match: null }, null, 2));
      return;
    }
    console.log(`${c.yellow}No matching validator or warning found for: "${query}"${c.reset}`);
    console.log(`${c.dim}Try: ${c.cyan}docguard explain${c.dim} (no args) to list all validators.${c.reset}`);
    process.exit(1);
  }

  const e = EXPLAINERS[match.key];
  if (isJson) {
    console.log(JSON.stringify({ query, match: { key: match.key, ...e, matchedTrigger: match.trigger } }, null, 2));
    return;
  }

  console.log(`${c.bold}🧭 ${e.title}${c.reset}`);
  console.log(`${c.dim}   validator key: ${match.key}${c.reset}\n`);

  console.log(`${c.bold}What it checks:${c.reset}\n  ${e.what}\n`);
  console.log(`${c.bold}Why:${c.reset}\n  ${e.why}\n`);

  if (match.trigger) {
    console.log(`${c.bold}Your warning ("${query}") matches:${c.reset}`);
    console.log(`  ${c.yellow}${match.trigger[0]}${c.reset}`);
    console.log(`  ${match.trigger[1]}\n`);
  } else {
    console.log(`${c.bold}Common warnings:${c.reset}`);
    for (const [phrase, hint] of e.triggers) {
      console.log(`  ${c.yellow}${phrase}${c.reset}`);
      console.log(`    ${c.dim}${hint}${c.reset}`);
    }
    console.log('');
  }

  console.log(`${c.bold}Passing example:${c.reset}\n  ${c.dim}${e.example}${c.reset}\n`);
  console.log(`${c.bold}Standard:${c.reset} ${c.dim}${e.standard}${c.reset}`);
}
