/**
 * Findings — the structured, LLM-addressable result unit (v0.27).
 *
 * Background (LLM field report #3): DocGuard's whole job is to tell an agent
 * what to do NEXT. A free-text `errors`/`warnings` string can't carry a stable
 * code (for `explain <CODE>` + inline suppression), a confidence (the signal
 * the false-positive feedback loop runs on), or a machine-readable suggested
 * action. A Finding carries all three.
 *
 * The migration is INCREMENTAL and BACKWARD-COMPATIBLE. A validator that opts in
 * builds `Finding[]` and returns `resultFromFindings(...)`, which still emits the
 * exact `{ errors, warnings, passed, total }` shape every existing consumer
 * (guard counts + exit code, diagnose, score, ci, `--format json`) already reads
 * — PLUS a `findings` array that guard renders richly (each issue gets its
 * `→ suggestion`). Validators that haven't migrated keep returning their
 * hand-built results and render exactly as before. Nothing regresses.
 *
 * Zero npm dependencies — pure Node.js built-ins.
 *
 * @typedef {Object} Suggestion
 * @property {'fix'|'suppress'|'review'|'report'} kind
 * @property {string}  text             One concise line: what to do next.
 * @property {string} [command]         Optional CLI/skill command to run.
 * @property {string} [pragma]          Optional inline suppression snippet.
 *
 * @typedef {Object} Finding
 * @property {string}      code          Stable code, e.g. 'SEC001' (see CODES).
 * @property {string}      validator     Owning validator key.
 * @property {'error'|'warn'} severity
 * @property {'high'|'low'} confidence   'low' = candidate false positive.
 * @property {string}      message       Concise, NO ansi colour.
 * @property {string|null} location      'path:line' or 'path'.
 * @property {Suggestion|null} suggestion
 * @property {boolean}     reportable    Surface in `docguard feedback`.
 * @property {string|null} redactedContext  Safe-to-share context for a report.
 */

/**
 * Stable finding-code registry. `docguard explain <CODE>` reads this, and
 * inline `// docguard:ignore <CODE>` keys off it. Keep codes append-only — a
 * published code is a public surface we don't renumber.
 */
