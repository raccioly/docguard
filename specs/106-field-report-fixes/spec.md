# Feature Specification: Field-Report Fixes (Strict Secrets, Salesforce Apex, Guard Exit Contract)

**Feature Branch**: `fix/711-717-field-report`

**Created**: 2026-11-27

**Status**: Active

**Spec ID**: `docguard.field-report-fixes`

**Lineage**: Supersedes one clause of `docguard.strict-by-default` (spec 097) FR-008: the demotion of an off-by-default validator's errors now applies only when the project did not turn that validator on (FR-001 here). Spec 097's text is not edited. Closes issues 711 to 717, which come from one field report on seven production repositories (Salesforce, Java, TypeScript, Mule/RAML, Astro). The report's project is not named here.

**Input**: "Fix the seven issues from the field report. Strict mode demotes a hardcoded secret even when the project turned the security validator on. The secret scan, test detection, traceability and phantom-completion checks do not read Salesforce Apex. SEC001 and SEC004 report route paths, URLs, cookie names and metric labels; Storybook stories and `test-utils/` count as product code. Guard JSON has no field for the exit decision. DCV003 lists `docs/` as a source directory."

## Problem

1. **Strict is weaker than standard for a project that turned security on (issue 711).** Spec 097 FR-008 demotes every intrinsic error of `security` and `architecture` to a warning under strict, because the 0.47.0 defaults left these validators off. The rule does not look at the project's own `validators` map. A project with `"security": true` (or the `enterprise` profile, which turns it on) got exit 1 for a committed credential under 0.47 and gets exit 4 or 2 from 0.48.0 onward. The legacy count branch in `guard.mjs` reads the same list directly, so the two paths must change together.
2. **Apex is not read (issues 712, 713, 714).** Each scanner keeps its own list of source extensions. None has `.cls`, `.trigger` or `.apex`. The secret scan reports SEC011 ("check sourceRoot") on a Salesforce DX tree with a hardcoded password. Test detection reports TSP007 on 50 Apex test classes, traceability ignores `@req` in them (TRC004), and SPK008 calls completed tasks phantom because the symbol tier does not read Apex or metadata XML and the basename tier does not see directories (a custom object is the directory `objects/Widget__c/`). This is one gap in many places, so it needs one language entry with many consumers, not three patches.
3. **Test detection disagrees with traceability (issue 713).** `detectTests` in Test-Spec has its own regexes and looks only in a top-level test directory and under source roots. A Maven or Gradle multi-module repository keeps tests in `<module>/src/test/java/`. Traceability's classifier (`isTestSource`) reads those tests in the same run.
4. **The password and token patterns judge the key, not the value (issue 715).** A route (`'/forgot-password'`), an endpoint URL, a cookie name that repeats the key's words (`'idp_access_token'`) and a dotted metric label (`'auth.refreshAccessToken'`) are reported as credentials at `error`. Storybook stories and `test-utils/` hold demo and fixture values but are classified as `product`.
5. **Guard JSON does not state its exit decision (issue 716).** `errors` counts intrinsic severities, so a strict run can say `status: WARN`, `errors: 4`, `effectiveErrors: 0` and exit 4. No field carries the exit code, and `schemas/` has no schema for guard or ci output. The ci summary prints "1 validator applyes".
6. **DCV003 lists documentation folders as source directories (issue 717).** Without `src/`, every top-level folder is a source directory, `docs/` included. On the same fresh tree TRC002 reports each scaffold that `init` just wrote, which STR006 already reports.

## User Scenarios & Testing

### User Story 1 - A committed secret fails when the project turned security on (Priority: P1)

As a maintainer whose `.docguard.json` sets `"security": true`, a hardcoded credential in product code fails guard in strict mode, exactly as it does in standard mode.

**Independent Test**: The issue 711 tree (a Java class with a password and a token). With `security: true` and no `enforcement` key, guard exits 1 and SEC001 and SEC004 have `effectiveSeverity: error` and `enforcement.source: intrinsic`.

**Acceptance Scenarios**:

1. **Given** `validators.security: true` (or `architecture: true`), **When** guard runs under strict, **Then** that validator's intrinsic errors stay errors.
2. **Given** a profile that turns the validator on (`enterprise`), **When** guard runs under strict, **Then** the same holds: the profile is the project's choice.
3. **Given** no `security` key and the default profile, **When** guard runs under strict, **Then** the errors are warnings as before, and the text output says how many possible secrets in product code were demoted and how to make them fail.
4. **Given** any fixture of the test corpus, **When** guard runs in strict and in standard with the same validators on, **Then** no finding has a lower effective level in strict than in standard.

### User Story 2 - Salesforce Apex is read like Java (Priority: P1)

