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
import { CODES } from '../findings.mjs';

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
    what: 'Reads TEST-SPEC.md\'s "## Source-to-Test Map" table and verifies every referenced file exists. Parsing is column-HEADER-aware: it locates the source column, the status column, and EVERY test-file column (Unit Test, Integration Test, …) by name, so both the minimal 3-column table and the 4-column table `docguard generate` emits are checked in full — a missing Integration Test is no longer skipped, and a blank cell no longer shifts the columns.',
    why:  'A spec that claims test coverage for X but the test file is missing is a stale promise.',
    triggers: [
      ['no service-to-test mappings', 'TEST-SPEC.md has no recognized mapping table. Add a "## Source-to-Test Map" with column 1 = source, column 2 = test file, last = status. Both `| Source | Test file | Status |` and the generated `| Source File | Unit Test | Integration Test | Status |` are accepted.'],
      ['referenced test file does not exist', 'A path in TEST-SPEC.md\'s mapping doesn\'t exist. Update the path or remove the row.'],
      ['this project has no automated tests (POC, spike, library)', 'Declare it visibly instead of fighting the validator: add `<!-- docguard:validator testSpec n/a — POC, no automated tests yet -->` to TEST-SPEC.md or AGENTS.md. Test-Spec then renders ➖ [N/A] with your reason (git-tracked), not a warning.'],
    ],
    example: '| `src/auth.ts` | `tests/auth.test.ts` | ✅ |   (or the generated 4-column shape)',
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
    what: 'For each canonical doc it picks a "last updated" date by PRECEDENCE, then counts code commits since (>10 = stale): (1) an explicit `<!-- docguard:last-reviewed YYYY-MM-DD -->` marker — a human review signal git cannot see, so it WINS; (2) `<!-- docguard:status approved -->`; (3) the git commit date; (4) for an uncommitted file with no marker, it asks you to commit OR add a marker. CHANGELOG.md follows the SAME precedence — a marker satisfies it before any commit, which matters in a pre-commit edit/review loop. `docguard init` now stamps a `last-reviewed` marker into every canonical doc so freshness is marker-based and consistent from day one.',
    why:  'Docs drift silently. This validator surfaces the drift before it becomes invisible.',
    triggers: [
      ['code commits since last doc update', 'Run `docguard sync --write` to refresh code-truth sections, then review the prose and update (or add) the `<!-- docguard:last-reviewed YYYY-MM-DD -->` marker.'],
      ['not yet committed to git', 'A canonical doc has no git history and no marker. Commit it, or add `<!-- docguard:last-reviewed YYYY-MM-DD -->` (or `<!-- docguard:status approved -->`) so freshness is satisfiable before the commit.'],
      ['DRIFT-LOG.md may be stale', 'DRIFT comments in code outpaced log entries. Add the entries.'],
    ],
    example: 'ARCHITECTURE.md carries `<!-- docguard:last-reviewed 2026-06-19 -->` (or was committed within 10 code commits)',
    standard: 'CDD principle: docs and code commit together',
  },
  traceability: {
    title: 'Traceability — requirement IDs have test coverage + docs link to code',
    what: 'Two linkages under one validator: (1) scans specs/ for FR-###/SC-### (also REQ-###, T-###) requirement IDs, each of which must appear in a test as `@req FR-###`; (2) flags a canonical doc that exists but that no source file references back to — the "unlinked doc" warning.',
    why:  'Untraceable requirements drift from implementation, and a doc no code points to is memory nothing reads.',
    triggers: [
      ['has no test coverage', 'Add `// @req FR-012` (or similar) as a comment in the test that verifies the requirement.'],
      ['orphaned test reference', 'A `@req` comment references an ID that doesn\'t exist in any spec. Update the ID or remove the marker.'],
      ['unlinked doc', 'A canonical doc (e.g. TEST-SPEC.md) exists but no source file references it. Link it from code/tests, or treat it as advisory if the doc is intentionally standalone. This is a doc→source check, distinct from the FR/SC→test check above — they share the Traceability bucket.'],
      ['this project has no formal requirements', 'Declare it visibly: add `<!-- docguard:validator traceability n/a — no formal requirements doc -->` to a canonical doc or AGENTS.md. Renders as ➖ [N/A] with the reason instead of warning on every loose ID.'],
    ],
    example: 'spec.md defines `**FR-012**: ...` and a test has `// @req FR-012`; and TEST-SPEC.md is referenced from a test/source file',
    standard: 'ISO/IEC/IEEE 29148 (requirements traceability)',
  },
  apiSurface: {
    title: 'API-Surface — endpoints in code match API-REFERENCE.md (and the spec matches the routes)',
    what: 'Compares routes scanned from code (Express, Next, FastAPI, Spring, etc.) against endpoints listed in API-REFERENCE.md and OpenAPI specs. When an OpenAPI spec exists it is the authoritative surface — so it ALSO diffs the spec against the actually-registered code routes, catching a spec that declares a phantom endpoint (the doc reconciles clean against a wrong spec otherwise). That spec-vs-route check is conservative: it only runs when code routes are actually scannable.',
    why:  'Documented but missing endpoints are dead links. Endpoints in code that aren\'t documented are invisible. And a spec nobody implements is a lie the doc check can\'t see.',
    triggers: [
      ['documented but absent', 'API-REFERENCE.md lists an endpoint that scanRoutes() can\'t find. Remove or fix the doc; `fix --write` removes when marked.'],
      ['present but undocumented', 'A route exists in code but API-REFERENCE.md doesn\'t list it. Add it.'],
      ['declares', 'The OpenAPI spec declares an endpoint that no Express/Fastify/etc. route registers in code — i.e. "declares METHOD /path but no route registers it". Either implement the route or remove the phantom endpoint from the spec (the API-REFERENCE doc reconciles clean against the spec, so this is the only check that catches it).'],
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
  canonicalSync: {
    title: 'Canonical-Sync — README count claims match code-truth (DocGuard repo only)',
    what: 'Count-level check (complementing surface-sync\'s item-level check). Verifies that numeric claims in the README — "ships N commands", "N validators", mermaid diagram counts — match what the code actually exposes. N/A unless the project opts in via `canonicalSync` config; primarily for DocGuard\'s own repo.',
    why:  'Hardcoded counts in prose and diagrams drift silently every time a command or validator is added/removed. A README claiming "23 validators" when there are 24 erodes trust and misleads AI agents reading the docs.',
    triggers: [
      ['README.md claims "N validators" but guard reports M', 'Update the count. `docguard fix --write` handles this mechanically across all docs.'],
      ['architecture diagram has stale counts', 'Update the count inside the mermaid block (fix --write does not edit mermaid; do it manually).'],
    ],
    example: 'README says "24 validators" and the architecture mermaid says "Validators (24)" — both matching the live registry',
    standard: 'CDD principle: documented counts match implemented counts',
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

  // ── Backfilled in v0.24 (field report, Issue A) ─────────────────────────
  // These validators were registered in guard but had no explain entry, so
  // `docguard explain <key>` returned "not found" — including the very
  // negation-load escape hatch that v0.23.0 shipped (docQuality). The new
  // tests/explain-coverage.test.mjs asserts this table covers every key the
  // guard registry exposes, so the gap can't silently reopen.
  docSections: {
    // Reported by guard under the `structure` severity key, but it's a
    // distinct check (required headings, not file existence) with its own
    // warning + N/A marker — so it gets its own explainer.
    title: 'Doc Sections — each canonical doc has its required headings',
    what: 'For each canonical doc, verifies the required `##` sections exist as real headings: ARCHITECTURE.md (System Overview, Component Map, Tech Stack), DATA-MODEL.md (Entities), SECURITY.md (Authentication, Secrets Management), TEST-SPEC.md (Test Categories, Coverage Rules), ENVIRONMENT.md (Environment Variables, Setup Steps). The DATA-MODEL and ENVIRONMENT requirements relax automatically for CLI/library projects.',
    why:  'A canonical doc that exists but lacks its sections is an empty shell — the section structure is what makes it a reliable memory anchor for humans and agents.',
    triggers: [
      ['missing section', 'Add the named `## Section` heading. If the section is genuinely not applicable (e.g. a CLI with no auth), add the N/A marker — a reason is required: `<!-- docguard:section authentication n/a — CLI tool, no auth layer -->`.'],
    ],
    example: 'SECURITY.md contains both `## Authentication` and `## Secrets Management` as real headings — or carries `<!-- docguard:section authentication n/a — CLI, no auth -->`',
    standard: 'CDD STANDARD (canonical doc section contract)',
  },
  architecture: {
    title: 'Architecture — module imports respect layer boundaries',
    what: 'Builds an import graph across JS/TS files (ES imports, dynamic imports, CommonJS require) and flags (a) imports that cross a forbidden layer boundary declared in `config.layers` or a "Layer Boundaries" table in ARCHITECTURE.md, and (b) circular dependency cycles (length 3–6). N/A unless layers are declared in config or ARCHITECTURE.md.',
    why:  'Layer violations and import cycles are how a clean architecture rots silently. Catching them at doc-time keeps the documented design honest.',
    triggers: [
      ['Circular dependency', 'Break the cycle — extract the shared piece into a module both can import, or invert one of the dependencies.'],
      ['forbidden by ARCHITECTURE.md', 'An import crosses a boundary your ARCHITECTURE.md "Layer Boundaries" table forbids. Remove the import or update the declared boundary.'],
      ['layer imports from forbidden layer', 'Same violation, declared via `config.layers.<layer>.canImport`. Adjust the import or widen the allowed list.'],
    ],
    example: 'ARCHITECTURE.md declares the routes layer may not import from routes, every import respects it, and there are no import cycles',
    standard: 'Layered architecture / Acyclic Dependencies Principle',
  },
  docsDiff: {
    title: 'Docs-Diff — declared tech stack + tests match reality',
    what: 'Two soft-signal diffs: (1) technologies named in ARCHITECTURE.md vs. technologies implied by your dependencies (plus Dockerfile / Terraform detection); (2) test files referenced in TEST-SPEC.md vs. the `*.test.*` / `*.spec.*` files actually on disk. Warnings only — drift is a signal, not a failure. (Env-var drift is handled separately by the Environment validator.)',
    why:  'The tech-stack section and the test list are the doc parts that rot fastest as dependencies and tests come and go.',
    triggers: [
      ['drift:', 'ARCHITECTURE.md or TEST-SPEC.md disagrees with the code. The warning spells out which items are "in code but not documented" vs. "documented but not found in code".'],
      ['in code but not documented', 'Add the technology or test file to the relevant doc.'],
      ['documented but not found in code', 'Remove the stale reference, or restore the file if it was deleted by mistake.'],
    ],
    example: 'ARCHITECTURE.md names exactly the stack the dependencies imply, and every glob in TEST-SPEC.md matches a real test file',
    standard: 'CDD principle: documented surfaces match implemented surfaces',
  },
  metadataSync: {
    title: 'Metadata-Sync — version strings agree with package.json',
    what: 'Takes package.json `version` as the source of truth and flags (a) a different `version:` in extension.yml/yaml, and (b) older same-major version references in docs — but only in actionable contexts (release/download URLs, `@x.y.z` install specs, `version:` declarations). CHANGELOG.md and DRIFT-LOG.md are skipped as historical by definition.',
    why:  'A README install line pinned to an old version, or an extension manifest left behind on release, sends users to the wrong artifact.',
    triggers: [
      ['but package.json is', 'A tracked version string disagrees with package.json. Update it (`docguard fix --write` handles this when marked auto-fixable).'],
      ['in an actionable context', 'A docs install command / URL / declaration references an older same-major version. Bump it to the current version.'],
    ],
    example: 'package.json is 0.23.0, extension.yml says 0.23.0, and every install command / release URL points at 0.23.0',
    standard: 'Semantic Versioning (consistency of published version references)',
  },
  docsCoverage: {
    title: 'Docs-Coverage — documentable artifacts are mentioned somewhere',
    what: 'Collects all doc text (README, AGENTS.md, CLAUDE.md, CONTRIBUTING.md, STANDARD.md, docs-canonical/, docs/, docs-implementation/, extensions/) and checks that root config files, package.json `bin` commands, source directories, and config files the code actually reads each appear in at least one doc. Also checks the README has Installation / Usage / License sections.',
    why:  'A feature, command, or config file that no doc mentions is invisible to new contributors and to AI agents reading the project.',
    triggers: [
      ['exists but is not mentioned in any documentation', 'Document the config file\'s purpose in ARCHITECTURE.md or README.md.'],
      ['but it\'s not mentioned in any documentation', 'A package.json `bin` command is undocumented — mention it in the README.'],
      ['is not referenced in ARCHITECTURE.md', 'A source directory has no mention in ARCHITECTURE.md — add it to the Component Map.'],
      ['is missing a', 'README.md lacks a required section (Installation / Usage / License, per the Standard README spec).'],
    ],
    example: 'Every root config file, package.json bin command, and source directory is named in README.md or ARCHITECTURE.md; the README has Installation, Usage, and License',
    standard: 'Standard README (github.com/RichardLitt/standard-readme)',
  },
  docQuality: {
    title: 'Doc-Quality — prose is clear and verifiable',
    what: 'Runs 8 deterministic prose metrics on each canonical doc + README: passive voice, ambiguous pronouns, atomicity, Flesch readability, Flesch-Kincaid grade, sentence length, negation load, conditional load. Docs under 50 prose words or 3 sentences are skipped as reference material.',
    why:  'Vague, passive, negation-heavy docs are hard for both humans and AI agents to act on. Metrics inspired by IEEE 830 / ISO 29148.',
    triggers: [
      ['High negation load', 'Rephrase in positive terms ("must not fail" → "must succeed"). If the negation is intentional (security/operational docs legitimately use "never"/"must not"), add the per-doc override: `<!-- docguard:quality negation-load off — your reason -->`, or set a custom bar with `<!-- docguard:quality negation-load 0.35 — reason -->`. Project-wide default: `docQuality.negationLoadThreshold` in .docguard.json.'],
      ['High passive voice ratio', 'Use active voice: "the config is read by the loader" → "the loader reads the config". If the doc is legitimately passive (a sequence/flow doc), add the per-doc override: `<!-- docguard:quality passive-voice off — your reason -->`, or set a custom bar with `<!-- docguard:quality passive-voice 0.4 — reason -->`. Project-wide default: `docQuality.passiveVoiceThreshold` in .docguard.json.'],
      ['High ambiguous pronoun ratio', 'Replace "it/this/that/they" with the specific noun.'],
      ['Low atomicity', 'Split compound sentences so each states one verifiable fact (IEEE 830 §4.1).'],
      ['Reading level too high', 'Aim for grade 12–16 for technical docs — shorter sentences, simpler words.'],
      ['High conditional load', 'Split tangled conditionals into separate requirements.'],
    ],
    example: 'SECURITY.md written in active voice with negation in ≤20% of sentences — or carrying `<!-- docguard:quality negation-load off — prohibitive language is precise here -->`',
    standard: 'IEEE 830 / ISO/IEC/IEEE 29148 (readable, verifiable requirements)',
  },
  schemaSync: {
    title: 'Schema-Sync — DB models in code are documented in DATA-MODEL.md',
    what: 'Detects schema files for 7 ORMs/frameworks (Prisma, Drizzle, Sequelize, TypeORM, Knex, Django, Rails), extracts the model/table names, and checks each appears (case-insensitive, singular/plural aware) in docs-canonical/DATA-MODEL.md. Migration/utility tables are filtered out. No schema files → passes silently.',
    why:  'An undocumented table is a data model only the code knows — exactly the institutional memory CDD exists to preserve.',
    triggers: [
      ['not documented in DATA-MODEL.md', 'Add the model to DATA-MODEL.md\'s Entity Definitions section.'],
      ['but no DATA-MODEL.md exists', 'Models were found but DATA-MODEL.md is missing. Run `docguard init` to create it, then document the schema.'],
    ],
    example: 'Every `model User` / `model Order` in schema.prisma is named in docs-canonical/DATA-MODEL.md',
    standard: 'CDD principle: the data model is documented, not implied',
  },
};

/**
 * Validator-key → display name, mirroring the names guard prints in its
 * report. Users only ever see these names (e.g. "Doc-Quality", "Doc Sections"),
 * so `docguard explain` must resolve them too — typing what you see should work.
 *
 * This intentionally lists every key the guard registry exposes (guard.mjs).
 * tests/explain-coverage.test.mjs asserts it stays in lock-step with the live
 * registry, so a new validator can't ship without an explain entry + name.
 */
const DISPLAY_NAMES = {
  structure: 'Structure',
  docSections: 'Doc Sections',
  docsSync: 'Docs-Sync',
  drift: 'Drift-Comments',
  changelog: 'Changelog',
  testSpec: 'Test-Spec',
  environment: 'Environment',
  security: 'Security',
  architecture: 'Architecture',
  freshness: 'Freshness',
  traceability: 'Traceability',
  docsDiff: 'Docs-Diff',
  apiSurface: 'API-Surface',
  metadataSync: 'Metadata-Sync',
  docsCoverage: 'Docs-Coverage',
  docQuality: 'Doc-Quality',
  todoTracking: 'TODO-Tracking',
  schemaSync: 'Schema-Sync',
  specKit: 'Spec-Kit',
  crossReference: 'Cross-Reference',
  generatedStaleness: 'Generated-Staleness',
  surfaceSync: 'Surface-Sync',
  canonicalSync: 'Canonical-Sync',
  metricsConsistency: 'Metrics-Consistency',
};

/** Collapse a key / display name to a comparable form: lowercase, alnum only. */
const normalizeKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * normalized(alias) → canonical key, built once from both the explainer keys
 * and the guard display names. Lets `docQuality`, `doc-quality`, `Doc-Quality`,
 * and `"doc quality"` all resolve to the same entry.
 */
const ALIAS_INDEX = (() => {
  const idx = {};
  for (const key of Object.keys(EXPLAINERS)) idx[normalizeKey(key)] = key;
  for (const [key, name] of Object.entries(DISPLAY_NAMES)) {
    if (EXPLAINERS[key]) idx[normalizeKey(name)] = key; // name → key (only if explainable)
  }
  return idx;
})();

/**
 * Match a warning text fragment against the explainer table. Returns the
 * matching entry's key + the trigger entry that best matches, or null when
 * no match is confident enough.
 */
function matchWarning(query) {
  const q = query.toLowerCase();

  // Key / display-name lookup, casing- and separator-insensitive. Covers
  // `freshness`, `cross-reference`, `Doc-Quality`, `"doc sections"`, etc.
  const aliased = ALIAS_INDEX[normalizeKey(query)];
  if (aliased) return { key: aliased, trigger: null };

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
    // Exhaustive by construction: iterate the guard display-name map so the
    // list always covers every registered validator (field report, Issue A.3).
    const listed = Object.keys(DISPLAY_NAMES).filter(k => EXPLAINERS[k]);
    if (isJson) {
      console.log(JSON.stringify({ validators: listed }, null, 2));
      return;
    }
    console.log(`${c.bold}🧭 docguard explain${c.reset} ${c.dim}— usage:${c.reset}`);
    console.log(`  ${c.cyan}docguard explain <validator>${c.reset}        e.g. docguard explain doc-quality  ${c.dim}(key or the name shown in guard)${c.reset}`);
    console.log(`  ${c.cyan}docguard explain "<warning text>"${c.reset}   e.g. docguard explain "no service-to-test mappings"`);
    console.log(`\n${c.dim}Known validators (${listed.length}):${c.reset}`);
    for (const k of listed) {
      console.log(`  ${c.cyan}${DISPLAY_NAMES[k].padEnd(22)}${c.reset} ${c.dim}${EXPLAINERS[k].title}${c.reset}`);
    }
    return;
  }

  // v0.27: finding-code lookup — `docguard explain SEC001`. Codes are the stable,
  // LLM-addressable handles that guard prints next to each finding and that
  // inline `// docguard:ignore <CODE>` keys off.
  const codeKey = query.toUpperCase();
  if (CODES[codeKey]) {
    const cd = CODES[codeKey];
    if (isJson) {
      console.log(JSON.stringify({ query, code: codeKey, ...cd }, null, 2));
      return;
    }
    console.log(`${c.bold}🧭 ${codeKey} — ${cd.title}${c.reset}`);
    console.log(`${c.dim}   validator: ${cd.validator}${c.reset}\n`);
    console.log(`${c.bold}What it means:${c.reset}\n  ${cd.help}\n`);
    if (cd.suppress) {
      console.log(`${c.bold}Suppress inline${c.reset} ${c.dim}(only if it's a confirmed false positive):${c.reset}`);
      console.log(`  ${c.cyan}${cd.suppress}${c.reset}\n`);
    }
    console.log(`${c.bold}Got it wrong?${c.reset} ${c.dim}Send a redacted report so a future release stops flagging it: ${c.cyan}docguard feedback${c.reset}`);
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

  // v0.24: surface how to mute/tune from config — there was no in-tool way to
  // discover this, so users reached for severity:"off" (a no-op) instead of
  // the real switch (field report). docSections is reported under the
  // `structure` key in guard, so it disables via that key.
  const cfgKey = match.key === 'docSections' ? 'structure' : match.key;
  console.log(`\n${c.bold}Tune it${c.reset} ${c.dim}(.docguard.json):${c.reset}`);
  console.log(`  ${c.cyan}validators.${cfgKey}: false${c.reset} ${c.dim}— disable this validator entirely${c.reset}`);
  console.log(`  ${c.cyan}severity.${cfgKey}: "high" | "low"${c.reset} ${c.dim}— change exit-code weight (low = warn-only). Severity never hides the warning from output.${c.reset}`);
}
