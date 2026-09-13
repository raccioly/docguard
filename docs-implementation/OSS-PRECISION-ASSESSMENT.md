# Independent open-source precision assessment

This is an ongoing evaluation for the 24-hour improvement effort begun September 13, 2026 at 00:08 UTC. The released baseline is DocGuard 0.36.1 (`6c80d6aedae3bb31430cb91494e42bc62db7c7fe`). Results below are observations, not a release attestation or an estimate of universal accuracy.

## Evaluation method

Inspect disposable, revision-pinned public checkouts without installing their dependencies or executing their applications. Record the unconfigured first run separately from any explicit document-role/directory configuration. Missing DocGuard conventions are setup findings; they are not automatically upstream defects. Shallow history limits historical drift assessment. Static inspections do not establish runtime behavioral correctness.

Adjudicate each sampled finding against source and documentation as a verified defect, false positive, review signal, setup requirement, unsupported capability, or unresolved case. Preserve disagreement rather than forcing a correct/incorrect label. Turn confirmed DocGuard defects into synthetic regression cases with neighboring valid controls. Use a separate repository for validation after developing a fix; these exploratory repositories alone cannot establish a general precision percentage.

## SvelteKit

Source: [sveltejs/kit at the assessed revision](https://github.com/sveltejs/kit/tree/4da6320db8d70b73b93e142e4bb6ba9173be3b97). Checkout contains 3,423 tracked files; clone depth is two commits. First-run command: `node /path/to/docguard/cli/docguard.mjs guard --format json`, executed in the checkout. No configuration or source file was added to the checkout.

Baseline: seven errors and 44 warnings. The seven errors require a canonical directory, root changelog and drift log. They describe DocGuard's default conventions, not seven proven SvelteKit defects. Finding counts: STR001 7; DCV001 5; DCV004 1; DCV005 2; DQ001 1; TDO001 28; TDO002 5; TDO003 1; SPK001 1. TDO003 is a summary of additional TODOs, so these counts are not a count of unique underlying issues.

### Confirmed DocGuard false positive: configured documentation omitted

DCV004 says `.svelte-kit` is a config file that no documentation mentions. The [project structure guide, lines 89–91](https://github.com/sveltejs/kit/blob/4da6320db8d70b73b93e142e4bb6ba9173be3b97/documentation/docs/10-getting-started/30-project-structure.md#L89-L91) explicitly explains the generated directory. The [source test](https://github.com/sveltejs/kit/blob/4da6320db8d70b73b93e142e4bb6ba9173be3b97/packages/kit/src/core/adapt/builder.spec.js#L31) includes a path expression that the detector can treat as a config reference.

A second run supplied `config.docs = { dirs: ['documentation/docs'] }` directly to `runGuardInternal`, keeping all other loaded configuration unchanged. Results were still seven errors and 44 warnings. A direct `validateDocsCoverage` call reproduced DCV004. Its `collectDocContent` function uses fixed directories and does not receive the config argument. This isolates an implementation defect rather than an absent user setting. The configured-directory correction removes this finding on the same checkout. Its focused suite passes 107 tests, including exclusions, raw role mapping and neighboring genuinely undocumented configs. This is preliminary validation; the final combined runtime matrix remains pending. Directory-versus-file inference is a separate remaining limitation.

### Review signals: conditional tests

The first two TDO001 findings occur in `packages/kit/test/apps/async/test/client.test.js:5` and `server.test.js:8`. Both are conditional Playwright skips selecting JavaScript-enabled or JavaScript-disabled execution. Other sampled skips select development/build variants. They lack the explanation formats DocGuard recognizes, but the condition does not establish that a test is permanently disabled or that coverage is missing. [Playwright's API](https://playwright.dev/docs/api/class-test#test-skip) supports conditional skips and optional descriptions. Treat these as policy/review signals pending a more precise product contract; no upstream report has been submitted for them.

The remaining findings have not been individually adjudicated. This report deliberately does not calculate precision from the full warning count.

## Django

Source: [django/django at the assessed revision](https://github.com/django/django/tree/2b30f6255b5ef84afbd827993643d52ef2c0963a). A depth-one checkout contains 7,091 tracked files, including 2,932 Python files, 677 text files under docs, and three Markdown files. Its [Sphinx configuration](https://github.com/django/django/blob/2b30f6255b5ef84afbd827993643d52ef2c0963a/docs/conf.py#L101) assigns reStructuredText to the documentation text suffix.

The pinned baseline emits eight errors and 13 warnings. Default canonical/agent/changelog/drift-log requirements are adoption requirements. DCV001 falsely says the .flake8 filename is not mentioned in any documentation: its [coding style guide](https://github.com/django/django/blob/2b30f6255b5ef84afbd827993643d52ef2c0963a/docs/internals/contributing/writing-code/coding-style.txt#L48-L56) documents it. RST is outside the current Markdown coverage, and the finding overstates what was searched. Other sampled configuration/TODO findings remain policy or review judgments. No Django runtime defect was established.

Two separate schema-sync controls reproduce incorrect inventory behavior: an ignored test model still appears with either config.ignore or .docguardignore; one model under app/models.py appears twice because search roots overlap. Production model and empty-schema controls distinguish exclusion from blanket suppression. These DocGuard defects are corrected in the candidate. The same Django checkout yields 1,596 models with default scope and 11 with tests/** excluded; overlapping roots leave both results unchanged. Twenty focused schema tests pass. Python Django-field extraction and Python skipped-test detection also have unsupported portions. Zero results must not be interpreted as verified absence.

Django's contributor guidance uses Trac tickets for nontrivial work. No upstream report has been submitted. The shallow checkout cannot support freshness assessment, which requires at least three commits.

## Astro

Source: [withastro/astro at the assessed revision](https://github.com/withastro/astro/tree/7a698ca6e70d778343786cbf8fedd5f49d169ea4). Pinned baseline emits seven errors and 34 warnings in both default and explicitly configured reference-directory runs. The Markdown inventory expands from five to eight tracked files; this alone does not validate the new scope. Shallow history and the external Astro user-documentation repository remain outside this assessment.

Source triage confirms two further precision problems. A path expression in [telemetry configuration](https://github.com/withastro/astro/blob/7a698ca6e70d778343786cbf8fedd5f49d169ea4/packages/telemetry/src/config.ts#L20-L42) constructs a .config directory before appending the actual configuration filename, yet DCV004 calls the directory an undocumented config file. Separately, a plain-English CI timeout explanation beside a skipped test is ignored because it lacks the recognized REASON/NOTE-style prefix. The latter is a policy/wording defect: static parsing can establish absence of a recognized marker, not absence of a human explanation. Synthetic documented-file, unexplained-skip and recognized-reason controls reproduce the distinction.

Root STYLE_GUIDE.md already names two configurations reported as undocumented. This adjacent document-discovery limitation remains recorded; no redundant upstream prose should be generated to satisfy DocGuard.

## Diagnostic guidance

The live self-diagnosis exposed a review-only FRS005 signal converted into the incomplete command docguard fix --doc. Conventional canonical filenames were also automatically routed to rewrite prompts despite freshness being a review heuristic. The correction leaves freshness commands unset and asks for review of evidence and intent. A CLI regression checks both conventional and custom document paths and removes the instruction to eliminate every warning.

## Traceability synthetic audit

A separate read-only audit reproduced six candidate defects: duplicate requirement IDs collapsing across documents; arbitrary fixture JSON inflating feature coverage; lifecycle metadata not affecting enforcement; existing verification links not recognized; Markdown-linked definition IDs disappearing; and standard adjacent tasks not discovered by the requirement validator. The first two create false assurance and take priority over warning reduction. Fixture-based feature scoring now shares positive annotation/label extraction with validation, with 48 focused tests passing. Scope, lifecycle and explicit-link semantics need a shared evidence contract with compatibility tests.

## Independent validation: FastAPI

The [FastAPI checkout](https://github.com/fastapi/fastapi/tree/50113da16fec53b66b80d75e80a89296de4fa5a5) contains 3,139 tracked files. A frozen intermediate candidate containing the documentation-directory fix was compared with the released baseline under both default scope and explicit docs/en/docs. All four guard conditions returned eight errors and nine warnings with identical findings. Existing recursive docs discovery already includes that directory, so this is a neutral observation rather than proof of improved discovery. Later parallel edits require a fresh combined comparison.

Sampled unchanged limitations include a Usage-heading warning despite a worked Example, and an untracked-TODO claim despite an inline external PR reference. Neither establishes a FastAPI defect. Its external contribution policy asks for discussion and an invitation before a PR; no contribution was submitted. Shallow history, external tracking status and runtime behavior were not tested.

## Release acceptance

A next release requires multiple independently reproduced improvements, paired true-defect controls, consistent evidence semantics across affected commands, supported Node runtime checks, and a repeated field comparison at the same source revisions and configuration. Include an additional independent validation repository after implementing the fixes. Report unresolved findings and unsupported formats explicitly. Changes to totals alone, a high score, or more passing tests do not satisfy this gate.

## Upstream contribution policy

Submit only a verified upstream defect with a useful reproduction or precise documentation correction. Check the project's current contribution and AI policies, then search both open and closed issues and pull requests. Respect external documentation repositories and generated-file ownership. DocGuard setup preferences and ambiguous heuristic findings do not justify maintainer notifications. No upstream contribution has been submitted in this evaluation yet.

## Next improvement units

1. Unify scoped requirement definitions and evidence across validation and feature reporting. Repeated IDs across features must not silently share coverage; preserve unique-ID compatibility and report ambiguity explicitly. Implement lifecycle and existing verification links only with an explicit contract and paired controls.
2. Separate adoption requirements, enforced project policies and evidence of factual drift in agent-facing output. All four public baselines demonstrate that default canonical-layout errors primarily measure adoption. Preserve the established gate/exit contract while making these distinctions visible.
3. Improve supported-format disclosure, root document enrollment and conditional-skip/TODO wording. RST and external documentation must not be described as searched when they were not. A literal marker or heading match cannot establish semantic absence.
4. Repair test-harness isolation: legacy badge command tests execute in the source checkout and refresh generated .agent skill files. These side effects must not be mixed into precision commits.
5. Investigate a manual upstream documentation candidate: SvelteKit 3.0.0-next.27 project-structure guidance still says to extend .svelte-kit/tsconfig.json, whereas its migration guide and generator use $app/tsconfig. This was found by human-style cross-reading, not emitted by DocGuard. Related merged PRs [16458](https://github.com/sveltejs/kit/pull/16458), [16523](https://github.com/sveltejs/kit/pull/16523), and [16589](https://github.com/sveltejs/kit/pull/16589) were reviewed; do not reopen resolved work or characterize this as a released-version runtime defect. A contribution requires the project's requested validation and confirmation of remaining scope.

## Candidate validation checkpoint

The combined candidate before the conservative literal prefilter passed 1,603 tests on Node 24 with zero failures, skips or cancellations, in 184,442 ms locally. The subsequent prefilter and escaped-filename control pass 50 focused tests. A full final supported-runtime matrix is pending. Self-guard has zero errors and one existing FRS005 review signal; its removal is not a release objective.

Same-process, alternating validator samples reveal a real documentation-coverage cost from source parsing. After the prefilter, warm DocGuard-repository samples are 143–166 ms versus 34–41 ms released; Astro samples are 917–1,254 ms versus 546–595 ms; SvelteKit samples are 727–804 ms versus 444–501 ms. Four samples per version and project include a first cold measurement; these ranges list subsequent measurements. This is validator latency on this machine, not a throughput benchmark or proof of the cause of full-suite timing. The CI suite budget remains 120 seconds. An immutable local baseline run and CI comparison are required before judging the overall regression. Do not relax that budget to make this patch green.

Final configured field rerun, before the prefilter: SvelteKit 7 errors/42 warnings (baseline 7/44), Astro 7/35 (baseline 7/34), Django default 8/13 (unchanged), FastAPI 8/9 (unchanged). Astro adds an additional low-confidence path candidate; all four DCV004 findings are review signals. Warning counts are not accepted-defect counts.