As a maintainer of a Salesforce DX project, the secret scan, test detection, traceability and phantom-completion checks read my Apex classes and triggers.

**Independent Test**: The trees of issues 712, 713 (part B) and 714.

**Acceptance Scenarios**:

1. **Given** a password in `force-app/**/classes/LegacyClient.cls`, **When** guard runs, **Then** SEC001 reports it, as for `.java`.
2. **Given** a project whose only source is in a language the secret scan does not read, **When** guard runs, **Then** SEC011 names those files by language ("2 Visualforce files are not scanned") instead of pointing at `sourceRoot`.
3. **Given** `OrderTotalTest.cls` with `@isTest` and `// @req FR-001`, **When** guard runs, **Then** TSP007 does not fire and FR-001 is covered (no TRC004).
4. **Given** `sfdx-project.json` at the root, **When** `init` runs, **Then** the project profile names the Salesforce DX ecosystem with language Apex, and `projectType` is `webapp` when the package holds Lightning or Visualforce UI (`lwc/`, `aura/`, `pages/`), else `unknown` as before.
5. **Given** the issue 714 tasks, **When** guard runs, **Then** no SPK008 fires: `Widget__c` appears in Apex, and `Widget__c` is both a directory and the API name of `Widget__c.object-meta.xml`.
6. **Given** a guard JSON report saved inside the tree, **When** guard runs again, **Then** the report does not count as implementation evidence for SPK008.

### User Story 3 - Maven and Gradle module tests are tests (Priority: P1)

As a maintainer of a multi-module Java repository, Test-Spec finds my tests where traceability finds them.

**Independent Test**: The issue 713 part A tree: guard reports no TSP007.

**Acceptance Scenarios**:

1. **Given** tests under `services/orders/src/test/java/`, **When** guard runs, **Then** Test-Spec detects them through the same classifier traceability uses.

### User Story 4 - Values that cannot be credentials are not reported as credentials (Priority: P2)

As a web developer, a route path, an endpoint URL, a cookie or header name and a metric label under a password or token key do not fail my build.

**Independent Test**: The issue 715 tree: none of the four shapes is an error. Storybook and `test-utils/` findings carry `context: test-path`.

**Acceptance Scenarios**:

1. **Given** each of the four shapes, **When** guard runs, **Then** the finding is a low-confidence warning whose message names the shape (route, URL, name, label), never "natural-language text".
2. **Given** a JWT, a high-entropy value that starts with `/`, a URL with `user:pass@`, a URL whose credential-named query parameter has a value, and `access_token_Zp2Wm7x41k8`, **When** guard runs, **Then** each stays an error.
3. **Given** a password in `form.stories.tsx` or in `src/test-utils/auth.ts`, **When** guard runs, **Then** the finding has `context: test-path`, and a story never counts as a test for traceability.

### User Story 5 - One JSON field says what the exit code says (Priority: P1)

As the author of a pipeline that stores only stdout, I read one field and reach the decision DocGuard reached.

**Independent Test**: For each exit path (0, 1, 2, 3, 4), `guard --format json` has `exitCode` equal to the process exit code and an `outcome` word.

**Acceptance Scenarios**:

1. **Given** any guard run in JSON, compact JSON or `ci --format json`, **When** it ends, **Then** `exitCode` equals the process exit code and `outcome` names the reason (FR-011).
2. **Given** the JSON schemas `schemas/docguard-guard-result.schema.json` and `schemas/docguard-ci-result.schema.json`, **When** a test validates real output, **Then** it passes, and the schema says that `errors` and `warnings` are intrinsic counts and `effectiveErrors` drives the exit code.
3. **Given** one unexamined validator, **When** `ci` prints its summary, **Then** it says "1 validator applies".

### User Story 6 - Documentation folders are not source directories (Priority: P2)

**Independent Test**: The issue 717 tree: no DCV003 for `docs/`; DCV003 still lists `contracts/` and `tools/`; no TRC002 for a document that STR006 reports as an unedited scaffold.

### Edge Cases

- A LaTeX `.cls` file is scanned for secrets (the safe direction) and is never a test unless its name or content says so. Language naming and project type key off `sfdx-project.json`, not the extension alone.
- A directory named like a task needle at any depth counts for tier b only when the needle is at least five characters long, the same bound as basenames.
- A route-shaped value that holds `$` or mixed-case high-entropy segments is not a route.
- A dotted value that starts with `eyJ` or has a segment of 20 or more characters is not a label.
- A project that turned security on and has a test-path secret: the finding stays a warning; test paths never gate (spec 097).

## Requirements

### Functional Requirements

