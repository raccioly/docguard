/**
 * @implements docguard.evidence-scoped-verification#FR-010
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
 * @implements docguard.adoption-workflow-integrity#FR-002
 * @implements docguard.calibrated-finding-channels#FR-001
 * @implements docguard.calibrated-finding-channels#FR-002
 * @implements docguard.calibrated-finding-channels#FR-003
 * @implements docguard.calibrated-finding-channels#FR-004
 * @implements docguard.calibrated-finding-channels#FR-006
 * @implements docguard.calibrated-finding-channels#FR-009
 * @implements docguard.calibrated-finding-channels#FR-014
 *
 * @typedef {Object} Suggestion
 * @property {'fix'|'suppress'|'review'|'report'} kind
 * @property {string}  text             One concise line: what to do next.
 * @property {string} [command]         Optional CLI/skill command to run.
 * @property {string} [pragma]          Optional inline suppression snippet.
 *
 * @typedef {Object} Finding
 * @property {string}      code          Stable code, e.g. 'SEC001' (see CODES).
 * @property {'product'|'test-path'} [context]  Where the evidence sits; set by Security for SEC001-SEC004 only.
 * @property {string}      validator     Owning validator key.
 * @property {'error'|'warn'} severity    Does CI block? (intrinsic; policy may reweight)
 * @property {'high'|'low'} confidence   How sure the detector is of its OBSERVATION.
 *                                       'low' = candidate false positive. NOT a triage
 *                                       signal and NOT a measured rate — see the two
 *                                       channels below (docguard.calibrated-finding-channels).
 * @property {'act'|'escalate'} disposition  Who decides. 'act' = DocGuard asserts a
 *                                       defect and names the correction; 'escalate' =
 *                                       DocGuard reports a signal whose judgement belongs
 *                                       to the reader. Orthogonal to severity and confidence:
 *                                       a certain observation can still be an escalation
 *                                       (FRS002: the commit count is a fact; staleness is not).
 * @property {FindingEvidence} evidence  Whether the reviewed corpus has ever measured this
 *                                       code. 'not-measured' is the honest answer for most
 *                                       codes; it is never inherited from a sibling code.
 * @property {ParserTier}  parserTier    Which analyzer tier produced the evidence. Computed
 *                                       at run time; 'not-applicable' for doc-only findings.
 * @property {string}      message       Concise, NO ansi colour.
 * @property {string|null} location      'path:line' or 'path'. Always a string or null.
 * @property {string[]} [mirrors]       Present only for mirror copies (AGENTS.md, CLAUDE.md, a skill under two agent roots), in report
 *                                       order with `location` first: every path that carries the same finding when identical copies
 *                                       collapse into one; for PSR007 and PSR008, every copy on either side of the drift.
 * @property {Suggestion|null} suggestion
 * @property {boolean}     reportable    Surface in `docguard feedback`: true when the code is
 *                                       unmeasured OR confidence is low — so the feedback
 *                                       loop samples exactly the findings whose label has
 *                                       never been validated, not only the ones it doubts.
 * @property {string|null} redactedContext  Safe-to-share context for a report.
 *
 * @typedef {'js-ast'|'py-ast'|'regex-fallback'|'fallback-language'|'mixed'|'not-applicable'} ParserTier
 *
 * @typedef {Object} FindingEvidence
 * @property {'measured'|'not-measured'} status
 * @property {number}  [n]                Labelled findings behind the estimate.
 * @property {number|null} [precision]    Point estimate ONLY when n meets the published floor.
 * @property {number[]} [precisionInterval]  Wilson 95% [lower, upper].
 * @property {boolean} [quotable]
 * @property {string}  [measuredOnVersion]
 * @property {boolean} [measuredOnRunningVersion]
 */

import { readFileSync } from 'node:fs';
import { evidenceForCode, PRECISION_EVIDENCE } from './precision-evidence.mjs';
import { isExpired, splitWaiverMetadata } from './waiver-metadata.mjs';

/**
 * Stable finding-code registry. `docguard explain <CODE>` reads this, and
 * inline `// docguard:ignore <CODE>` keys off it. Keep codes append-only — a
 * published code is a public surface we don't renumber.
 *
 * `defaultLevel: 'info'` makes a code informational for the exit code unless
 * `findingSeverity.<CODE>` says otherwise. A finding's own `severity` stays
 * `error` or `warn` (the documented contract: `info` is an enforcement level
 * only), so the code's default lives here, beside its title and help.
 */