export const CODES = {
  SEC001: {
    validator: 'security',
    title: 'Hardcoded password',
    help: 'A `password`/`passwd`/`pwd` assignment with a quoted literal value (8+ chars). If the value is natural-language UI copy or a validation message — not a credential — this is a false positive: DocGuard now flags those low-confidence, but you can suppress inline.',
    suppress: '// docguard:ignore SEC001 — UI copy, not a credential',
  },
  SEC002: {
    validator: 'security',
    title: 'Hardcoded API key',
    help: 'An `api_key`/`apikey` assignment with a quoted literal value (16+ chars). Move it to an environment variable and read it via `process.env`.',
    suppress: '// docguard:ignore SEC002 — sample value in fixture',
  },
  SEC003: {
    validator: 'security',
    title: 'Hardcoded secret key',
    help: 'A `secret_key`/`secretkey` assignment with a quoted literal value (16+ chars). Move it to an environment variable.',
    suppress: '// docguard:ignore SEC003 — reason',
  },
  SEC004: {
    validator: 'security',
    title: 'Hardcoded access token',
    help: 'An `access_token`/`accesstoken` assignment with a quoted literal value (16+ chars). Move it to an environment variable.',
    suppress: '// docguard:ignore SEC004 — reason',
  },
  SEC005: {
    validator: 'security',
    title: 'AWS Access Key ID',
    help: 'A string matching the AWS Access Key ID format (AKIA…). Rotate it immediately if real, and move credentials to the AWS credential chain / environment.',
    suppress: '// docguard:ignore SEC005 — documented example key',
  },
  SEC006: {
    validator: 'security',
    title: 'API secret key (Stripe/OpenAI pattern)',
    help: 'A string matching a live/test secret-key format (sk-…, sk_live_…). Rotate it if real and move it to an environment variable.',
    suppress: '// docguard:ignore SEC006 — reason',
  },
  SEC010: {
    validator: 'security',
    title: '.env not in .gitignore',
    help: 'No `.env` entry was found in .gitignore, so a local `.env` could be committed. Add `.env` (and `.env.local`) to .gitignore.',
    suppress: null,
  },
  SEC011: {
    validator: 'security',
    title: 'No source files scanned for secrets',
    help: 'The secret scan matched zero source files — usually a too-broad ignore config or a wrong sourceRoot. A scan that checks nothing is a dangerous false ✅.',
    suppress: null,
  },
  // ── v0.29 findings-migration tranche (structure / changelog / metrics) ──
  STR001: {
    validator: 'structure',
    title: 'Missing required file',
    help: 'A file listed in requiredFiles (canonical doc, changelog, or drift log) does not exist. Create it from a template with `docguard init`, or remove it from `requiredFiles` in .docguard.json if your profile genuinely does not need it.',
    suppress: null,
  },
  STR002: {
    validator: 'structure',
    title: 'Missing agent instructions file',
    help: 'None of the configured agent files (AGENTS.md / CLAUDE.md) exist. AI agents working in this repo have no project contract. Create one with `docguard init` or write it by hand.',
    suppress: null,
  },
  STR003: {
    validator: 'structure',
    title: 'Missing required doc section',
    help: 'A canonical doc exists but lacks a section its document type requires. Add the section — or, if it is genuinely not applicable, own the absence with an inline marker: `<!-- docguard:section <slug> n/a — reason -->`.',
    suppress: '<!-- docguard:section <slug> n/a — reason -->',
  },
  CHG001: {
    validator: 'changelog',
    title: 'Missing [Unreleased] section',
    help: 'Keep a Changelog format expects an [Unreleased] section where in-progress work accumulates before each release. `docguard fix --write` inserts one.',
    suppress: null,
  },
  CHG002: {
    validator: 'changelog',
    title: 'No version sections',
    help: 'CHANGELOG.md has no `## [version]` headers — it does not follow Keep a Changelog format, so release tooling and readers cannot parse the history.',
    suppress: null,
  },
  CHG003: {
    validator: 'changelog',
    title: 'Staged code without a CHANGELOG entry',
    help: 'Code files are staged for commit but the changelog is not. Per STANDARD.md, a code change and its changelog entry travel in the same commit.',
    suppress: null,
  },
  MET001: {
    validator: 'metricsConsistency',
    title: 'Documented count drifted from DocGuard meta-count',
    help: 'A docguard-bound "N checks/validators" number in a doc no longer matches the tool\'s actual count. `docguard fix --write` rewrites it (fail-closed: only docguard-bound lines, with provenance).',
    suppress: null,
  },
  MET002: {
    validator: 'metricsConsistency',
    title: 'Documented count drifted from a declared collection',
    help: 'A doc states "N <noun>" for a noun declared in `config.collections`, but the collection glob matches a different number of files. Either the doc is stale (fix with `docguard fix --write`) or the code lost/gained members unintentionally — check which side is wrong before fixing.',
    suppress: null,
  },
  FRS001: {
    validator: 'freshness',
    title: 'Doc has no freshness signal',
    help: 'The doc exists but is not committed to git and carries no review marker, so its currency cannot be assessed. Commit it, or stamp it with `<!-- docguard:last-reviewed YYYY-MM-DD -->` (or `<!-- docguard:status approved -->` for a doc generated this session).',
    suppress: '<!-- docguard:status approved -->',
  },
  FRS002: {
    validator: 'freshness',
    title: 'Code moved on since the doc was last updated',
    help: '10+ code commits landed after the doc\'s last update/review — its code-truth sections are likely stale. Run `docguard sync --write` to refresh them in one pass, or review and stamp `<!-- docguard:last-reviewed YYYY-MM-DD -->` if it is still accurate.',
    suppress: null,
  },
  FRS003: {
    validator: 'freshness',
    title: 'Doc predates the latest code change by 30+ days',
    help: 'The doc\'s last update is more than 30 days older than the newest code commit. Review it against the current code, then update it or stamp it reviewed.',
    suppress: null,
  },
  FRS004: {
    validator: 'freshness',
    title: 'CHANGELOG lagging behind code changes',
    help: 'Code changed but CHANGELOG.md has not been updated in over a week. Add the missing entries under [Unreleased].',
    suppress: null,
  },
  FRS005: {
    validator: 'freshness',
    title: 'DRIFT-LOG possibly stale',
    help: 'Recent commits added `DRIFT:` comments but DRIFT-LOG.md has not kept pace. Log the new deviations (each DRIFT comment needs a DRIFT-LOG entry) or remove resolved markers.',
    suppress: null,
  },
  DSY001: {
    validator: 'docsSync',
    title: 'Route not referenced in canonical docs',
    help: 'A route file exists but neither its path nor its basename appears in any docs-canonical .md file. Reference the route in a canonical doc (e.g. ARCHITECTURE.md or an API doc) so the documented surface matches the code.',
    suppress: null,
  },
  DSY002: {
    validator: 'docsSync',
    title: 'Service not referenced in canonical docs',
    help: 'A service/lib file exists but neither its path nor its basename appears in any docs-canonical .md file. Reference the service in a canonical doc (e.g. ARCHITECTURE.md) so the documented surface matches the code.',
    suppress: null,
  },
  DSY003: {
    validator: 'docsSync',
    title: 'Route file missing from OpenAPI spec',
    help: 'A route file defines paths (or has a route-like filename) with no matching path in the detected OpenAPI/Swagger spec. Re-run your spec generator (e.g. zod-to-openapi) or add the paths to the spec by hand.',
    suppress: null,
  },
  DDF001: {
    validator: 'docsDiff',
    title: 'Tech Stack drift',
    help: 'The tech named in docs-canonical/ARCHITECTURE.md and the dependencies actually declared (package.json across the monorepo, Dockerfile, .tf files) disagree. Drift is two-sided — document the new tech or remove the stale entries after checking which side is wrong.',
    suppress: null,
  },
  DDF002: {
    validator: 'docsDiff',
    title: 'Test Files drift',
    help: 'The test files documented in docs-canonical/TEST-SPEC.md and the test files on disk disagree. Add entries for new tests or remove documented tests that no longer exist — TEST-SPEC.md entries may be glob patterns.',
    suppress: null,
  },
  DCV001: {
    validator: 'docsCoverage',
    title: 'Undocumented config file',
    help: 'A project-specific config/dotfile at the repo root is not mentioned in any documentation. Document its purpose in ARCHITECTURE.md or README.md, or add it to `ignore` in .docguard.json if it is genuinely internal.',
    suppress: null,
  },
  DCV002: {
    validator: 'docsCoverage',
    title: 'Undocumented CLI bin command',
    help: 'package.json declares a `bin` entry users can run, but no documentation mentions it. Document the command, typically in README.md under Usage.',
    suppress: null,
  },
  DCV003: {
    validator: 'docsCoverage',
    title: 'Source directory not in ARCHITECTURE.md',
    help: 'A directory under a source root is not referenced in ARCHITECTURE.md. Add it to the Component Map, or add an ignore pattern in .docguard.json if it is build output.',
    suppress: null,
  },
  DCV004: {
    validator: 'docsCoverage',
    title: 'Code-referenced config not documented',
    help: "Source code reads a config file (a resolve/readFileSync/existsSync call) that no documentation mentions. Describe the file's purpose and format in README.md or ARCHITECTURE.md.",
    suppress: null,
  },
  DCV005: {
    validator: 'docsCoverage',
    title: 'README missing a standard section',
    help: 'README.md lacks a section every well-documented project needs — Installation, Usage, or License (Standard README spec). Add the missing section.',
    suppress: null,
  },
  DCV006: {
    validator: 'docsCoverage',
    title: 'IaC detected but no Infrastructure section',
    help: 'An IaC tool (CDK, Terraform, Pulumi, SAM, or Serverless) was detected but ARCHITECTURE.md has no Infrastructure heading. Add an "Infrastructure" section covering the tool\'s layout — the warning names the exact marker file and directories to describe.',
    suppress: null,
  },
  MDS001: {
    validator: 'metadataSync',
    title: 'extension.yml version out of sync',
    help: 'An extension.yml declares a version that differs from package.json. `docguard fix --write` rewrites it to the current version.',
    suppress: null,
  },
  MDS002: {
    validator: 'metadataSync',
    title: 'Stale version reference in docs',
    help: 'A markdown file references an older version of this package in an actionable context (download URL, install command, or version: declaration). `docguard fix --write` replaces it with the current version; prose mentions of old versions are intentionally not flagged.',
    suppress: null,
  },
  ENV001: {
    validator: 'environment',
    title: 'Missing setup section in ENVIRONMENT.md',
    help: 'ENVIRONMENT.md lacks both a "## Prerequisites" and a "## Setup Steps" heading (H2/H3 anchored, not a TOC mention). Add a Setup Steps section describing how to get the project running from a fresh clone.',
    suppress: null,
  },
  ENV002: {
    validator: 'environment',
    title: 'Missing Environment Variables section',
    help: 'ENVIRONMENT.md has no "## Environment Variables" heading. Add the section and document each variable the app reads — backticked names or a pipe table both count.',
    suppress: null,
  },
  ENV003: {
    validator: 'environment',
    title: 'Env vars used in code but undocumented',
    help: "Variables read via process.env / import.meta.env were found in code but not in ENVIRONMENT.md or .env.example. Document each listed variable in the doc, or add it to .env.example — either counts as documentation.",
    suppress: null,
  },
  ENV004: {
    validator: 'environment',
    title: 'ENVIRONMENT.md references a missing .env.example',
    help: 'The doc mentions .env.example but the file does not exist. Create it with placeholder values, or remove the stale reference.',
    suppress: null,
  },
  ENV005: {
    validator: 'environment',
    title: '.env exists without a .env.example template',
    help: "A local .env (or .env.local / .env.development) exists but there is no .env.example, so new contributors won't know what vars to set. Create a .env.example listing every variable with a placeholder value.",
    suppress: null,
  },
  TSP001: {
    validator: 'testSpec',
    title: 'Source declared ❌ (missing tests) in TEST-SPEC',
    help: 'A Source-to-Test Map row declares its source as ❌ — the author has flagged missing tests. Write the tests, then update the row status to ✅.',
    suppress: null,
  },
  TSP002: {
    validator: 'testSpec',
    title: 'Source declared ⚠️ (partial coverage) in TEST-SPEC',
    help: 'A Source-to-Test Map row declares partial coverage for its source. Extend the tests, then update the row status to ✅.',
    suppress: null,
  },
  TSP003: {
    validator: 'testSpec',
    title: 'Mapped source file not found on disk',
    help: 'A Source-to-Test Map row points at a source file that no longer exists — usually a stale entry after a move or delete. Update or remove the row. If the flagged cell is prose rather than a real path, report it as a false positive.',
    suppress: null,
  },
  TSP004: {
    validator: 'testSpec',
    title: 'Mapped test file not found on disk',
    help: 'A Source-to-Test Map row declares a test file that does not exist. Create the test file, or point the row at the actual test path.',
    suppress: null,
  },
  TSP005: {
    validator: 'testSpec',
    title: 'E2E journey declared ❌ (missing test)',
    help: 'A Critical User Journeys / Critical CLI Flows row is marked ❌. Implement the journey test, then mark the row ✅.',
    suppress: null,
  },
  TSP006: {
    validator: 'testSpec',
    title: 'E2E journey marked ✅ but test file missing',
    help: 'A journey row claims ✅ but none of its referenced test paths exist on disk (globs and "(N suites)" annotations are honored). The glyph is a claim, the file is the proof — fix the path in the row or restore the missing test.',
    suppress: null,
  },
  TSP007: {
    validator: 'testSpec',
    title: 'No tests found anywhere in the project',
    help: 'TEST-SPEC.md maps nothing and no tests/ directory, co-located *.test.* files, or vitest/jest config were found. Add tests, then map them in a "## Source-to-Test Map" table so coverage claims stay verifiable.',
    suppress: null,
  },
  DRF001: {
    validator: 'drift',
    title: 'DRIFT comment but no drift log file',
    help: 'Code contains a // DRIFT: comment but the drift log (DRIFT-LOG.md) does not exist, so the deviation is unlogged. Create the drift log — `docguard init` scaffolds it — then record this deviation in it.',
    suppress: null,
  },
  DRF002: {
    validator: 'drift',
    title: 'DRIFT comment not logged in DRIFT-LOG.md',
    help: "A // DRIFT: comment's file has no matching entry in DRIFT-LOG.md. Add an entry naming the file and explaining why the code deviates from docs-canonical.",
    suppress: null,
  },
  TRC001: {
    validator: 'traceability',
    title: 'Required canonical doc missing (no traceability)',
    help: 'A doc listed in requiredFiles.canonical does not exist, so no doc-to-source link can be checked. Create it from a template with `docguard init` (the structure validator flags the missing file too).',
    suppress: null,
  },
  TRC002: {
    validator: 'traceability',
    title: 'Unlinked canonical doc (no matching source)',
    help: 'The doc exists but no source file matches its built-in path patterns. If the implementing code lives in a non-standard location, link it explicitly by adding a `// @doc <DOC-NAME>.md` annotation near the top of a source file that implements the doc.',
    suppress: '// @doc <DOC-NAME>.md',
  },
  TRC003: {
    validator: 'traceability',
    title: 'Orphaned doc in docs-canonical/',
    help: 'A doc exists in docs-canonical/ but is not listed in requiredFiles.canonical, so no validator checks it and it can silently rot. Delete it, or add it to requiredFiles.canonical in .docguard.json so it gets validated.',
    suppress: null,
  },
  TRC004: {
    validator: 'traceability',
    title: 'Requirement ID without test coverage',
    help: 'A requirement ID found in the docs (REQ-/FR-/SC-/T-style) has no matching reference in any test file. Add an `@req <ID>` comment to the test that verifies it. Requirement traceability is opt-in: it only activates once IDs appear in your docs.',
    suppress: null,
  },
  TRC005: {
    validator: 'traceability',
    title: 'Orphaned test reference to unknown requirement',
    help: 'A test references a requirement ID that no doc defines — the test claims to verify something the docs never specified. Remove the stale reference, or add the requirement to the documentation.',
    suppress: null,
  },
  TDO001: {
    validator: 'todoTracking',
    title: 'Skipped test without explanation',
    help: 'A test.skip / it.skip / xit (or similar) has no justification nearby. Add a `// REASON:` comment on the skip line or up to 3 lines above it explaining why the test is skipped (SKIP/NOTE/WHY/TODO/FIXME prefixes also count).',
    suppress: '// REASON: <why this test is skipped>',
  },
  TDO002: {
    validator: 'todoTracking',
    title: 'Untracked TODO/FIXME annotation',
    help: 'A TODO/FIXME/HACK/XXX/TEMP/WORKAROUND comment is not tracked in any tracking doc (ROADMAP.md, CURRENT-STATE.md, TODO.md, BACKLOG.md, or docs-canonical/ equivalents). Track it there with its file location, resolve it, or exclude the path via `todoIgnore` in .docguard.json.',
    suppress: null,
  },
  TDO003: {
    validator: 'todoTracking',
    title: 'Additional untracked TODOs elided',
    help: 'Guard reports only the first 5 untracked TODO/FIXME items to avoid noise; this line counts the remainder. Track or resolve the reported items and re-run guard to surface more, or exclude noisy paths via `todoIgnore` in .docguard.json.',
    suppress: null,
  },
  SCH001: {
    validator: 'schemaSync',
    title: 'Database models found but no DATA-MODEL.md',
    help: 'Schema definitions were detected (Prisma/Drizzle/TypeORM/Sequelize/Knex/Django/Rails) but docs-canonical/DATA-MODEL.md does not exist, so the schema is undocumented. Run `docguard init` to create it, then document the models.',
    suppress: null,
  },
  SCH002: {
    validator: 'schemaSync',
    title: 'Model not documented in DATA-MODEL.md',
    help: 'A model/table found in a schema file does not appear anywhere in DATA-MODEL.md (matching is case-insensitive and singular/plural tolerant). Add it to the Entity Definitions section.',
    suppress: null,
  },
  ARC001: {
    validator: 'architecture',
    title: 'Forbidden layer import (layers config)',
    help: 'A file imports from a layer its own layer may not import, per the `layers` map in .docguard.json. Remove the import or route it through an allowed layer — or update the layers config if the architecture genuinely changed.',
    suppress: null,
  },
  ARC002: {
    validator: 'architecture',
    title: 'Circular dependency',
    help: 'A load-time import cycle was detected between source files. Break it by converting one edge to a dynamic `import()` (runtime imports do not create load-time cycle edges) or by extracting the shared code into a third module both sides import.',
    suppress: null,
  },
  ARC003: {
    validator: 'architecture',
    title: 'Layer boundary violation (ARCHITECTURE.md)',
    help: 'An import crosses a boundary the Layer Boundaries table in docs-canonical/ARCHITECTURE.md forbids. Remove or invert the import — or update the table if the rule changed, so docs and code agree.',
    suppress: null,
  },
  CSY001: {
    validator: 'canonicalSync',
    title: 'No surface docs to check',
    help: "canonical-sync found neither README.md nor AGENTS.md, so DocGuard's own surface-count claims cannot be checked. Add a README.md (this check only runs in the docguard-cli repo).",
    suppress: null,
  },
  CSY002: {
    validator: 'canonicalSync',
    title: 'Stale "ships N commands" claim',
    help: 'A surface doc (README.md/AGENTS.md) claims a command count that does not match the real user-facing command count parsed from --help (or the cli/commands file count). Update the claim.',
    suppress: null,
  },
  CSY003: {
    validator: 'canonicalSync',
    title: 'Stale "N validators" claim',
    help: "A surface doc (README.md/AGENTS.md) states a validator count that does not match guard's actual count (validator files + the inlined Doc Sections validator). Update the claim.",
    suppress: null,
  },
  CSY004: {
    validator: 'canonicalSync',
    title: 'Stale architecture-diagram counts',
    help: 'The Commands (N) / Validators (N) labels in the README mermaid architecture diagram do not match code-truth — the exact drift that went unnoticed for 5 releases. Update the mermaid block.',
    suppress: null,
  },
  SPK001: {
    validator: 'specKit',
    title: 'Spec Kit not detected',
    help: 'No .specify/ directory, specs/ folders, constitution.md, or memory/ was found. Consider adopting spec-driven development with `specify init` (github.com/github/spec-kit), or disable the specKit validator in .docguard.json if it is not wanted.',
    suppress: null,
  },
  SPK002: {
    validator: 'specKit',
    title: 'Spec Kit artifacts without .specify/ structure',
    help: 'Legacy spec/constitution/memory artifacts exist but the standard .specify/ directory is missing. Run `specify init` to create the v3+ standard structure.',
    suppress: null,
  },
  SPK003: {
    validator: 'specKit',
    title: 'spec.md quality issue',
    help: 'A spec.md is missing a mandatory template element: a required section (User Scenarios, Requirements, Success Criteria), FR-/REQ- requirement IDs, or SC- success-criteria IDs. A defect spec can opt into the narrower bugfix shape (Root Cause + Fix required instead) with the inline marker.',
    suppress: '<!-- docguard:spec-type bugfix -->',
  },
  SPK004: {
    validator: 'specKit',
    title: 'plan.md quality issue',
    help: 'A plan.md is missing a mandatory section (Summary, Technical Context, or Project Structure) per spec-kit plan-template.md. Add the section.',
    suppress: null,
  },
  SPK005: {
    validator: 'specKit',
    title: 'tasks.md quality issue',
    help: 'A tasks.md lacks a phased breakdown ("Phase 1:", "Phase 2:", …) or task IDs (T001, T002, …) per spec-kit tasks-template.md.',
    suppress: null,
  },
  SPK006: {
    validator: 'specKit',
    title: 'Spec Kit artifact unreadable',
    help: 'A spec.md/plan.md/tasks.md exists but could not be read. Check file permissions and encoding.',
    suppress: null,
  },
  SPK007: {
    validator: 'specKit',
    title: 'Constitution without AGENTS.md',
    help: 'constitution.md exists but there is no AGENTS.md. AI agents look to AGENTS.md for project rules — create one (e.g. via `docguard init`) and reference the constitution from it.',
    suppress: null,
  },
  SPK008: {
    validator: 'specKit',
    title: 'Phantom completion — checked task with no implementation evidence',
    help: 'A tasks.md task marked [x] names a deliverable path that does not exist, and no evidence tier confirms the work landed: no matching basename anywhere in the repo (moved file), no named code symbol in source, no plan.md/spec.md tie to an existing artifact, no task-ID annotation in source, and no task-ID in the git log. A checked task with no artifact corrupts agent memory — later sessions trust the checkbox and skip the work. Uncheck the task or land the implementation. Flagged low-confidence — report a false positive if the deliverable was renamed beyond recognition. Opt out with `"specKit": { "phantomCheck": false }` in .docguard.json.',
    suppress: null,
  },
  SPK009: {
    validator: 'specKit',
    title: 'Additional phantom completions elided',
    help: 'Guard reports at most 10 phantom-completion findings (SPK008) per run to avoid noise; this line counts the remainder. Fix or uncheck the reported tasks and re-run guard to surface more, or set `"specKit": { "phantomCheck": false }` in .docguard.json to disable the check.',
    suppress: null,
  },
  XRF001: {
    validator: 'crossReference',
    title: 'Broken doc link',
    help: 'A markdown link between canonical docs points to a file that does not exist (checked relative to the source doc and the project root, URL-decoded). Fix the target path or remove the dead link.',
    suppress: null,
  },
  XRF002: {
    validator: 'crossReference',
    title: 'Broken doc anchor',
    help: 'A `#anchor` link does not match any heading in the target doc (GFM slug rules). When exactly one near-miss heading exists (edit distance ≤ 2) the warning is marked [auto-fixable] and `docguard fix --write` rewrites it; otherwise pick the correct heading by hand.',
    suppress: null,
  },
  GST001: {
    validator: 'generatedStaleness',
    title: 'Generated doc stuck in draft',
    help: 'A docguard:generated doc has sat in `status: draft` beyond the staleness window (default 14 days; `draftStalenessDays` in .docguard.json). Draft the prose (e.g. `/docguard.fix --doc <name>`) and promote it to status:current, or delete the forgotten skeleton.',
    suppress: null,
  },
  GST002: {
    validator: 'generatedStaleness',
    title: 'Code-truth section stale',
    help: "A `source=code` section's body no longer matches what the scanner produces — code changed without `docguard sync --write`, or someone hand-edited a generated section. Run `docguard sync --write` (or `docguard fix --write`), or pin the section if it is intentionally hand-maintained.",
    suppress: '<!-- docguard:section id=<id> source=code pinned="reason" -->',
  },
  SSY001: {
    validator: 'surfaceSync',
    title: 'Surface entry missing glob',
    help: 'A surfaceSync.surfaces entry in .docguard.json has no `glob`, so the code-truth set cannot be discovered and the surface is skipped. Add a glob like "cli/commands/*.mjs".',
    suppress: null,
  },
  SSY002: {
    validator: 'surfaceSync',
    title: 'Surface list drift',
    help: "A doc's table/bullet inventory for a declared surface disagrees with the files its glob discovers — items exist in code but are missing from the doc, or the doc lists items with no file behind them. Update the list, or add intentional aliases/non-public items to the surface's `ignore` list.",
    suppress: null,
  },
  API001: {
    validator: 'apiSurface',
    title: 'OpenAPI spec unparseable',
    help: "The spec declares `paths:` but DocGuard's minimal parser extracted zero endpoints (unsupported YAML: $ref, anchors, folded scalars). Code scanning takes over, but the spec cannot serve as ground truth — validate it with a full OpenAPI linter.",
    suppress: null,
  },
  API002: {
    validator: 'apiSurface',
    title: 'OpenAPI specs diverge',
    help: 'Two or more specs in canonical locations disagree on their endpoint sets; the sourceRoot-nearest spec is treated as authoritative. Regenerate or delete the stale copy so they agree.',
    suppress: null,
  },
  API003: {
    validator: 'apiSurface',
    title: 'Spec-declared endpoint has no registered route',
    help: 'The OpenAPI spec declares an endpoint that no scanned route registers. Either the spec is stale (remove the endpoint) or the route is registered dynamically where the scanner cannot see it — flagged low-confidence for exactly that reason.',
    suppress: null,
  },
  API004: {
    validator: 'apiSurface',
    title: 'Documented endpoint not found in code',
    help: 'docs-canonical/API-REFERENCE.md documents an endpoint absent from the actual surface. Spec-confirmed absences are errors and `docguard fix --write` removes them; code-scan-only absences are low-confidence warnings ([code-scan — verify]) — verify before pruning.',
    suppress: null,
  },
  API005: {
    validator: 'apiSurface',
    title: 'Undocumented endpoint in code',
    help: 'A real endpoint exists in the spec/routes but is missing from docs-canonical/API-REFERENCE.md. Add a documentation block for it.',
    suppress: null,
  },
  DQ001: {
    validator: 'docQuality',
    title: 'High passive voice ratio',
    help: "More than 25% of the doc's prose sentences are passive (configurable via docQuality.passiveVoiceThreshold). Rewrite in active voice — or opt the doc out with the inline marker if passive is intentional (sequence/flow docs).",
    suppress: '<!-- docguard:quality passive-voice off — your reason -->',
  },
  DQ002: {
    validator: 'docQuality',
    title: 'High ambiguous pronoun ratio',
    help: 'Over 15% of words are ambiguous pronouns (it/this/that/they…). Replace them with the specific noun they refer to so statements stay verifiable.',
    suppress: null,
  },
  DQ003: {
    validator: 'docQuality',
    title: 'Low atomicity (compound sentences)',
    help: 'Over 35% of sentences are compound. Split them so each sentence carries one verifiable statement (IEEE 830 §4.1).',
    suppress: null,
  },
  DQ004: {
    validator: 'docQuality',
    title: 'Very low Flesch reading ease',
    help: 'The doc scores below 5/100 — effectively unreadable even for technical material (tech docs typically score 10-30). Shorten sentences and use simpler words.',
    suppress: null,
  },
  DQ005: {
    validator: 'docQuality',
    title: 'Reading grade level too high',
    help: 'Flesch-Kincaid grade above 22 (PhD+). Aim for grade 12-16 for technical docs by simplifying sentence structure and vocabulary.',
    suppress: null,
  },
  DQ006: {
    validator: 'docQuality',
    title: 'Average sentence too long',
    help: 'Average prose sentence exceeds 30 words. Break long sentences up — target 30 words or fewer.',
    suppress: null,
  },
  DQ007: {
    validator: 'docQuality',
    title: 'High negation load',
    help: 'Over 20% of sentences use negation (configurable via docQuality.negationLoadThreshold). Rephrase in positive terms ("must not fail" → "must succeed", IEEE 830 §4.3) — or opt the doc out with the inline marker (security/operational docs legitimately prohibit).',
    suppress: '<!-- docguard:quality negation-load off — your reason -->',
  },
  DQ008: {
    validator: 'docQuality',
    title: 'High conditional load',
    help: 'Over 30% of sentences are conditional (if/unless/when…). Split conditionals into separate, unconditional requirements.',
    suppress: null,
  },

  // ── v0.31.0 change-driven + IR detectors (all confidence:'low' / soft) ──
  DSP001: {
    validator: 'diff-suspicion',
    title: 'Doc describes code that just changed',
    help: 'A canonical doc (or agent-instruction file) references a code file AND shares wording with symbols removed/changed in that file since the compared revision. Deterministic diff-overlap rule (arXiv 2010.01625, F1 74.7). Low-confidence by design — re-read the doc against the current code; suppress the pairing if it is a false positive.',
    suppress: null,
  },
  REF001: {
    validator: 'reference-existence',
    title: 'Doc references a code symbol that no longer exists',
    help: 'A code-element reference in the doc matched source when the doc was last updated, but matches ZERO source instances at HEAD (two-revision check, arXiv 2212.01479). Excludes the two documented false-positive modes (removed-but-config-relevant flags, and symbols whose literal string was deleted while logic remains). Verify and update the reference.',
    suppress: '<!-- docguard:ignore REF001 — still relevant, e.g. user-facing flag -->',
  },
  REF002: {
    validator: 'reference-existence',
    title: 'Code cites an ADR that has no document',
    help: 'A code comment cites an Architecture Decision Record (e.g. ADR-012) that no ADR document defines — the citation is stale (renumbered, removed) or the ADR was never written. Numbers compare as integers, so ADR-0011 matches ADR-11. IETF RFC citations are deliberately not checked (external registry). Write the ADR, fix the number, or suppress on the citation line.',
    suppress: '// docguard:ignore REF002 — your reason',
  },
  APS001: {
    validator: 'api-doc-smells',
    title: 'Bloated API documentation',
    help: 'An API doc unit is excessively long / over-structured relative to the surface it documents (smell taxonomy, arXiv API-doc-smells; deterministic Bloated detector F1 0.90). Trim to the essential contract.',
    suppress: '<!-- docguard:quality api-smell off — your reason -->',
  },
  APS002: {
    validator: 'api-doc-smells',
    title: 'Lazy API documentation',
    help: 'An API doc unit is vague/generic or barely exceeds the signature it documents (deterministic Lazy detector F1 0.95). Document parameters, return, and errors concretely.',
    suppress: '<!-- docguard:quality api-smell off — your reason -->',
  },
};