- **FR-001**: Under strict, an off-by-default validator (`security`, `architecture`) is demoted only when the merged configuration does not turn it on (`validators.<key> !== true` after the profile and the project's file are merged). When the project turned it on, a finding in a test path (`context: test-path`) is still a warning (`enforcement.source: strict-test-path`), because a test path never fails a strict build (spec 097); every other intrinsic error stays an error. `strictFindingContext` takes the configuration and returns the demoted set; both the structured branch (`resolveFindingEnforcement`) and the legacy count branch in guard read that set. This supersedes the matching clause of spec 097 FR-008.
- **FR-002**: When strict demotes one or more SEC001 to SEC006 findings with `context: product`, the guard text output prints one line with the count and the two ways to make them fail (`"security": true`, or `findingSeverity`), and the JSON carries `strict.demotedProductSecrets` (the count).
- **FR-003**: One language entry for Apex (`cli/shared-languages.mjs`): extensions `.cls`, `.trigger`, `.apex`; slash comments; single-quoted strings (the Java lexer); test classes named `*Test.cls`, `*Tests.cls`, `*_Test.cls` or `Test_*.cls`, or a `.cls` that declares `@isTest`; manifest `sfdx-project.json`; metadata files `<ApiName>.<type>-meta.xml`. The entry uses the language id `apex` and the extension set of the matching websec-validator change, so the two tools agree.
- **FR-004**: The secret scan reads the Apex extensions and Visualforce markup (`.page`, `.component`). When it scans no file, SEC011 names the source files present by language and says their extensions are not scanned; when none is present, it keeps today's text.
- **FR-005**: `isTestSource` and the implementation-file selector of requirement evidence read Apex. `@req`, `@implements` and test labels in `.cls` files are found by the same tokenizer as Java.
- **FR-006**: Test-Spec's `detectTests` asks `isTestSource` (plus the Apex content rule) over the project walk, after the top-level directory probe. A Maven or Gradle `src/test/` at any depth and Apex test classes are tests. `findTestFiles` (the count validators) is not changed.
- **FR-007**: The project profile detects `sfdx-project.json` as the Salesforce DX ecosystem (language Apex). `autoDetectProjectType` returns `webapp` when a package directory holds `lwc/`, `aura/` or `pages/`, else `unknown`. The `projectType` enum is not changed.
- **FR-008**: SPK008's symbol tier reads Apex and `*-meta.xml` files. Its basename tier also matches a metadata file by its API name (the base name without `.<type>-meta.xml`) and matches directory names met during the walk. A file that quotes a checked task's text, in plain or JSON-escaped form, is not evidence for that walk.
- **FR-009**: The password and token patterns treat these values as non-credentials and report them as low-confidence warnings with a message that names the shape: a route (starts with `/`, `./` or `#`, then only lowercase kebab or snake segments, `:param` or `{param}`); a URL with a scheme and without userinfo or a credential-named query parameter with a value; a name of two to four lowercase snake or kebab words that contain every credential word of the key, under a key that says it holds a name (cookie, header, field, storage and similar), with no word that mixes letters and digits; a dotted identifier of two to five segments that does not start with `eyJ`. The natural-language warning keeps its text for prose only.
- **FR-010**: `secretContext` classifies Storybook files (`*.stories.*`, `*.story.*`) as `test-path`; the test vocabulary gains `test-utils` and `test-support`. Storybook is not added to `TEST_PATTERNS`, so a story is never test coverage.
- **FR-011**: Guard JSON (full and compact) and ci JSON carry `exitCode` and `outcome`, computed by the function that sets the process exit code. Guard's `outcome` is one of `pass`, `warnings`, `errors`, `not-initialized`, `unexamined`, `undecided`; ci's is one of `pass`, `warnings`, `blocked`. `errors` and `warnings` keep their meaning (intrinsic counts).
- **FR-012**: `schemas/docguard-guard-result.schema.json` and `schemas/docguard-ci-result.schema.json` describe the decision fields and the counts. A test validates real guard and ci output against them. AGENTS.md "Consuming Guard Output" and the README JSON section name `exitCode`/`outcome` as the fields to gate on.
- **FR-013**: The ci summary agrees in number ("1 validator applies", "2 validators apply").
- **FR-014**: DCV003 never lists a documentation directory (`docs`, `doc`, `documentation`, `docs-canonical`, `docs-implementation`) or a directory whose files are all Markdown, text or image assets. A directory with any other file (RAML, shell, code) stays listed.
- **FR-015**: TRC002 does not report a canonical document that STR006 reports as an unedited scaffold.
- **FR-016**: Each changed code is named in the CHANGELOG `[Unreleased]` section with an `Exit codes:` line.

### Key Entities

- **Language entry**: id, display name, extensions, comment family, lexer, test-name rule, test-content rule, manifest, metadata rule.

## Success Criteria

- **SC-001**: Each issue tree from 711 to 717 gives the expected result (one test per tree, each failing on the base code).
- **SC-002**: The full suite passes by exit code.
- **SC-003**: A hermetic A/B against v0.50.0 on DocGuard itself, the benchmark corpus and the other local repositories shows no finding lost that was correct, and every difference is explained by an FR.

## Verification Notes

- **SC-001**: `tests/field-report-fixes.test.mjs` holds one test per issue tree (711 to 717). On the v0.50.0 code 15 of its first 16 tests failed (the story-coverage guard already held); all pass on this change.
- **SC-002**: `npm test`, by exit code, on the final commit of the pull request.
- **SC-003**: hermetic A/B, v0.50.0 against this change, one fresh `git archive` per CLI, run one at a time. DocGuard itself: exit 2 → 2, no finding added or removed. 25 other local projects: no exit code changed; one `SPK008` removed in one project (a task that names `.github/workflows/` is now matched by directory name, FR-008; the task named no deliverable). A first candidate turned one project with the `enterprise` profile from exit 4 to 1 on a secret in a test file; FR-001 now keeps test-path findings as warnings, and the rerun is 4 → 4. None of the local projects is a Salesforce or Maven multi-module tree; the issue trees cover those. If product-context secrets gated under the default (not done, plan Decision 1), 3 of the 25 projects would exit 1 (9 findings).

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `4eaf71ba97685fd2853eb69f837873ef2fbde7bd` — Issues 711-717 fixed and merged in PR 720 (86a46ca): strict demotion follows the merged config, Apex read by the five named consumers, exitCode/outcome in guard and ci JSON, shape-aware SEC001/SEC004, DCV003 and TRC002 noise; spec 107 then moved the language lists onto one registry. Evidence: `cli/enforcement.mjs`, `cli/scanners/requirement-evidence.mjs`, `cli/shared-languages.mjs`, `cli/validators/security.mjs`, `cli/validators/test-spec.mjs`, `docs/configuration.md`, `tests/field-report-fixes.test.mjs`, `tests/program-verification.test.mjs`, `tests/security-test-or-placeholder.test.mjs`. Accepted deviations: none. Successor: none. Blobs: `cli/enforcement.mjs`=`445c877f5c214482586d179930492b1860adb11c`, `cli/scanners/requirement-evidence.mjs`=`f6166fc0067c57f431529e60898078d3adac0ed8`, `cli/shared-languages.mjs`=`7eb1a7f5d07f1f3b01d9db13ceee7ac416387730`, `cli/validators/security.mjs`=`f7792a68131e419e45aebb91eec31ea2f125b129`, `cli/validators/test-spec.mjs`=`a5118c5b046f1792f343e90bb802bc5de7585570`, `docs/configuration.md`=`197481d7a8fbd2b477e87a9e550a854147defe22`, `tests/field-report-fixes.test.mjs`=`c818901e48c49d0a52c1e5c5c28af90e21d20236`, `tests/program-verification.test.mjs`=`1fd86534011aedcf8a7f3ac20087558538b1c46a`, `tests/security-test-or-placeholder.test.mjs`=`f879f8bc4574de95b5228cc27a0b64a4506e50bb`.
- `cdb655592a32a9121989f408adb32af2595af051` — Spec 107 moved each file's language list onto cli/shared-languages.mjs (and spec 106 tags were added); reviewed: behavior unchanged except the wider language set the specs already describe as 'code' Evidence: `cli/enforcement.mjs`, `cli/scanners/requirement-evidence.mjs`, `cli/shared-languages.mjs`, `cli/validators/security.mjs`, `cli/validators/test-spec.mjs`, `docs/configuration.md`, `tests/field-report-fixes.test.mjs`, `tests/program-verification.test.mjs`, `tests/security-test-or-placeholder.test.mjs`. Accepted deviations: none. Successor: none. Blobs: `cli/enforcement.mjs`=`445c877f5c214482586d179930492b1860adb11c`, `cli/scanners/requirement-evidence.mjs`=`f6166fc0067c57f431529e60898078d3adac0ed8`, `cli/shared-languages.mjs`=`935f47dae9557330439139554c0bb179778c45a8`, `cli/validators/security.mjs`=`f7792a68131e419e45aebb91eec31ea2f125b129`, `cli/validators/test-spec.mjs`=`a5118c5b046f1792f343e90bb802bc5de7585570`, `docs/configuration.md`=`197481d7a8fbd2b477e87a9e550a854147defe22`, `tests/field-report-fixes.test.mjs`=`c818901e48c49d0a52c1e5c5c28af90e21d20236`, `tests/program-verification.test.mjs`=`1fd86534011aedcf8a7f3ac20087558538b1c46a`, `tests/security-test-or-placeholder.test.mjs`=`f879f8bc4574de95b5228cc27a0b64a4506e50bb`.
<!-- docguard:implementation-outcomes:end -->