export const CODES = {
  __proto__: null,
  SEC001: {
    validator: 'security',
    title: 'Hardcoded password',
    help: 'A `password`/`passwd`/`pwd` assignment with a quoted literal value (8+ chars). A password label is skipped: a capitalised word for "password" in a common language (`Password`, `Contraseña`, `Mot de passe`, `パスワード`), a short letter-only phrase containing one (`Confirm Password`), or the key\'s own words, unless the key is an all-caps constant such as `DB_PASSWORD`. Other natural-language UI copy or validation messages are flagged low-confidence; suppress inline if the value is not a credential. A value that names itself a placeholder (`placeholder`, `synthetic`, `not-a-real`, `notreal`, `dummy`, `changeme`, `change-me`, or one repeated character) is not reported. Every SEC001-SEC004 finding carries `context: product` or `test-path`; the level is the same either way, but a `test-path` finding can never be a gating finding.',
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
    validator: 'docSections',
    title: 'Missing required doc section',
    help: 'A canonical doc exists but lacks a section its document type requires. The doc is read where its role resolves: a `docs.roles` mapping, the `docs-canonical/` default, or the one same-named entry of `requiredFiles.canonical` (spec 093). Add the section — or, if it is genuinely not applicable, own the absence with an inline marker: `<!-- docguard:section <slug> n/a — reason -->`.',
    suppress: '<!-- docguard:section <slug> n/a — reason -->',
  },
  STR004: {
    validator: 'structure',
    title: 'Agent instruction chain exceeds its byte budget',
    help: 'Codex concatenates AGENTS.md files from the repository root down to the working directory (AGENTS.override.md replaces AGENTS.md in its directory) and stops reading at project_doc_max_bytes, 32768 bytes by default. Text past the limit is dropped without warning, and the nested, most specific rules come last. Move long procedures into linked documents, remove duplicated rules, or — for existing debt — record an allowance in `agentInstructions.allowances` (keyed by the deepest file) so the chain can shrink but any growth is a reviewed configuration change. The budget itself is `agentInstructions.maxBytes`.',
    suppress: null,
  },
  STR005: {
    validator: 'structure',
    defaultLevel: 'info',
    title: 'Instruction allowance has slack',
    help: 'An allowance in `agentInstructions.allowances` is at least 1024 bytes above the chain it covers. The chain shrank; lower the allowance to the current size (or remove it when the chain is within the default budget) so it cannot grow back unnoticed. Informational: it never changes the exit code unless `findingSeverity.STR005` says so.',
    suppress: null,
  },
  STR006: {
    validator: 'docSections',
    title: 'Canonical doc is an unedited scaffold',
    help: 'A canonical doc holds nothing a reader wrote beyond the template `docguard init` created it from: every line is template text, an HTML-comment placeholder, an empty table cell, the Metadata table or a date. It scores as unfinished in docQuality, ALCOA+ Legible and Machine markers. Write the document (or run `docguard generate --plan --write`, which fills code-derived sections), or — if it is intentionally blank — own it with `<!-- docguard:section scaffold n/a — reason -->` (any reasoned section N/A marker owns the document, and it is then scored as written). A placeholder owner or unchosen status alone is not reported: `generate --plan --write` leaves both. A document that `docs.roles` remaps is compared with the template of its role.',
    suppress: '<!-- docguard:section scaffold n/a — reason -->',
  },
  STR007: {
    validator: 'docSections',
    defaultLevel: 'info',
    title: 'Section the active profile requires is missing',
    help: 'A profile can require sections beyond the canonical ones (the `enterprise-ai` profile requires Risk Assessment and Threat Model in SECURITY.md; `requiredSections` in `.docguard.json` adds more). Add the heading, or own its absence with `<!-- docguard:section <slug> n/a — reason -->`. Informational by default (spec 082): it never changes the exit code unless `findingSeverity.STR007` says so.',
    suppress: '<!-- docguard:section <slug> n/a — reason -->',
  },
  STR008: {
    validator: 'structure',
    title: 'Backup copy of a document in a documentation directory',
    help: 'A file inside a documentation directory (`docs`, `docs-canonical`, `docs-implementation`, `documentation`, `doc`, at any depth) is named like a backup of a document: `ARCHITECTURE.md.bak`, `.orig`, `.backup`, a trailing `~`, `SECURITY copy.md`, `API (1).md`, `DATA-old.md` or `DATA.old.md`. DocGuard reads no backup as a document (it is not a canonical document, not reviewed by Freshness, not read for cross-references, not listed by `docguard llms`) and never lets one stand in for a missing role document, so it is dead weight that can still mislead a reader. `docguard generate --force` and `docguard init --force` write a `.bak` beside the file they replace. Delete it (git keeps the history), add it to `.gitignore`, or, if it is a real document, rename it or list it in `fileKinds.own`. A document below an `archive/`, `old/`, `backup/` or `deprecated/` folder of a documentation directory also leaves the document role, but only the file name makes this finding: an archive is usually kept on purpose. `guard --format json` lists what was left out under `files.kinds.excluded.backup`. The finding reads tracked files only; the first ten are listed, then a count.',
    suppress: null,
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
    help: 'A docguard-bound "N checks/validators" number in a doc no longer matches the tool\'s actual count. "1,183 checks" reads as 1183; a ratio ("8/8 checks") or an identifier ("FR-365 checks") is not a count. `docguard fix --write` rewrites it, keeping the doc\'s digit grouping (fail-closed: only docguard-bound lines, with provenance).',
    suppress: null,
  },
  MET002: {
    validator: 'metricsConsistency',
    title: 'Documented count drifted from a declared collection',
    help: 'A doc states "N <noun>" for a noun declared in `config.collections`, but the collection glob matches a different number of files. Either the doc is stale (fix with `docguard fix --write`) or the code lost/gained members unintentionally — check which side is wrong before fixing.',
    suppress: null,
  },
  MET003: {
    validator: 'metricsConsistency',
    title: 'Documented test count is below the declared test cases',
    help: 'A line about the project\'s own test suite ("npm test # N tests", "N tests passing") states fewer tests than the test files declare. An identifier ("FR365 tests") and a count of something else ("20 test files", "3 test suites") are not test-case counts. The declared count is a static lower bound of what the runner reports (cases generated in loops are not expanded), so a smaller documented number is stale for certain, but the true number is only known by running the suite. Run it and update the count by hand; there is no mechanical fix.',
    suppress: null,
  },
  MET004: {
    validator: 'metricsConsistency',
    title: 'Documented runtime-dependency count disagrees with package.json',
    help: 'A document (including the Spec Kit constitution) states how many runtime dependencies the project has ("zero runtime dependencies", "Dependencies: None", "one npm dependency"), and package.json `dependencies` declares a different number. Only qualified wording counts, so "no dependencies between modules" is never compared. The claim may be stale, or a dependency may have been added that the project promised not to take: decide which side is wrong. There is no mechanical fix.',
    suppress: null,
  },
  FRS001: {
    validator: 'freshness',
    title: 'Document review signal unavailable',
    help: 'No committed update or dated review signal was found. Review the document’s intended behavior and implementation before recording a review date. An approved status is an author signal, not semantic verification. Agent-instruction documents come from one role (spec 094): root AGENTS.md, CLAUDE.md, GEMINI.md, `.github/copilot-instructions.md`, configured `requiredFiles.agentFile`, nested AGENTS/CLAUDE/GEMINI files, and harness rules and skills. A pointer file (a body of at most 6 lines, at most 2 of them naming no file, that imports a file or names another agent-instruction document, such as `Follow AGENTS.md` or `@AGENTS.md`) is reviewed through its target and gets no finding of its own; a copy installed by Spec Kit, a Spec Kit extension, DocGuard or a tool that marks it `<!-- generated by <tool> -->` is reviewed upstream (PSR005 checks a Spec Kit copy still matches its install manifest).',
    suppress: null,
  },
  FRS002: {
    validator: 'freshness',
    title: 'Document review due after repository activity',
    help: 'At least 10 code commits followed the document update or review. This repository-wide heuristic does not prove the document is stale. Review its purpose, intended behavior and relevant code before deciding which side needs a change. Agent-instruction documents come from one role (spec 094): root AGENTS.md, CLAUDE.md, GEMINI.md, `.github/copilot-instructions.md`, configured `requiredFiles.agentFile`, nested AGENTS/CLAUDE/GEMINI files, and harness rules and skills. A pointer file (a body of at most 6 lines, at most 2 of them naming no file, that imports a file or names another agent-instruction document, such as `Follow AGENTS.md` or `@AGENTS.md`) is reviewed through its target and gets no finding of its own; a copy installed by Spec Kit, a Spec Kit extension, DocGuard or a tool that marks it `<!-- generated by <tool> -->` is reviewed upstream (PSR005 checks a Spec Kit copy still matches its install manifest).',
    suppress: null,
  },
  FRS006: {
    validator: 'freshness',
    title: 'Agent instructions name a file that changed since their review',
    help: 'An agent-instruction document (AGENTS.md, CLAUDE.md, GEMINI.md, Copilot instructions, an authored skill or rule) names a file in backticks, a link or a path, and at least `freshness.referenceShare` (default 0.5) of that file\'s current lines were added since the document was reviewed. The review point is a recorded review (`docguard review --accept <doc>`), whose fingerprint must also have changed, or else the `docguard:last-reviewed` marker; a line of the document edited after the review is measured from that edit. Directories, vendored copies, other documents, test/fixture/example paths, changelogs, lockfiles, claims/evidence JSON, DocGuard state files, generated files and files under 20 lines are not measured. Read what the document says about each named file against the file now, update it, and record the review. Agent instructions are executed by every session, so this is reported for that role only; canonical documents carry the same evidence on FRS002 (spec 095). Make it fail the build with `findingSeverity: { "FRS006": { "agent-instruction": "high" } }`.',
    suppress: null,
  },
  FRS007: {
    validator: 'freshness',
    title: 'Agent instructions never mention surface added since their review',
    help: 'A package script (`package.json` `scripts`) or a top-level directory was added after the agent-instruction document\'s review point, and neither the document nor a pointer file that points to it mentions it (`npm run <name>`, `` `<name>` ``, or the directory as a whole word). Surface that existed at the review is not reported: this is about what changed, not about completeness. Decide whether agents need to know about it, say so, and record the review with `docguard review --accept <doc>` (spec 095).',
    suppress: null,
  },
  FRS009: {
    validator: 'freshness',
    title: 'Review date advanced without a recorded review',
    help: 'A document\'s `docguard:last-reviewed` marker is later than its recorded review, and the commit that set it changed nothing else in the document. A date alone does not say what was checked, so staleness is still measured from the recorded review. If the document was reviewed, record it with `docguard review --accept <doc> --reason "…"` (spec 095).',
    suppress: null,
  },
  FRS010: {
    validator: 'freshness',
    title: 'Recorded document reviews cannot be read',
    help: '`.docguard-doc-reviews.json` is not valid JSON, has an unsupported `schemaVersion`, or has a field outside the schema. Every recorded review is then unusable, so this fails instead of reading as "no reviews". Restore the file from git, or delete it and record the reviews again. A new field belongs under an `extensions` object (top level or per document), which every reader ignores (spec 095).',
    suppress: null,
  },
  FRS003: {
    validator: 'freshness',
    title: 'Document review due after elapsed repository history',
    help: 'The document update or review predates the latest code change by more than 30 days. This repository-wide heuristic does not establish drift. Review relevance and intent before changing documentation or code. Agent-instruction documents come from one role (spec 094): root AGENTS.md, CLAUDE.md, GEMINI.md, `.github/copilot-instructions.md`, configured `requiredFiles.agentFile`, nested AGENTS/CLAUDE/GEMINI files, and harness rules and skills. A pointer file (a body of at most 6 lines, at most 2 of them naming no file, that imports a file or names another agent-instruction document, such as `Follow AGENTS.md` or `@AGENTS.md`) is reviewed through its target and gets no finding of its own; a copy installed by Spec Kit, a Spec Kit extension, DocGuard or a tool that marks it `<!-- generated by <tool> -->` is reviewed upstream (PSR005 checks a Spec Kit copy still matches its install manifest).',
    suppress: null,
  },
  FRS004: {
    validator: 'freshness',
    title: 'Release-note review due',
    help: 'The changelog update predates the latest code change by more than a week. Review whether these changes need release notes; timing alone does not prove entries are missing.',
    suppress: null,
  },
  FRS005: {
    validator: 'freshness',
    title: 'Deviation-log review due',
    help: 'Recent code commits added DRIFT comment lines. Review whether the deviations are already recorded or resolved; history alone does not prove the log is incomplete.',
    suppress: null,
  },
  DSY001: {
    validator: 'docsSync',
    title: 'Route not referenced in canonical docs',
    help: 'A route file exists but no docs-canonical .md file names it. Only text a reader sees counts: a name inside an HTML comment, such as a template placeholder, does not. A Next.js route handler (`app/api/**/route.ts`) is named by the URL path it serves (`/api/users/{id}`, `GET /api/users/:id`, or its file path), and `/api/users/*` names the routes under it; the word `route` names none. Any other route is named by its path, file name or module name (the file name without its extension) as a whole name, so `users` or `user-service` does not document `user`. A module name that several checked files share needs its directory (`auth/types`), and an `index` file is named by its directory (`routes/users`) or `users/index`. A file tree drawn in a doc (`├──`, `└──`) names the paths it lists, and a `docguard:section` marker whose `covers` lists the file documents it too. Reference the route in a canonical doc (e.g. ARCHITECTURE.md or an API doc) so the documented surface matches the code.',
    suppress: null,
  },
  DSY002: {
    validator: 'docsSync',
    title: 'Service not referenced in canonical docs',
    help: 'A service/lib file exists but no docs-canonical .md file names it. Only text a reader sees counts: a name inside an HTML comment, such as a template placeholder, does not. Its path, file name or module name (the file name without its extension) must appear as a whole name, so `users` or `user-service` does not document `user`. A module name that several checked files share needs its directory (`auth/types`), and an `index` file is named by its directory (`services/auth`) or `auth/index`. A file tree drawn in a doc (`├──`, `└──`) names the paths it lists, and a `docguard:section` marker whose `covers` lists the file documents it too. Reference the service in a canonical doc (e.g. ARCHITECTURE.md) so the documented surface matches the code.',
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
    help: 'The tech named in docs-canonical/ARCHITECTURE.md and the technologies the code shows disagree. The code side reads the dependency manifests of every ecosystem (package.json across the monorepo, pyproject/requirements, go.mod, Gemfile, Cargo.toml, composer.json, *.csproj, Maven/Gradle), a Dockerfile or compose file, and .tf files; DynamoDB and Docker are also found from unambiguous source text in product files (a DynamoDB API target or endpoint, `docker run`/`build`/`compose` in a script, Makefile or CI workflow, a compose file), and the message names that file. A documented technology is reported missing only where a manifest could have shown it (see docs/reference/languages.md); a project with no manifest is not checked. Drift is two-sided — document the new tech or remove the stale entries after checking which side is wrong. A technology is not read as documented when a negator governs it (`no CDK, Terraform or Pulumi stacks` negates every item of the list; `No Docker, Express serves the API` negates Docker only), when a removal or migration verb takes it as its object (`removed Terraform`, `migrated off Terraform`, `was replaced by` — but not `removed all Redis keys`), or when it appears under a Revision History, Changelog or Release Notes heading, which describe past state.',
    suppress: null,
  },
  DDF002: {
    validator: 'docsDiff',
    title: 'Test Files drift',
    help: 'The test files documented in docs-canonical/TEST-SPEC.md and the test files on disk disagree. A documented test is a backticked `*.test.*`/`*.spec.*` name or one matching `testPatterns`/`testPattern` in .docguard.json, the same patterns the code side uses. Add entries for new tests or remove documented tests that no longer exist — TEST-SPEC.md entries may be glob patterns, and a brace pattern (`src/tests/{alpha,beta}.test.ts`, `foo.{test,spec}.ts`) documents every path it expands to (single level, at most 64 expansions); a brace glob (`src/**/*.test.{js,jsx}`) is one pattern that documents what any alternative matches.',
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
    help: 'ENVIRONMENT.md lacks both a Prerequisites and a Setup Steps heading. Headings match as STR003 matches them: any case, section numbers allowed, synonyms such as "Getting Started" accepted. Add a Setup Steps section describing how to get the project running from a fresh clone.',
    suppress: null,
  },
  ENV002: {
    validator: 'environment',
    title: 'Missing Environment Variables section',
    help: 'ENVIRONMENT.md has no Environment Variables heading (matched as STR003 matches headings: any case, section numbers allowed, synonyms such as "Env Vars" accepted; "Environment" and "Configuration" only as the whole heading or followed by a word such as "Reference", "Variables" or "(.env)", so "Configuration Files" or "Production environment" does not count). Add the section and document each variable the app reads — backticked names or a pipe table both count.',
    suppress: null,
  },
  ENV003: {
    validator: 'environment',
    title: 'Env vars used in code but undocumented',
    help: "Variables read in code (process.env / import.meta.env, os.environ, os.Getenv, ENV[...], System.getenv, Spring ${X} placeholders, and the C#, PHP and Rust forms) were not found in ENVIRONMENT.md or .env.example. Document each listed variable in the doc, or add it to .env.example — either counts as documentation.",
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
    title: 'Requirement ID without a recognized test annotation or label',
    help: 'A documented requirement has no recognized annotation or test label in the scanned tests. This is a traceability gap, not proof of missing behavioral coverage. Review existing tests and add an `@req <ID>` annotation or ID test label only where the requirement is verified. Write a test only if coverage is actually missing.',
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
    help: 'A TODO/FIXME/HACK/XXX/TEMP/WORKAROUND comment is not tracked in any tracking doc (ROADMAP.md, CURRENT-STATE.md, TODO.md, BACKLOG.md, or docs-canonical/ equivalents). Track it there with its file location, resolve it, or exclude the path via `todoIgnore` in .docguard.json. Only real comments count: a keyword inside a string, or quoted in backticks within a comment, is a quotation and is not reported.',
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
    help: 'Database models were detected (Prisma, Drizzle, Mongoose, TypeORM, Sequelize, Django, SQLAlchemy or SQLModel models, or Knex and Rails migration tables) but docs-canonical/DATA-MODEL.md does not exist, so the schema is undocumented. Run `docguard init` to create it, then document the models.',
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
    help: 'A surface doc (README.md/AGENTS.md) states a validator count that does not match the validator modules shipped in the package. Guard can emit multiple check results from one module; those do not increase the public validator count. Update the claim.',
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
  SPK010: {
    validator: 'specKit',
    title: 'Completed task names a file the feature never changed',
    suppress: '<!-- docguard:ignore SPK010 — task invokes this file rather than changing it -->',
    help: 'A tasks.md task marked [x] names a deliverable path that EXISTS but that no commit since this feature began — and no uncommitted change — ever touched. A path git cannot observe (ignored and untracked, such as a local diagnostic receipt) is never reported: its absence from history proves nothing. SPK008 asks whether the artifact exists; a task naming files that already existed passes that check whether or not the work happened, which is how a skill file listed in a completed documentation task shipped unmodified in this repository. The git fact is exact, so this is high-confidence, but it is an ESCALATION, not a verdict: a task may legitimately name a file as context, invoke it rather than change it, or the work may have landed under a different path. Read the task, then either do the work, correct the task text, or uncheck it. Suppress one task with `<!-- docguard:ignore SPK010 — reason -->` on its line; opt out entirely with `"specKit": { "untouchedClaimCheck": false }` in .docguard.json.',
  },
  SPK011: {
    validator: 'specKit',
    title: 'Additional untouched claims elided',
    help: 'Guard reports at most 10 untouched-claim findings (SPK010) per run to avoid noise; this line counts the remainder. Resolve the reported tasks and re-run guard to surface more, or set `"specKit": { "untouchedClaimCheck": false }` in .docguard.json to disable the check.',
    suppress: null,
  },
  SPK012: {
    validator: 'specKit',
    title: 'Two feature directories share a spec number',
    help: 'Two or more top-level `specs/` feature directories use the same numeric prefix (for example `016-a` and `016-b`), usually because parallel agents each picked "the next number" from their own checkout. References to "spec 016" become ambiguous and tools that key on the number pick one arbitrarily. Renumber the later feature with `git mv` and update references. Projects that create specs in parallel can set Spec Kit\'s `feature_numbering` to `timestamp` in `.specify/init-options.json`.',
    suppress: null,
  },
  // docguard.aidlc-profile — AWS AI-DLC records after the workflow; advisory by default.
  AID001: { validator: 'aidlc', title: 'AI-DLC traceability target no longer exists', help: 'An AI-DLC traceability.json row marked OK or Deferred names a workspace path that no longer exists: the code it was traced to at the gate was renamed or removed. Point the requirement at the code that implements it now, or reopen it. Withheld while an observation gap stands. Informational by default.', suppress: null, defaultLevel: 'info' },
  AID002: { validator: 'aidlc', title: 'AI-DLC gap left in a completed stage', help: 'A traceability row is GAP or ORPHAN in a stage aidlc-state.md marks completed. AI-DLC\'s traceability sensor is advisory by default, so a gate can close with gaps. Build the requirement, record it Deferred/N/A with a reason, or fix the orphan. Informational by default.', suppress: null, defaultLevel: 'info' },
  AID003: { validator: 'aidlc', title: 'AI-DLC unit deliverable removed after the unit', help: 'A path a unit\'s source-manifest.json claims existed when the manifest was committed and no longer exists. Paths the unit itself deleted are not reported. Confirm the move or removal was intended and update the record. Withheld while an observation gap stands. Informational by default.', suppress: null, defaultLevel: 'info' },
  AID004: { validator: 'aidlc', title: 'AI-DLC record unreadable', help: 'A traceability.json or source-manifest.json is not valid JSON in AI-DLC\'s shape, or names a path that escapes the project. Restore the file or regenerate the stage output. Informational by default.', suppress: null, defaultLevel: 'info' },
  // docguard.memory-governance — agent memory that names what is gone; advisory by default.
  MEM001: { validator: 'aidlc', title: 'Learned rule names something gone', help: 'A rule in an AI-DLC memory layer (memory/org.md, team.md, project.md or phases/*.md) names, in backticks, a path that no longer exists or an environment variable no code or env example uses. The rule keeps steering every later stage. Update or retire it through AI-DLC; DocGuard never edits memory layers. Withheld while an observation gap stands. Informational by default.', suppress: null, defaultLevel: 'info' },
  MEM002: { validator: 'aidlc', title: 'CodeKB names a path that is gone', help: 'A file in an AI-DLC CodeKB (codekb/<repo>/*.md) names, in backticks, a path that no longer exists, so agents load a stale map of the code. Rerun AI-DLC reverse engineering for that repository. Informational by default.', suppress: null, defaultLevel: 'info' },
  // docguard.decision-records — advisory by default (docguard.enforcement-ladder).
  DEC001: { validator: 'decisionRecords', title: 'ADR status missing or unknown', help: 'An ADR has no status line, or one that is not proposed, accepted, rejected, deprecated or superseded (Approved, Draft, Proposal, Obsolete and Replaced are read as synonyms). Without a known status nobody can tell whether the decision is in force. Informational by default.', suppress: null, defaultLevel: 'info' },
  DEC002: { validator: 'decisionRecords', title: 'Decision link names no record', help: 'A Supersedes / Superseded-by link, or an index row, names an ADR number that no decision record defines. Fix the number or write the record. Withheld while an observation gap stands (spec 081). Informational by default.', suppress: null, defaultLevel: 'info' },
  DEC003: { validator: 'decisionRecords', title: 'One-way supersession', help: 'One ADR says it supersedes (or is superseded by) another, and the other does not say the reverse, so a reader of the older record follows a decision that is no longer in force. Make both records name each other and set the older one to superseded. Informational by default.', suppress: null, defaultLevel: 'info' },
  DEC004: { validator: 'decisionRecords', title: 'Superseded status and successor disagree', help: 'An ADR is superseded but names no successor, or names a successor while its status is still something else. Add the link or correct the status. Informational by default.', suppress: null, defaultLevel: 'info' },
  DEC005: { validator: 'decisionRecords', title: 'ADR index disagrees with the record', help: 'The ADR index table gives a status that differs from the record\'s own status line. Make the row match the record. Informational by default.', suppress: null, defaultLevel: 'info' },
  DEC006: { validator: 'decisionRecords', title: 'Question with no answer', help: 'A Spec Kit clarification (`- Q: … → A:`) or an AI-DLC `[Answer]:` tag has no answer, so whatever was written after it rests on a guess. Answer it and revisit those artifacts, or remove the question. Informational by default.', suppress: null, defaultLevel: 'info' },
  // docguard.upstream-coverage — the spec → plan → tasks chain. Advisory by
  // default (docguard.enforcement-ladder): promote with findingSeverity.
  SPK013: {
    validator: 'specKit',
    title: 'Requirement no task or plan cites',
    help: 'spec.md defines this FR/SC ID, and tasks.md cites requirement IDs, but neither tasks.md nor plan.md names this one, so nothing plans its implementation on purpose. Add a task (or a plan decision) that names it, or remove the requirement. A task list that cites no IDs at all is not checked. Informational by default; `docguard policy` shows when it is quiet enough to promote with `findingSeverity`.',
    suppress: null,
    defaultLevel: 'info',
  },
  SPK014: {
    validator: 'specKit',
    title: 'Task or plan cites a requirement the spec does not define',
    help: 'tasks.md or plan.md cites an unqualified FR/SC ID that spec.md does not define: the spec was renumbered or trimmed, or the ID belongs to another spec. Point it at the requirement it means, or qualify it (`spec 013 FR-020`, `docguard.other-spec#FR-020`). IDs inside inline code, fences and HTML comments are ignored. Informational by default.',
    suppress: null,
    defaultLevel: 'info',
  },
  SPK015: {
    validator: 'specKit',
    title: 'Spec Kit artifact names no upstream',
    help: 'plan.md names neither spec.md nor any requirement ID it defines, or tasks.md names neither plan.md, spec.md nor any such ID, so nothing shows it was made from them. Link the upstream artifact or cite the requirements it addresses. Informational by default.',
    suppress: null,
    defaultLevel: 'info',
  },
  SPK016: {
    validator: 'specKit',
    title: 'User story with no labeled task',
    help: 'tasks.md labels tasks with [USn], and no task carries this story\'s label, so the story is unplanned. Plan and label its tasks, or drop the story. A task list without [USn] labels is not checked. Informational by default.',
    suppress: null,
    defaultLevel: 'info',
  },
  SPK009: {
    validator: 'specKit',
    title: 'Additional phantom completions elided',
    help: 'Guard reports at most 10 phantom-completion findings (SPK008) per run to avoid noise; this line counts the remainder. Fix or uncheck the reported tasks and re-run guard to surface more, or set `"specKit": { "phantomCheck": false }` in .docguard.json to disable the check.',
    suppress: null,
  },
  DLC001: {
    validator: 'documentLifecycle',
    title: 'Terminal document remains in active context',
    help: 'A tracked Markdown file declares itself superseded, deprecated, obsolete, or archived but remains searchable as current repository context. Confirm its outcomes are represented in current docs, then use `docguard retire --write --path <path> --reason <reason>`.',
    suppress: null,
  },
  DLC002: {
    validator: 'documentLifecycle',
    title: 'Completed task list needs lifecycle review',
    help: 'A spec has checked tasks and no open tasks. This is a review signal, not proof that the feature shipped. Confirm release evidence and current documentation before archiving the spec.',
    suppress: null,
  },
  DLC003: {
    validator: 'documentLifecycle',
    title: 'Document lifecycle coverage incomplete',
    help: 'DocGuard could not enumerate or read every tracked Markdown document. Fix Git access or file readability and rerun guard; an incomplete lifecycle scan must not be interpreted as a clean result.',
    suppress: null,
  },
  DLC004: {
    validator: 'documentLifecycle',
    title: 'Retired document remains active',
    help: 'The retirement manifest records this path, but the document still exists in the working tree. Remove it through the reviewed retirement transaction or remove the incorrect manifest event; the two states must agree.',
    suppress: null,
  },
  SPR001: {
    validator: 'specRegistry',
    title: 'Spec registry missing or stale',
    help: 'The committed `.docguard-specs.json` does not match the deterministic projection of current specs, tasks, tests, and archive tombstones. Run `docguard specs --write`, review the diff, and commit it with the behavior change.',
    suppress: null,
  },
  SPR002: {
    validator: 'specRegistry',
    title: 'Spec identity missing or reused',
    help: 'Every active spec needs one immutable lowercase Spec ID in authoritative metadata. IDs survive moves and retirement and may never be reused. Add `**Spec ID**: ` followed by a unique namespaced ID in backticks.',
    suppress: null,
  },
  SPR003: {
    validator: 'specRegistry',
    title: 'Spec registry is invalid',
    help: 'The registry is malformed or contains an unsupported lifecycle value. DocGuard refuses to overwrite invalid reviewed state. Repair the named field, then run `docguard specs --write`.',
    suppress: null,
  },
  SPR004: {
    validator: 'specRegistry',
    title: 'Spec lifecycle contradicts storage',
    help: 'Working-tree presence, lifecycle context, storage state, and the recovery archive disagree. Active specs must be current/working_tree; retired specs must be retired/git_history with a reason and matching archive event.',
    suppress: null,
  },
  DLK001: {
    validator: 'docDependency',
    title: 'Code a reviewed doc section describes has changed',
    help: 'A `docguard:section` declares `covers="path#symbol, …"`, and `.docguard-doc-lock.json` records what that code looked like when the section was last reviewed. The fingerprint of a covered dependency no longer matches: the symbol\'s normalized AST changed (formatting, comments and line moves do not count), or the file\'s bytes changed where no parser applies. Read the change (the finding carries the `git diff` command), update the prose if it no longer holds, then record the review with `docguard review --accept <doc>#<section> --reason "<what you checked>"`. This is a review signal: DocGuard knows the code changed, not whether the prose is now wrong.',
    suppress: null,
  },
  DLK002: {
    validator: 'docDependency',
    title: 'Covered dependency no longer exists',
    help: 'A path or symbol named in a section\'s `covers=` attribute does not resolve: the file was moved or deleted, the symbol was renamed, or the path is outside the project, a symlink, or excluded by .docguardignore. Fix the declaration to name what the section now describes, update the prose, and accept the review again.',
    suppress: null,
  },
  DLK003: {
    validator: 'docDependency',
    title: 'Covered section has no accepted review',
    help: 'A section declares `covers=` but `.docguard-doc-lock.json` has no entry for it, or its declared dependencies changed since the last review. Read the section against the code and run `docguard review --accept <doc>#<section> --reason "<what you checked>"`. Only this command writes the lock; sync, fix and agents never do.',
    suppress: null,
  },
  DLK004: {
    validator: 'docDependency',
    title: 'Doc lock entry has no section',
    help: 'The lock records a review for a `doc#section` that no longer declares `covers=` (the section was removed, renamed, or its attribute dropped). Run `docguard review --prune` to remove entries without a section.',
    suppress: null,
  },
  DLK005: {
    validator: 'docDependency',
    title: 'Doc lock file is unreadable',
    help: '`.docguard-doc-lock.json` does not parse or does not match its schema (schemas/docguard-doc-lock.schema.json). Nothing in it can be trusted, so no section is reported current. Restore it from git, or delete it and accept each covered section again.',
    suppress: null,
  },
  ANC001: {
    validator: 'requirementAnchors',
    title: 'Code a reviewed requirement link anchors has changed',
    help: 'A tag such as `@implements acme.billing#FR-003` anchors a requirement to the code below it, and `.docguard-anchor-lock.jsonl` records that code\'s fingerprint from the last review. The fingerprint no longer matches: the normalized code changed (formatting, comments and line moves do not count). Read the change (the finding carries the command), confirm the code still meets the requirement, then record the review with `docguard anchors accept --link <key> --reason "<what you checked>"`. A warning by default; an error under `anchors.failOn: reviewed-exact` for reviewed, exact-tier, symbol-scope links.',
    suppress: null,
  },
  ANC002: {
    validator: 'requirementAnchors',
    title: 'Requirement text changed since its code link was reviewed',
    help: 'The requirement block a reviewed link cites has changed since the review (whitespace-only edits do not count). The code may no longer meet the new wording. Read both, then accept the link again with a reason, or `docguard anchors accept --spec <id> --bulk --reason "…"` for every link of the spec. Never an error.',
    suppress: null,
  },
  ANC003: {
    validator: 'requirementAnchors',
    title: 'A reviewed requirement link lost its code',
    help: 'The lock records a reviewed or baselined link whose tag no longer exists, while the requirement still does: the implementation was deleted or the tag was dropped. Restore the tag where the requirement is now implemented, or remove the link with `docguard anchors accept --remove <key> --reason "…"`.',
    suppress: null,
  },
  ANC004: {
    validator: 'requirementAnchors',
    title: 'Requirement link has no review yet',
    help: 'A tag anchors a requirement to code, and the project has an anchor lock, but this link has never been accepted. Reported by `docguard anchors` only, never by guard. Read the code against the requirement, then `docguard anchors accept --link <key> --reason "…"`.',
    suppress: null,
  },
  ANC005: {
    validator: 'requirementAnchors',
    title: 'Anchor lock file is unreadable',
    help: '`.docguard-anchor-lock.jsonl` does not parse, has an unsupported header, or has a line that does not match schemas/docguard-anchor-lock.schema.json. Nothing in it can be trusted, so no link is reported current. Restore it from git, or delete it and baseline again with `docguard anchors accept --baseline --bulk --reason "…"`.',
    suppress: null,
  },
  ANC006: {
    validator: 'requirementAnchors',
    title: 'Requirement tag scope is ambiguous or did not resolve',
    help: 'A tag sits where its scope is unclear (a file header directly above a declaration), asks for a scope that does not resolve (`{scope=symbol}` with no declaration below), lists several requirements in one tag, or sits in a file the pattern tier could not balance. It still counts as file-scope evidence. Add `{scope=symbol}` or `{scope=file}` to say which you mean, or split the tag. Reported by `docguard anchors` only, never by guard.',
    suppress: null,
  },
  ANC007: {
    validator: 'requirementAnchors',
    title: 'Requirement tag cites a requirement nobody declares',
    help: 'An `@implements` or `@req` tag cites a requirement that no spec or requirement document declares, or a bare ID that several documents declare. Qualify it with the Spec ID (`@implements acme.billing#FR-003`), fix the ID, or remove the tag.',
    suppress: null,
  },
  ANC008: {
    validator: 'requirementAnchors',
    title: 'Requirement tag cites a retired requirement',
    help: 'The tag cites a requirement of a retired or superseded spec. Point it at the requirement that replaced it, or remove it if the code no longer implements anything that spec described.',
    suppress: null,
  },
  ANC009: {
    validator: 'requirementAnchors',
    title: 'Anchor lock has conflicting entries for one link (no longer reported)',
    help: 'No longer reported (spec 102, `docguard.anchor-lock-merge`); the code stays registered so configuration and pragmas that name it keep loading. Two lines of `.docguard-anchor-lock.jsonl` for one link, usually from a union merge of two branches that both reviewed it, used to be refused. DocGuard now reads the line whose recorded fingerprints match the code and the requirement as they are now, and the link needs review (ANC001 or ANC002, with its `docguard anchors accept` command) only when none does. Every write leaves one line per link; `docguard anchors merge --write` does the same without accepting anything, and also resolves git conflict markers.',
    suppress: null,
  },
  ANC010: {
    validator: 'requirementAnchors',
    title: 'Requirement anchors were read at a lower tier',
    help: 'Some links could not be compared or placed at their exact tier: a parser is unavailable (Babel, python3), a file does not parse, a different interpreter version recorded the lock, or the anchor cache under `.docguard/` is tracked by git and was ignored. Those links fall back to the pattern or file tier, which is less precise. Install the parser or fix the file; untrack `.docguard/` with `git rm --cached -r .docguard`.',
    suppress: null,
  },
  ANC011: {
    validator: 'requirementAnchors',
    title: 'Requirement anchor covers only volatile lines',
    help: 'Every line of the code this tag anchors carries a `docguard:volatile` marker, so its fingerprint is a placeholder and the link can never turn suspect. A marker is for a release-managed value inside code that implements the requirement, not for the code itself. Anchor the tag to that code, or remove the marker. Reported by `docguard anchors` only, never by guard.',
    suppress: null,
  },
  OWN001: {
    validator: 'docOwnership',
    title: 'Source directory with no owning doc section',
    help: 'Under an ownership root, this directory holds source code that no `ownership.entries[].paths` pattern covers. Nobody is named as responsible for documenting it, so a change there has no doc to update. It is reported at the highest directory with no owned file in it, not once per file. Add the directory to the paths of the doc section that describes it, or add an entry. Test, fixture and example paths are skipped under the default roots; a declared root is checked as declared.',
    suppress: null,
  },
  OWN002: {
    validator: 'docOwnership',
    title: 'Two ownership entries are equally specific for one file',
    help: 'Two entries match the same file with equal specificity (an exact file path beats any glob; a longer literal directory prefix beats a shorter one), so the file has no single owner and the two docs will drift apart. Narrow one entry, or name the file exactly in the entry that owns it.',
    suppress: null,
  },
  OWN003: {
    validator: 'docOwnership',
    title: 'Ownership pattern or root matches nothing',
    help: "An `ownership` entry's path pattern, or an ownership root, matches no tracked file, usually because the code moved. Low confidence when other patterns of the same entry still match. Point it at where the code lives now, or remove it.",
    suppress: null,
  },
  OWN004: {
    validator: 'docOwnership',
    title: 'Ownership entry names a missing doc or section',
    help: 'An `ownership` entry names a doc that does not exist, or a `section` that is neither a `docguard:section` id nor a heading anchor in that doc. Name an existing doc and section.',
    suppress: null,
  },
  OWN005: {
    validator: 'docOwnership',
    title: '.devin/wiki.json breaks a documented Devin rule',
    help: "The committed `.devin/wiki.json` that steers Devin's DeepWiki breaks a rule from Devin's documentation (checked 2026-09-30): `repo_notes` and `pages` are required, `pages` needs at least one page, titles must be unique and non-empty, every page needs a `purpose`, at most 30 pages (80 on enterprise: set `devinWiki.maxPages`), at most 100 notes counting repo and page notes together, at most 10,000 characters per note. Devin rejects a file without pages; what it does with other violations is not documented.",
    suppress: null,
  },
  OWN006: {
    validator: 'docOwnership',
    title: '.devin/wiki.json names a path that does not exist',
    help: "A note or page purpose in `.devin/wiki.json` names a file or directory (`src/api/`, `docs/x.md`) that is not tracked in the repository. Devin's documentation encourages naming paths but does not check them, so a stale path keeps steering the generated wiki toward code that is gone. This is DocGuard's own rule. Point the note at the path that replaced it, or remove it.",
    suppress: null,
  },
  OWN007: {
    validator: 'docOwnership',
    title: 'Ownership map or wiki file is unreadable',
    help: 'The `ownership` block in `.docguard.json` is malformed (for example `entries` is not a list, or a path uses `..` or an absolute prefix), or `.devin/wiki.json` is not valid JSON. Nothing in it can be trusted, so no path counts as owned. Fix it.',
    suppress: null,
  },
  OWN008: {
    validator: 'docOwnership',
    title: 'Ownership entry has a placeholder purpose',
    help: 'An `ownership.entries[]` entry carries a `purpose` that is blank or a `<placeholder>` such as `<purpose>`, usually a drafted block applied unedited. The entry names a doc section and says nothing about what it is responsible for, so it looks like coverage and documents none. Write one sentence for the entry, or remove the `purpose` (the field is optional). An entry with no `purpose` is not reported.',
    suppress: null,
  },
  PSR001: {
    validator: 'pathScopedRules',
    title: 'Path-scoped rule matches no tracked file',
    help: 'A path-scoped agent instruction file (a Claude Code rule or skill `paths:`, a Cursor rule `globs:`, a Copilot `.instructions.md` `applyTo:`, an OpenHands skill `paths:`) has a pattern that matches no tracked file. The harness never loads the rule for that pattern, so its instructions silently stop applying — usually because the code moved. Point the pattern at where the code lives now, or delete the rule. Low confidence when other patterns in the same file still match. `docguard rules --for <path>` shows which rules apply to a path.',
    suppress: null,
  },
  PSR002: {
    validator: 'pathScopedRules',
    title: 'Instruction file points at a path that does not exist',
    help: 'An agent instruction file (AGENTS.md, CLAUDE.md, a rule, a skill) names a file or directory — in backticks, a Markdown link or a table row — that is not tracked in this repository. A pointer is resolved against the instruction file\'s own directory first, then the project root; a bare file name that matches exactly one tracked file counts as resolved; a path the repository\'s ignore rules exclude is treated as a machine-local file and not reported. Point it at the file that replaced it, or remove the reference.',
    suppress: null,
  },
  PSR003: {
    validator: 'pathScopedRules',
    title: 'Instructions loaded for a path exceed the budget',
    help: 'For some tracked path, the instruction files one harness loads (always-on rules, directory files such as nested CLAUDE.md, and the path-scoped rules that match) total more than `agentInstructions.maxBytes` (default 32768). Every byte is paid on every turn, and some harnesses truncate. Nested AGENTS.md chains are measured by STR004 and are not counted here. Narrow the scopes, move procedures into linked docs, or record `agentInstructions.allowances["<harness>:<path>"]` (any path in the reported group, or `"<harness>"` for all) so further growth is a reviewed change.',
    suppress: null,
  },
  PSR004: {
    validator: 'pathScopedRules',
    title: 'Instruction scope cannot be read',
    help: 'The frontmatter of a path-scoped instruction file does not parse, a scope field has the wrong type (`alwaysApply: "yes"`), an unquoted value starts with `*` (YAML reads `globs: **/*` as an alias, not text: quote it), or a `.md` file sits in `.cursor/rules` where Cursor loads only `.mdc`. A scope key the harness does not read (`globs:` in a Claude Code rule) is ignored by it. Claude Code loads a rule whose frontmatter does not parse for every file. A pattern that is valid for the harness but uses syntax DocGuard does not evaluate (`[...]` classes, `!` negation, nested braces) is not a finding: the check reports partial coverage and names the rule.',
    suppress: null,
  },
  PSR005: {
    validator: 'pathScopedRules',
    title: 'Installed instruction copy differs from what its installer recorded',
    help: 'A skill or instruction file that a Spec Kit integration installed (it is listed, with its sha256, in `.specify/integrations/<integration>.manifest.json`) no longer matches any recorded hash. The file is owned upstream: the next `specify integration install` overwrites a local edit, and DocGuard does not review it for staleness. Reinstall the integration to restore the copy, or move the change into a file the project owns. A manifest that does not parse vendors nothing and is reported as partial coverage. DocGuard-installed copies are compared with the running package by `docguard upgrade` instead (spec 094). When the only difference is CRLF line endings (a Windows checkout with `core.autocrlf`), the message says so: mark the file `text eol=lf` in `.gitattributes`.',
    suppress: null,
  },
  PSR006: {
    validator: 'pathScopedRules',
    title: 'Instruction-file copy shares the real file\'s name',
    help: 'A file named like one of this project\'s instruction files (`AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md` or a `requiredFiles.agentFile`) is a copy for another project, and a file that governs this project has the same name. An agent searching the repository for that name may read whichever it finds first, and Codex and Claude Code load a nested `AGENTS.md` or `CLAUDE.md` when they work in its folder. A copy sits below a template directory (`templates`, `template`, `_templates`, `__templates__`, `scaffold(s)`, `boilerplate(s)`, `starter-kit(s)`, `skeleton(s)`, in any case; high confidence) or below a test, fixture or example directory (low confidence: a fixture project may need the name). The folder that holds the file does not count, so `templates/AGENTS.md` and `packages/templates/AGENTS.md` govern their folders, and monorepo package files such as `packages/api/AGENTS.md` are never reported; nor are files under a dot-directory segment (`.cursor/rules/templates/`). Rename the copy (`AGENTS.md.template`) and have the scaffolder or test drop the suffix when it writes the file out, or list a fixture in `.docguardignore` with a reason. If the file does govern its folder, list it in `fileKinds.own`. Template copies are also left out of the agent-instruction role, so Freshness never reviews them and the instruction-chain budget (STR004) does not count them (specs 099 and 100); `guard --format json` lists every file left out under `files.kinds.excluded`.',
    suppress: null,
  },
  PSR007: {
    validator: 'pathScopedRules',
    title: 'Mirrored skill or command copies differ',
    help: 'The same skill or command exists at the same relative path under two agent roots (`.agent/`, `.agents/`, `.claude/`, `.codex/`, `.gemini/`, `.github/` or an installed extension folder `.specify/extensions/<ext>/`), for example `.claude/skills/x/SKILL.md` and `.agents/skills/x/SKILL.md`, and the two files differ. Each harness loads only its own copy, so the harnesses are running different procedures under one name. The message names both paths, how many lines differ and which was committed more recently (or says it cannot tell, as in a shallow clone). A copy that DocGuard installed is refreshed by `docguard upgrade --apply --schema-only` only in the one folder DocGuard writes for the project (the skills folder of the detected agent); the message says which copy that is, and for any other folder says no DocGuard command writes it (copy the newer file over it, or delete it). Copies that differ by design are not reported: two Spec Kit installs for different harnesses (each is checked against its own install manifest by PSR005) and renderings of one generated file that differ only in the harness the generator header names. Files that merely share a name in different folders are different documents, never mirrors. Make one copy the source and refresh or delete the others, or list a copy that is meant to differ in `.docguardignore`. `guard --format json` carries `mirrors` on the finding and `files.mirrors` for the whole project.',
    suppress: null,
  },
  PSR008: {
    validator: 'pathScopedRules',
    title: 'Root instruction files nearly match but disagree',
    help: 'Two of the root instruction files `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` and `.github/copilot-instructions.md` (or the same set inside one nested folder) share at least 80% of their non-blank lines and are not identical, so they are hand-written copies that drifted: one can say `npm` where the other says `yarn`, and each agent follows only the file its harness loads. A pointer file (a body of at most 6 lines that imports the other file) and a file written by `docguard agents --sync` are not compared here (`docguard agents --check` compares those). Two files that are simply different documents share few lines and are never reported. Keep one file as the source and make the other import it (`@AGENTS.md`) or generate it with `docguard agents --sync`.',
    suppress: null,
  },
  SPR008: {
    validator: 'specRegistry',
    title: 'Recorded review revision is not on this history',
    help: 'A spec\'s `lastReviewedRevision` or an outcome revision does not resolve, or is not an ancestor of HEAD, and it is not anchored by its content either. A squash merge or a rebase discards the commit `specs complete` reviewed; a record written by a current DocGuard also carries the git blob of every evidence file (the `Blobs:` segment of its outcome line in the spec), and stays valid when the commit that landed it has those blobs. So this fires for a record written before blobs were recorded, or when the evidence changed between review and landing (the message names the files that differ). Run `docguard specs reanchor --id <spec-id> --write` to move the anchor to the commit on this history whose evidence files are byte-identical; if the old revision no longer exists anywhere, pass `--to <revision> --reason <text>` to attest it. For changed evidence, review it and complete again. In a shallow clone ancestry cannot be known, so the check reports partial coverage instead.',
    suppress: null,
  },
  SPR010: {
    validator: 'specRegistry',
    title: 'Verified spec with no recorded outcome',
    help: 'A current spec\'s delivery is `verified` or `released`, but its registry entry records no reconciliation outcome. `specs approve` cannot set those states and `specs complete` always records an outcome with them, so the state was set by hand (or the spec predates outcomes): no review is on record, and a verified living spec is excluded from the lifecycle review signal DLC002. Record the review with `docguard specs complete --id <spec-id> --since <ref> --reason <text> --write`, which also says which evidence files were reviewed. This is an escalation: DocGuard knows no review was recorded, not that none happened.',
    suppress: null,
  },
  SPR011: {
    validator: 'specRegistry',
    title: 'Closed spec whose evidence changed after its review',
    help: 'A current spec is `verified` or `released`, and an implementation or test file its latest completion recorded (the `Blobs:` segment of its outcome line in the spec) is different at HEAD, or is gone. The record no longer describes the code. SPR008 cannot see this on a pull request\'s merge ref, because the commit that landed the record is the main branch\'s squash commit, whose files match the record; only a developer who merged main into the branch saw it. The spec\'s canonical documents are not compared byte for byte (Freshness and requirement anchors cover them), nor is a hub file that four or more closed specs list as evidence (the per-link anchor lock keeps watching it; guard JSON lists the hubs under `files.completionHubs`), and a record written before blobs existed is not judged. `specs complete` takes an uncommitted edit of the spec\'s evidence files and records their working-tree blobs, so the edit and the completion land in one commit and a gate on every commit never sees this warning. Review the change against the spec\'s requirements, then run `docguard specs complete --stale --reason <text> --write`: it closes every spec that drifted, in one transaction, keeping each spec\'s canonical documents and persistence, and writes nothing, listing each blocker, if one spec cannot be closed. It is a warning, so a strict gate fails on it; it cannot be suppressed inline. This is an escalation: DocGuard knows the files changed, not whether the spec is still met.',
    suppress: null,
  },
  SPR009: {
    validator: 'specRegistry',
    title: 'Asset path covers no file',
    help: 'A spec\'s `reviewed.scope.assetPaths` names files it owns that cannot carry a spec annotation, such as digest-pinned fixtures or recorded outputs; reconciliation links changes under those paths to the spec. An entry ending in `/` covers a directory, any other entry one file. This entry covers no tracked file (no file on disk outside git): the files moved or were removed, so the entry no longer records anything. Remove it, or correct it to the files the spec owns. Editing `assetPaths` is a reviewed change, like `canonicalDocs`.',
    suppress: null,
  },
  SPR007: {
    validator: 'specRegistry',
    title: 'As-built spec drifted from its source paths',
    help: 'An as-built spec (registry `origin: as_built`, created by `docguard generate --spec <area>`) records the facts under its `sourcePaths` — routes, exported symbols, environment variables, entities — with `<!-- docguard:fact <kind> <key> -->` markers. Guard re-scans those paths: a fact in the code that the spec neither marks nor lists under `## Out of Scope` is unaccounted for, and a marked fact that no longer exists means the spec describes code that changed. Update the spec (add or remove the requirement), or move a deliberately unspecified fact under Out of Scope with a reason. This is an escalation: DocGuard knows the fact changed, not whether the spec or the code is right.',
    suppress: null,
  },
  SPR006: {
    validator: 'specRegistry',
    title: 'Tasks checked but no implementation annotation',
    help: 'A spec has at least one checked task, yet no source file carries `@implements <specId>#<requirement>` for any of its requirements. Implementation evidence is explicit, never inferred from file names, so the lifecycle cannot tell what implements the spec: `reconcile` classifies the changed sources as unsupported, and `specs complete` blocks (SPC004/SPC006). Annotate the implementing code (`// @implements …`, or `# @implements …` in Python, shell and YAML) and run `docguard specs --write`. This is an escalation: if the work has not started, uncheck the tasks instead.',
    suppress: null,
  },
  SPR005: {
    validator: 'specRegistry',
    title: 'New spec overlaps prior intent',
    help: 'Preflight found lexical overlap with a prior spec. This is a review hint, never proof of duplication or delivery. Inspect the prior lifecycle and evidence before adding an explicit supersedes or related relationship.',
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
    help: 'A docguard:generated doc has sat in `status: draft` beyond the staleness window (default 14 days; `draftStalenessDays` in .docguard.json). Draft the prose (`docguard fix --doc <name>` prints a research prompt) and promote it to status:current, or delete the forgotten skeleton.',
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
    title: 'Documented endpoint missing from authoritative contract',
    help: 'docs-canonical/API-REFERENCE.md documents an endpoint absent from the authoritative OpenAPI contract. The contract mismatch is certain; route presence or absence is separate, low-confidence evidence. Reconcile intent, contract, implementation, and documentation manually. DocGuard never deletes an endpoint from negative route-scan evidence.',
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
    help: 'A canonical doc (or agent-instruction file) references a code file AND, in the section that names the file, shares wording with symbols removed/changed in that file since the compared revision. Other sections and other rows of an inventory table do not count. Deterministic diff-overlap rule (arXiv 2010.01625, F1 74.7). Low-confidence by design — re-read the doc against the current code; suppress the pairing if it is a false positive.',
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
  EVD001: {
    validator: 'evidence',
    title: 'Evidence manifest is invalid',
    help: 'The strict `.docguard-evidence.json` contract is malformed, unsafe, duplicated, or combines an adapter with an incompatible predicate. Compare it with `templates/evidence-manifest.json`, repair the named field, and rerun `docguard verify --evidence`.',
    suppress: null,
  },
  EVD002: {
    validator: 'evidence',
    title: 'Declared evidence contradicts documentation',
    help: 'A unique Markdown statement and its current declared source disagree under an exact predicate. Review approved intent before changing either side; implementation may have regressed from the document.',
    suppress: null,
  },
  EVD003: {
    validator: 'evidence',
    title: 'Saved evidence is stale',
    help: 'A saved oasdiff or Buf report names an input whose current SHA-256 differs from the declared snapshot. Regenerate the upstream report with the recorded command and producer version, update every input digest, then review the dependent statement.',
    suppress: null,
  },
  EVD004: {
    validator: 'evidence',
    title: 'Evidence verification is inconclusive',
    help: 'DocGuard could not safely and uniquely read the declaration, document statement, source, or report. Restore the evidence or narrow the target; missing evidence never becomes a pass.',
    suppress: null,
  },
  EVD005: {
    validator: 'evidence',
    title: 'Evidence format is unsupported',
    help: 'The adapter version, command, source type, report shape, or predicate is outside the implemented contract. Keep the finding visible and contribute a synthetic failing fixture plus a neighboring valid control before expanding support.',
    suppress: null,
  },
  // docguard.enforcement-ladder#FR-002, FR-003 — required checks.
  REQ001: {
    validator: 'requiredChecks',
    title: 'Required check disabled in config',
    help: 'A validator named in `requiredChecks` is turned off with `"validators": { "<key>": false }`, so the configuration both requires and disables it. Enable it, or remove it from `requiredChecks`. If the check genuinely does not apply to this project, declare that in-repo with a reasoned `<!-- docguard:validator <key> n/a — reason -->` marker: a declared N/A satisfies a required check, a config switch does not.',
    suppress: null,
  },
  REQ002: {
    validator: 'requiredChecks',
    title: 'Required check names no validator',
    help: 'An entry in `requiredChecks` is not a validator key, so nothing is required by it. The message lists the valid keys; `docguard guard --format json` shows each validator\'s `key`. The other required checks still apply.',
    suppress: null,
  },
  // docguard.ignore-reasons#FR-005 — `.docguardignore` entry hygiene.
  IGN001: {
    validator: 'suppressions',
    title: 'Suppression expired',
    help: 'A suppression carries `expires:YYYY-MM-DD` and that day has passed (UTC): a `.docguardignore` entry, a `.docguard.json` object entry, a validator or section N/A marker, or (when a waiver policy is set) an inline pragma. It no longer suppresses anything: DocGuard validates the paths it used to hide, so findings in them can appear in this run. If the reason still holds, set a new date; otherwise delete the line. `docguard ignore` lists every entry with its reason and expiry. Opt out of these checks with `"validators": { "suppressions": false }`.',
    suppress: null,
  },
  IGN004: {
    validator: 'suppressions',
    title: 'Suppression names no owner',
    help: '`"suppressions": { "requireOwner": true }` is set and this suppression has no `owner:` token. The suppression still applies. End its reason with `owner:@handle`, `owner:team/name` or an email address so someone answers for the waiver (spec 084). Baseline fingerprints are exempt.',
    suppress: null,
  },
  IGN005: {
    validator: 'suppressions',
    title: 'Suppression outlives the allowed window',
    help: '`"suppressions": { "maxDays": N }` is set and this suppression expires more than N days from today (UTC), or never. The suppression still applies. Set `expires:YYYY-MM-DD` within the window and renew it then if the reason still holds (spec 084). Baseline fingerprints are exempt.',
    suppress: null,
  },
  IGN002: {
    validator: 'suppressions',
    title: 'Ignore entry has no reason',
    help: '`"suppressions": { "requireReason": true }` is set and this `.docguardignore` entry has no trailing `# reason`. The entry still applies. Write why the path is excluded after the pattern, e.g. `legacy/  # removed with the v2 API`. A reason of 8 or more characters is also what `docguard ignore --format claimspec` needs to export the entry.',
    suppress: null,
  },
  IGN003: {
    validator: 'suppressions',
    title: 'Ignore entry unreadable',
    help: 'This `.docguardignore` line has an `expires:` value that is not a calendar date written YYYY-MM-DD, or an expiry or reason with no pattern. DocGuard cannot tell when the entry should end, so it excludes nothing. Write the date as `expires:2026-12-31`, or remove the token.',
    suppress: null,
  },
};

/**
 * Codes a lifecycle command prints when it refuses to act. They are not
 * findings: guard never reports them, so `findingSeverity`, SARIF and
 * feedback do not read this table. `docguard explain` and the MCP explain
 * tool do, so every blocker a command prints can be looked up.
 * @implements docguard.first-spec-preflight#FR-007
 */
export const BLOCKER_CODES = { __proto__: null,
  SPC001: {
    command: 'docguard specs complete | approve | reanchor',
    title: 'Spec, registry or working tree not ready',
    help: 'The command cannot identify what it acts on, or the repository is not in a state it can record. Causes: `--id` is missing or names no spec in the registry; the committed `.docguard-specs.json` is missing or stale (run `docguard specs --write`, review and commit it); the spec is retired; completion found no Git HEAD, or tracked files changed since the recorded revision (commit them first; the lifecycle files completion itself writes are allowed).',
  },
  SPC002: {
    command: 'docguard specs complete | approve',
    title: 'Lifecycle state does not allow this transition',
    help: 'Completion needs an approved spec whose delivery is in_progress or implemented, or a verified or released living spec for a maintenance outcome. Record approval, and the delivery state, with `docguard specs approve --id <spec-id> [--delivery in_progress|implemented] --write`; a person runs it and the registry diff is reviewed in the pull request. `approve` refuses verified and released (only `specs complete` records them) and refuses to move a verified or released spec back.',
  },
  SPC003: {
    command: 'docguard specs complete',
    title: 'Task ledger incomplete',
    help: 'The spec has a tasks.md and not every task is checked, or it has no task ledger and is not a living verification contract. Finish and check the tasks, or uncheck none you have not done; a living spec with qualified evidence for every requirement may omit tasks.md.',
  },
  SPC004: {
    command: 'docguard specs complete',
    title: 'Requirement evidence missing',
    help: 'Completion needs at least one source file annotated `@implements <specId>#<requirement>`, at least one test annotated `@req <specId>#<requirement>`, and implementation or test evidence for every requirement the spec declares. Add the annotations, then run `docguard specs --write`. Bare `FR-001` references do not count: the same local ID appears in many specs. A requirement with no code target (a documentation requirement, a one-time outcome such as an A/B run or a budget run) takes its evidence from a test that checks the result: `describes()` asserts that each named document carries the terms the requirement asks for, and `recorded()` asserts that the spec\'s Verification Notes answer each measured criterion; tag that test `@req <specId>#<requirement>`, as `tests/program-verification.test.mjs` does for specs 081 to 095.',
  },
  SPC005: {
    command: 'docguard specs complete',
    title: 'Affected canonical documents not recorded',
    help: 'The registry entry names no canonical document the spec affected (`reviewed.scope.canonicalDocs`), or names one that does not exist. List the documents the change updated; this is a reviewed field, edited by hand and reviewed in the pull request.',
  },
  SPC006: {
    command: 'docguard specs complete',
    title: 'Reconciliation incomplete',
    help: 'Completion reconciles every file changed since the review baseline. It blocks when there is no baseline (pass `--since <ref>` the first time), when the plan is unsupported, when a changed file traces to no spec (annotate it, list files that cannot carry an annotation under `reviewed.scope.assetPaths`, or, for a removed file, name its path in the spec that removes it), or when a living spec\'s maintenance completion has no new linked change since its last reviewed revision. `docguard reconcile --since <ref>` shows the classification.',
  },
  SPC007: {
    command: 'docguard specs complete',
    title: 'Guard has errors',
    help: 'Completion runs guard and refuses while it reports errors. Run `docguard guard`, fix the errors, commit, and complete again.',
  },
  SPC008: {
    command: 'docguard specs reanchor',
    title: 'Re-anchor target not established',
    help: 'Re-anchoring moves a recorded revision that a squash merge discarded (SPR008). It blocks when no commit on HEAD\'s first-parent history carries the reviewed evidence unchanged, when the old revision no longer resolves, or when `--to` names no commit on HEAD\'s history. Pass `--to <revision>` (a SHA, branch, tag or HEAD; the full SHA is recorded) with `--reason` to attest the anchor, and `--from <revision>` when one spec has dangling revisions from different merges.',
  },
};

export const SUGGESTION_KINDS = Object.freeze(['fix', 'suppress', 'review', 'report']);
export const DISPOSITIONS = Object.freeze(['act', 'escalate']);
export const PARSER_TIERS = Object.freeze(['js-ast', 'py-ast', 'regex-fallback', 'fallback-language', 'mixed', 'not-applicable']);
// Kinds where DocGuard names the correction itself. Everything else is a
// signal for the reader to judge.
const ACT_KINDS = new Set(['fix', 'suppress']);

const RUNNING_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version || null;
  } catch { return null; }
})();