/**
 * Build a Finding with sane defaults. `reportable` defaults to true for
 * low-confidence findings — low confidence IS the feedback signal.
 *
 * @param {Partial<Finding>} f
 * @returns {Finding}
 */
export function mkFinding(f) {
  const severity = f.severity === 'error' ? 'error' : 'warn';
  const confidence = f.confidence === 'low' ? 'low' : 'high';
  return {
    code: f.code || null,
    validator: f.validator || null,
    severity,
    confidence,
    message: f.message || '',
    location: f.location || null,
    suggestion: f.suggestion || null,
    reportable: f.reportable === true || confidence === 'low',
    redactedContext: f.redactedContext || null,
  };
}

/**
 * Derive the legacy `{ errors, warnings, passed, total }` result from a list of
 * findings, keeping `findings` attached for the rich renderer. ONE source of
 * truth — the strings guard counts and the findings guard renders can never
 * disagree because they're computed from the same array.
 *
 * @param {Finding[]} findings
 * @param {{passed?:number, total?:number, applicable?:boolean}} [opts]
 */
export function resultFromFindings(findings, opts = {}) {
  const errors = [];
  const warnings = [];
  for (const f of findings) {
    if (f.severity === 'error') errors.push(f.message);
    else warnings.push(f.message);
  }
  const res = {
    errors,
    warnings,
    passed: opts.passed || 0,
    total: opts.total != null ? opts.total : 0,
    findings,
  };
  if (opts.applicable !== undefined) res.applicable = opts.applicable;
  return res;
}