// Per-code evidence is identical for every finding of that code in a run, so
// project it once. A run with 249 findings (a real monorepo) must not build
// 249 copies of the same object.
const evidenceCache = new Map();
function findingEvidence(code) {
  const key = typeof code === 'string' ? code : '';
  let cached = evidenceCache.get(key);
  if (cached) return cached;
  const e = evidenceForCode(key);
  cached = e.status !== 'measured'
    ? Object.freeze({ status: 'not-measured' })
    : Object.freeze({
        status: 'measured',
        n: e.precisionDenominator,
        precision: e.quotable ? e.precision : null,
        precisionInterval: e.precisionInterval,
        quotable: e.quotable === true,
        measuredOnVersion: PRECISION_EVIDENCE.source.toolVersion,
        measuredOnRunningVersion: PRECISION_EVIDENCE.source.toolVersion === RUNNING_VERSION,
      });
  evidenceCache.set(key, cached);
  return cached;
}

/**
 * A location is a string or null — never an object. An emitter that passes
 * `{ file, line }` (api-doc-smells did) used to render as `[object Object]`
 * and defeat SARIF's location parser; normalize it here so the contract holds
 * regardless of the call site.
 */
function normalizeLocation(loc) {
  if (loc == null) return null;
  if (typeof loc === 'string') return loc || null;
  if (typeof loc === 'object') {
    const file = typeof loc.file === 'string' ? loc.file : typeof loc.path === 'string' ? loc.path : '';
    if (!file) return null;
    return Number.isInteger(loc.line) && loc.line > 0 ? `${file}:${loc.line}` : file;
  }
  return null;
}

/** A code's registered default enforcement level, or null (docguard.agent-instruction-budget#FR-004). */
/**
 * Codes that claim something is ABSENT: a pointer, symbol, test, link or
 * source that does not exist. An absence claim is only provable on a complete
 * view, so guard withholds these from a validator whose run recorded an
 * observation gap (docguard.verdict-contract#FR-006) and counts them instead.
 */
export const ABSENCE_CLAIM_CODES = Object.freeze(new Set([
  'PSR001', 'PSR002', 'REF001', 'TRC002', 'TRC003', 'TRC004', 'TRC005', 'AID001', 'AID003', 'DEC002', 'MEM001', 'MEM002', 'SPK008', 'SPK010', 'SPR008', 'XRF001', 'XRF002',
  // The final fault-injection run (spec 081 SC-005): with ls-files failing, 25 ANC003
  // and one SPR001 appeared on DocGuard's own repository. Each claims something is
  // missing from a file list git could not give; SPR006 and SPR009 read the same list.
  'ANC003', 'SPR001', 'SPR006', 'SPR009',
]));

export function codeDefaultLevel(code) {
  const level = typeof code === 'string' ? CODES[code.toUpperCase()]?.defaultLevel : undefined;
  return level === 'info' ? level : null;
}

/**
 * Build a Finding with sane defaults.
 *
 * Three orthogonal channels (docguard.calibrated-finding-channels):
 *   severity    — does CI block?
 *   disposition — who decides, tool or reader? Derived from suggestion.kind
 *                 unless set explicitly; defaults to 'escalate' when there is
 *                 no valid suggestion (fail closed on triage: a finding DocGuard
 *                 cannot say how to fix is one a human should look at).
 *   evidence    — has the reviewed corpus measured this code? Attached per
 *                 finding so a reader never mistakes an asserted prior for a
 *                 measured rate.
 *
 * A suggestion whose `kind` is not a supported value is malformed and is
 * omitted (adoption-workflow-integrity#FR-002), never coerced: a typo must
 * not silently turn 'fix' into 'review'. A suggestion with text but NO kind
 * is the legacy shape and stays a 'review' nudge.
 *
 * `reportable` is true when the code is unmeasured or confidence is low.
 * Deriving it from confidence alone made the feedback loop sample only the
 * findings it already doubted — the population where a wrong label is most
 * costly (confident, never measured) was excluded by default.
 *
 * `severity` is `error` or `warn`; anything else becomes `warn`. A detector
 * that means "informational" registers `defaultLevel: 'info'` for its code
 * instead: passing `severity: 'info'` here was silently read as a warning.
 *
 * @param {Partial<Finding>} f
 * @returns {Finding}
 */