/**
 * Does an inline `docguard:ignore` pragma in `text` suppress finding `code`?
 *
 * Accepted forms (mirrors the ergonomics of eslint-disable / ruff `# noqa`):
 *   docguard:ignore                 → suppresses ANY code on the line
 *   docguard:ignore SEC001          → suppresses exactly SEC001
 *   docguard:ignore SEC001,DQ002    → comma list
 *   docguard:ignore SEC*            → prefix wildcard
 *   docguard:ignore all             → suppresses any code
 *   docguard:ignore-secret          → convenience alias for any SEC* code
 *
 * @param {string} text
 * @param {string} code
 * @returns {boolean}
 */
export function suppressesCode(text, code) {
  if (!text || !code) return false;
  const m = text.match(/docguard:ignore(-secret)?\b[ \t]*([A-Za-z0-9_,*-]+)?/i);
  if (!m) return false;
  if (m[1]) return /^SEC/i.test(code);            // ignore-secret alias
  const arg = (m[2] || '').trim();
  if (!arg) return true;                           // bare ignore → any code
  return arg.split(',').map((s) => s.trim()).some((tok) => {
    if (!tok) return false;
    if (tok.toLowerCase() === 'all') return true;
    if (tok.endsWith('*')) return code.toUpperCase().startsWith(tok.slice(0, -1).toUpperCase());
    return tok.toUpperCase() === code.toUpperCase();
  });
}

/**
 * Source-line suppression: an ignore pragma counts if it's on the flagged line
 * OR the line directly above it (so a comment can sit above the offending
 * statement, the common style for non-trailing-comment languages).
 */
export function lineSuppresses(code, line, prevLine = '') {
  return suppressesCode(line, code) || suppressesCode(prevLine, code);
}

/**
 * Flatten a one-line, colour-free rendering of a suggestion — used by JSON
 * consumers, diagnose, and the feedback body. Guard does its own coloured
 * rendering and does not use this.
 */
export function suggestionLine(s) {
  if (!s) return '';
  let out = s.text || '';
  if (s.command) out += `  →  ${s.command}`;
  else if (s.pragma) out += `  →  ${s.pragma}`;
  return out;
}