export function mkFinding(f) {
  const severity = f.severity === 'error' ? 'error' : 'warn';
  const confidence = f.confidence === 'low' ? 'low' : 'high';
  const rawSuggestion = f.suggestion;
  let suggestion = null;
  if (rawSuggestion && typeof rawSuggestion === 'object'
    && typeof rawSuggestion.text === 'string' && rawSuggestion.text.trim()) {
    const kind = rawSuggestion.kind === undefined || rawSuggestion.kind === null ? 'review' : rawSuggestion.kind;
    if (SUGGESTION_KINDS.includes(kind)) {
      suggestion = {
        kind,
        text: rawSuggestion.text.trim(),
        ...(typeof rawSuggestion.command === 'string' && rawSuggestion.command.trim()
          ? { command: rawSuggestion.command.trim() } : {}),
        ...(typeof rawSuggestion.pragma === 'string' && rawSuggestion.pragma.trim()
          ? { pragma: rawSuggestion.pragma.trim() } : {}),
      };
    }
  }
  const disposition = DISPOSITIONS.includes(f.disposition)
    ? f.disposition
    : suggestion && ACT_KINDS.has(suggestion.kind) ? 'act' : 'escalate';
  const evidence = findingEvidence(f.code);
  return {
    code: f.code || null,
    validator: f.validator || null,
    severity,
    confidence,
    disposition,
    evidence,
    parserTier: PARSER_TIERS.includes(f.parserTier) ? f.parserTier : 'not-applicable',
    message: f.message || '',
    location: normalizeLocation(f.location),
    suggestion,
    reportable: f.reportable === true || confidence === 'low' || evidence.status === 'not-measured',
    redactedContext: f.redactedContext || null,
    // Present only when a detector classifies where the evidence sits (Security
    // SEC001-SEC004: 'product' | 'test-path', spec 097 FR-010). Findings without
    // one are byte-identical to before. It never changes the level.
    ...(f.context === 'product' || f.context === 'test-path' ? { context: f.context } : {}),
    // docguard.recorded-document-reviews: only freshness findings carry these.
    ...(typeof f.documentRole === 'string' ? { documentRole: f.documentRole } : {}),
    ...(f.staleness && typeof f.staleness === 'object' ? { staleness: f.staleness } : {}),
    ...(f.surface && typeof f.surface === 'object' ? { surface: f.surface } : {}),
  };
}

/**
 * May this finding ever count toward failing a build under `strict`?
 * False for a finding whose evidence sits in a test, fixture, example or mock
 * path (`context: 'test-path'`): a literal there can be reported but can never
 * be a gating finding (spec 097 FR-010).
 * @param {{context?: string}} finding
 */
export function isGatingEligible(finding) {
  return finding?.context !== 'test-path';
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

/** One inline pragma: `docguard:ignore[-secret] [CODES]`. Shared by `suppressesCode` and `parseInlinePragma`. */
const PRAGMA_RE = /docguard:ignore(-secret)?\b[ \t]*([A-Za-z0-9_,*-]+)?/i;

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
  const m = text.match(PRAGMA_RE);
  if (!m) return false;
  // docguard.accountable-suppressions#FR-004: an expired pragma, or one whose
  // owner/expiry metadata is unreadable, suppresses nothing.
  const tail = text.slice(m.index + m[0].length);
  if (/(?:owner|expires):/.test(tail)) {
    const meta = splitWaiverMetadata(tail.replace(/\s*(?:-->|\*\/)\s*$/, ''));
    if (meta.problem || isExpired(meta.expires)) return false;
  }
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
 * Read an inline pragma's codes and the reason written after them — the
 * in-process model of a `docguard:ignore` suppression (docguard.ignore-reasons#FR-006).
 *
 * Codes are read exactly as `suppressesCode` reads them, so the model never
 * disagrees with what is suppressed: `null` means any code (bare form or
 * `all`), and `docguard:ignore-secret` is `['SEC*']`. The reason is the text
 * after the code list, with a leading separator (`—`, `–`, `:`, `-`, `--`) and
 * a trailing comment terminator (`-->`, `*\/`) removed; `null` when absent.
 *
 * @param {string} text
 * @returns {{codes: string[]|null, reason: string|null}|null} null when no pragma
 * @implements docguard.ignore-reasons#FR-006
 */
export function parseInlinePragma(text) {
  if (!text) return null;
  const source = String(text);
  const m = source.match(PRAGMA_RE);
  if (!m) return null;
  let codes;
  if (m[1]) {
    codes = ['SEC*'];
  } else {
    const tokens = (m[2] || '').split(',').map((s) => s.trim()).filter(Boolean);
    codes = tokens.length === 0 || tokens.some((t) => t.toLowerCase() === 'all') ? null : tokens;
  }
  const raw = source.slice(m.index + m[0].length)
    .replace(/\s*(?:-->|\*\/)\s*$/, '')
    .replace(/^\s*(?:[—–:]|-{1,2})\s*/, '')
    .trim();
  // docguard.accountable-suppressions#FR-001: trailing owner:/expires: tokens.
  const meta = splitWaiverMetadata(raw || null);
  // Keys appear only when written, so every 0.45.2 form returns the same shape.
  return { codes, reason: meta.reason || null, ...(meta.owner ? { owner: meta.owner } : {}), ...(meta.expires ? { expires: meta.expires } : {}), ...(meta.problem ? { problem: meta.problem } : {}) };
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
