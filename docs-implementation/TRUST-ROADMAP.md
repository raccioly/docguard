# DocGuard: evidence, accuracy, and sustainable adoption

## Product direction

DocGuard should make repository documentation dependable enough for both people and agents to act on. Its defensible position is a portable verification layer that links documentation claims, implementation facts, approved intent, and repeatable tests. Success means fewer incorrect changes and less maintenance effort. More generated documents, more alerts, and a higher internal score are insufficient measures.

The immediate strategy is to repair trust failures in the existing tool, make uncertainty explicit, and make a disputed finding useful to maintainers. The longer-term strategy is to accumulate independently reviewed failure cases and reusable verification evidence. This work complements specification frameworks, editorial linters, and API compatibility checkers. Replacing their mature domain-specific engines would increase maintenance before proving additional value.

This roadmap distinguishes implemented local changes from proposed capabilities and experiments. Product sources were reviewed on September 11, 2026. Descriptions of external tools reflect their published capabilities, rather than a comparative benchmark. Numerical pilot targets below are proposed decision thresholds, not achieved results.

## Evidence from the repository

The starting checkout was v0.35.0 at `246daf2`. Guard reported zero errors, 21 warnings, and 14 extracted unverified claims in the initial review. A later concurrent snapshot reported 22 warnings as local content changed. Score returned 100/A+ and a 100% memory-accuracy proxy. The discrepancy exposed a reporting problem: structural maturity was being presented as factual accuracy.

Two defects were reproduced directly. After editing an environment-variable reference without changing a manifest or Git HEAD, a fresh plan-cache read returned the old reference; bypassing the cache returned the new one. Separately, the generated pre-push hook's compact-JSON regular expression extracted an empty score from actual formatted score output and allowed the push.

Traceability warnings also referenced requirement IDs inside test-fixture strings. Those examples were neither product requirements nor coverage annotations. They illustrated why simply making every warning blocking would create friction without establishing correctness.

The unrestricted Node 24 baseline passed all 1,050 tests in approximately 24 seconds on the local machine. The earlier restricted run encountered socket/cache permissions and a watcher resource error. These observations are environment-specific. The final [validation record](TRUST-VALIDATION.md) records the integrated runtime matrix, guard results, packaging check, and cache benchmark.

## Field-driven implementation and next acceptance gates

The subsequent enterprise precision pass implements paired controls for formatting-only diffs, explicitly synthetic mock expectations, explained conditional skips, negated technology mentions, and API contract/code attribution. It adds bounded Worker binding extraction, explicit unsupported Python architecture coverage, custom Markdown role mapping, and review-oriented freshness semantics. See [precision validation](PRECISION-VALIDATION.md) for observed outcomes and limits.

The next work should be evaluated in this order:

1. **Requirement links without annotation lock-in.** Support explicit requirement-to-test links in documentation tables and external test manifests, scoped to a spec identity and lifecycle. Preserve duplicate IDs across separate specs. An existing link is evidence of traceability, never proof that the test exercises the requirement. Acceptance: existing annotated projects retain findings, explicit valid links avoid annotation-only warnings, broken links remain findings, and draft specs do not masquerade as approved requirements.
2. **Evidence-scoped review.** Replace repository-wide age heuristics with explicit source-to-document dependencies where available. Keep an unscoped fallback visibly low confidence. Acceptance: unrelated source changes do not ask for review of linked documents, while changed or deleted dependencies invalidate review evidence. Avoid automatically stamping review dates.
3. **Safe mapped document writes.** Extend role mapping from validation/planning to section-owned writers only after testing preservation of surrounding prose, backup failures, symlinks, duplicate roles, and repeat execution. Acceptance: no duplicate canonical tree, unchanged authored sections, and refusal of ambiguous ownership.
4. **Broader language evidence.** Add Python import relationships and additional Worker binding forms as separate capabilities. Acceptance: paired supported/unsupported fixtures and labeled mixed-language repositories; empty extraction never becomes a success claim.
5. **Independent precision corpus.** Sample repositories beyond the author's projects and label each finding family independently. Measure precision, missed defects, setup time, accepted repairs, and runtime by capability and project type. New detections require true-defect controls as well as false-positive fixes. Total warning reduction alone is not a quality metric.

The contribution loop already prepares metadata-only feedback and asks for minimized synthetic cases. Extend that with a reviewed fixture plus its opposite control, maintainer reproduction, and a regression test before accepting a rule change. Keep submissions voluntary and avoid copying enterprise source into public reports.

## Competitive landscape

| Tool | Published capabilities | Strategic consequence |
|---|---|---|
| GitHub Spec Kit | Specification, clarification, planning, analysis, implementation, and convergence against spec artifacts | Generic spec conformance and agent task orchestration already have substantial support. [1] |
| OpenSpec | Change proposals, dependency-ordered artifacts, delta specs, archive lifecycle, JSON interfaces, and optional agent verification | Incremental spec change and agent verification prompts are useful integration points, rather than unique differentiation. [2] |
| Kiro | Specs, hooks, parallel tasks, and correctness support using generated property-based tests | Compete on portable, measured evidence rather than claiming other tools only generate prose. [3] |
| Vale | Extensible editorial rules, syntax-aware scopes, terminology, severity, and CI | Prioritize code-linked correctness over expanding subjective prose rules. [4] |
| oasdiff | OpenAPI compatibility changes with domain-specific severity and machine output | Preserve upstream compatibility semantics and link their consequences to prose, examples, and migration guidance. [5] |
| Buf | Explicit Protobuf compatibility policies at file, package, and wire levels | A generic checker should consume these specialized results instead of reconstructing their semantics. [6] |
| Docs-as-code and Sphinx | Reviewed, versioned documentation and executable examples | Testing documentation predates DocGuard. The gap concerns unsupported claims and relationships between evidence sources. [7] |

A Spec Kit discussion already proposes a shared conformance-report schema and deterministic gate consumer. It is a proposal rather than a proven deployed system, but the basic architecture has prior art. The opportunity is execution quality, credible evaluation, and a useful regression corpus. [8]

## Research implications

The revised AGENTS.md study found that repository context files did not generally improve task success in its evaluated settings and increased average inference cost by more than 20%. The authors also observed that instructions were generally followed. This supports selective context and direct evaluation, rather than a blanket claim that agents ignore instructions. The finding is not a measurement of DocGuard. [9]

Spec Kit Agents reports improvements from phase-level contextual grounding, including a small judged-quality improvement across 128 runs. Its scale and LLM-judge component limit generalization. Taken together, these studies support testing task-specific evidence packets, with objective task outcomes and repeated trials. [10]

Lost in the Middle demonstrates position sensitivity for information in long contexts on the models and tasks studied. Its older, largely non-coding setting makes it a reason to test ordering, not proof that a particular modern coding agent needs one arrangement. [11]

SpecMine offers public specification histories and spec-touching pull requests that could support realistic sampling. It does not supply correctness labels; licensing and independent annotation remain necessary. Vendor guidance on context engineering and agent evaluations also favors selective context, repeated trials, and outcome-based assessment. [12][13]

## Architecture of trustworthy documentation

Separate four authorities. Implementation facts come from source and configuration. Intended behavior comes from approved requirements. Design rationale comes from recorded decisions. Operational truth comes from exercised procedures and the actual environment. Each authority answers a different question.

A source-derived statement such as a configured timeout is an extraction result. A claim that a request is rejected after that timeout needs behavioral evidence. A decision that the timeout is appropriate belongs to approved requirements. Automatically changing requirements to match implementation can conceal a regression.

The desired lifecycle is: observe a change, identify affected claims and dependencies, refresh mechanical facts, review affected intent, verify against the current revision, enforce declared policy, and update the agent's relevant context. Periodic review addresses evidence outside Git, such as a vendor API or deployed configuration.

Evidence should be scoped. A successful check establishes a predicate over particular inputs using a particular checker. It does not certify all prose or all future states. A useful record identifies the claim, input digests, checker version, parser tier, policy, result, and limitation. A content hash identifies a snapshot; it is not a trusted signature or reviewer approval.

## Implemented foundation in the local change set

| Workstream | Behavior | Verification |
|---|---|---|
| Cache correctness | Relevant content, paths, configuration, scanner identity, and parser availability participate in plan identity; incomplete input identities bypass reuse | Source edits, fresh-process reads, configuration changes, corruption, privacy, and boundary tests |
| Hook enforcement | Real JSON parsing; local installed runtime; unexpected runtime failures block; warning semantics remain explicit | Generated scripts executed with controlled successful, failed, missing, and malformed runtimes |
| CI installation | `init --with ci` writes the maintained, pinned workflow; preserves existing files and rejects unsafe destinations | Scaffolder, overwrite, path-boundary, and template tests |
| Spec Kit gate | After-implementation hook matches the documented mandatory policy | Manifest and template contract tests |
| Trace precision | Fixture strings cannot impersonate requirement declarations or satisfy coverage | Fixture/annotation and multilingual regression cases |
| Freshness/watch | Configured and nested docs; broader committed source changes; batched history; watcher error handling and cleanup | Date, add/delete, lifecycle, and error-path tests |
| Honest scoring | Structural score thresholds preserved; factual accuracy is explicitly unverified and nullable across machine consumers | Shared output-contract tests |
| Feedback | Select confident findings; preview; metadata-only issue drafts; search existing open and closed work | Selection and outbound-canary tests |
| Agent evidence | Stable claim identity and snapshot provenance; truthful acceptance and context limitations | Identity, source-change, and filesystem-boundary tests |
| Documentation | Replace stale dependency, security, score, and test-coverage claims; centralize CI recipes around maintained templates | Guard, cross-references, and canonical review |

These are implementation scope descriptions, not assertions of field effectiveness. Inspect the final test record for integrated results and remaining limitations. Installed consumer hooks must be regenerated to receive changed hook behavior. JSON consumers must preserve nullable accuracy; coercing null into a numerical percentage defeats the corrected contract.

## Phase 1: establish an independent correctness baseline

Create a feasibility corpus of roughly 30 repositories and 150–200 adjudicated cases. Sample JS/TS and Python AST tiers, fallback languages, generated artifacts, monorepos, nested documentation, framework conventions, and repositories with intentionally sparse docs. Obtain appropriate permissions and verify licensing before redistributing examples.

Each case should identify the expected behavior independently of DocGuard's output. Include natural defects, clean controls, synthetic mutations, and ambiguous examples. Use two independent labels with adjudication; preserve unresolved disagreement as ambiguity. Split by repository and causal bug family to reduce leakage between development and evaluation.

Measure precision, recall, false positives per repository, abstention, unsupported coverage, cold/warm runtime, and repair acceptance. Publish results by detector family and parser tier. A single aggregate score can hide a weak language or framework behind an easy majority.

Acceptance: the corpus runs reproducibly from pinned snapshots; clean controls and seeded defects have independently reviewed expected outcomes; failures retain enough evidence to reproduce. Set release-gating thresholds after observing baseline variance. Reject a precision improvement achieved merely by skipping supported cases.

## Phase 2: contribution-to-regression workflow

Build on the existing feedback command and `node:test`. The implemented selection and preview improvements are the first step. The next increment is a small fixture manifest describing detector family, relevant options, expected findings, and the valid control case. Keep fixtures as data whenever possible.

Classify a report as suspected false positive, false negative, unsupported syntax, or policy disagreement. A suppression is not automatically a defect. A report of missing detection needs its own expected predicate because there is no emitted finding to select.

Prefer synthetic examples with invented names and values. An automated reducer may later help, but it must preserve valid input and the disputed semantics, not merely any occurrence of the same warning code. If that predicate cannot be established mechanically, label the reduced example as requiring manual review. Reducer research and tools such as C-Reduce already use explicit interestingness predicates; the DocGuard-specific work is defining useful predicates and packaging. [14]

Keep private diagnostic records separate from the public payload. Allowlist the synthetic fixture, minimal configuration, expected behavior, and tool/runtime metadata. Arbitrary source messages, private paths, suggestions, and snippets remain excluded by default. Hashing private text is not anonymization.

Deduplicate with a public-safe identity over the reviewed fixture, detector family, mode, and expected/actual classification. Search open and closed issues and PRs. Semantic similarity can suggest related work but should not merge distinct causes automatically. Closed work becomes a regression only with evidence that the defect recurs in a current version.

For each accepted false-positive fix, retain a neighboring real defect that still fails. For each false-negative fix, retain a similar valid case that stays clean. Test-only contributions should be useful without requiring the reporter to patch the detector. Separate reproduction, patch authoring, and review responsibilities when agents assist.

Suggested pilot decision thresholds: at least 80% of accepted reports reproduce without private material; median active triage time falls by 30%; duplicate workload stays level or improves. Any unauthorized transmission or seeded secret leak blocks release. These targets are hypotheses for the pilot, not existing measurements.

## Phase 3: claim-specific verification records

Start with exact, bounded claim types: a named JSON configuration value, a declared enum set, or a count bound to a documented collection. Use existing generated-section and collection mechanisms where sufficient. Avoid a general language that requires arbitrary code execution.

A proposed record includes claim identity, predicate type, expected value, source and configuration digests, checker implementation identity, extraction tier, and a result chosen from verified-within-scope, contradicted, unsupported, inconclusive, and stale. Reviewer approval, when needed, is separate from scanner output. Include the scope and reason in machine output.

Revalidate when any relevant input or checker changes. Track relevant transitive imports and generated inputs where a supported predicate depends on them. If dependencies cannot be resolved, abstain or recheck broadly. Preserve unknowns instead of retaining an old successful verdict.

Acceptance: every seeded relevant change invalidates or recomputes the result; unrelated edits do not trigger broad work unnecessarily; malformed, missing, or unsupported evidence remains explicit. A passing source-value check must never be labeled as proof of runtime behavior or approved business intent.

## Phase 4: task-specific agent context

Extend the existing context pack and changed-code verification tasks. Select the constraints, claims, evidence, and known uncertainty relevant to the current task. Include current revision and source references. Show what was omitted because of a budget or unsupported retrieval relationship.

Maintain a small persistent policy layer for nonstandard practices and hard boundaries. Retrieve implementation details on demand. Keep event history separate from durable decisions, and mark superseded decisions rather than accumulating contradictory instructions.

Evaluate three arms: ordinary repository context, existing DocGuard context, and the proposed targeted evidence packet. Freeze model/harness versions, repository snapshots, task budgets, and prompts. Repeat trials and measure hidden-test success, requirement violations, unnecessary edits, total tokens, latency, and human intervention. Include extraction, retrieval, retries, and verification in cost.

Acceptance: demonstrate improved task success, or lower cost within a preregistered non-inferiority margin for success. Report repository-clustered confidence intervals and first-attempt/repeated-run results. Reject a benefit claim supported only by an LLM judge or a better DocGuard score.

## Phase 5: specialized evidence adapters

Consume saved, versioned outputs from tools such as oasdiff or Buf before adding subprocess integrations. Preserve the upstream tool version, policy, scope, and verdict. Connect changes to related documentation examples, migration notes, and requirements while exposing uncertain mappings.

For example, a removed API field can identify a compatibility finding, a stale example, and a missing migration instruction as separate consequences. The upstream schema checker owns compatibility semantics. DocGuard owns the documented relationships and unresolved review tasks.

Acceptance: an adapter adds real, independently labeled documentation defects beyond the upstream checker alone, at an acceptable false-positive and setup cost. Stop if a straightforward existing-tool configuration achieves equivalent benefit more cheaply. Avoid downloading or executing arbitrary tools as a side effect of ordinary validation.

## Phase 6: sustained operation and ownership

Use local hooks for fast feedback, required CI checks for shared enforcement, and scheduled review for external or time-sensitive evidence. Verify actual repository protection settings and bypass policy separately from workflow generation. A check can be present without being required; some successful-looking statuses can reflect skipped work. [15]

A scheduled repair should collect deterministic changes into one reviewable proposal, check for existing repair work, and remain quiet when nothing actionable changed. Retain an owner, review expectation, and reason for temporary suppression. Suppression expiry is useful only when it leads to an accountable review rather than recurring noise.

Avoid treating a daemon, scheduled job, or second agent as proof of correctness. Health must describe which checks ran, against what revision, and whether their output was complete. Tool failure, unsupported input, and unverified prose remain separate states.

Start with repository-native automation. A hosted control plane becomes worthwhile only when teams demonstrate an unmet cross-repository ownership or evidence-retention need. The current product has no web UI or editor extension; neither is required for this roadmap.

## Release and regression strategy

Run focused tests after each coherent patch and the full supported Node matrix after integration. Keep the current numeric score and exit-code contract unless a deliberately documented change is necessary. Explicitly document nullable accuracy and stricter missing-runtime hook behavior.

Retain regression fixtures for the original failure, a neighboring valid case, and the corresponding true defect. Use real generated hook execution, fresh-process cache reads, and output parsing rather than assertions that merely mirror implementation strings. Benchmark correctness-preserving changes before advertising speed improvements.

Keep release artifacts and protected merge checks tied to reviewed revisions. Regenerate consumer hooks and templates deliberately. Publish a migration note explaining changed behavior, known limitations, and supported escape hatches. Avoid force-updating user configuration or silently lowering severity to produce a clean badge.

## Decision rules and stop conditions

Continue investing where measured correctness or maintenance economics improve. Stop or redesign a feature when it repeatedly increases false positives, requires broad private-data disclosure, obscures unsupported coverage, or adds a second source of truth that costs more to maintain than to derive.

The strongest prospective asset is a reviewed corpus of causal failure families and reusable verification predicates. Installation counts and issue volume may show reach, but retained users, accepted repairs, reproducible contributions, and avoided wrong changes establish value.

The bounded promise is: declared supported checks run against the identified revision; changed evidence invalidates prior results; unresolved information remains visible and assigned. Universal prose correctness and superiority over every competing tool remain claims requiring evidence beyond this implementation.

## Sources

1. GitHub. [Agentic SDD reference](https://github.github.com/spec-kit/reference/agentic-sdd.html) and [extension reference](https://github.github.com/spec-kit/reference/extensions.html). Live documentation accessed September 11, 2026.
2. Fission AI. [OpenSpec overview](https://github.com/Fission-AI/OpenSpec/blob/main/docs/overview.md), [CLI](https://github.com/Fission-AI/OpenSpec/blob/main/docs/cli.md), and [verification template](https://github.com/Fission-AI/OpenSpec/blob/main/src/core/templates/workflows/verify-change.ts). Mutable main branches accessed September 11, 2026.
3. Kiro. [Specs](https://kiro.dev/docs/specs/), [correctness](https://kiro.dev/docs/specs/correctness/), and [hooks](https://kiro.dev/docs/hooks/). Updates reported by the pages: August 27, August 4, and September 2, 2026, respectively.
4. Vale. [Introduction](https://docs.vale.sh/) and [CLI](https://docs.vale.sh/topics/cli). Accessed September 11, 2026.
5. oasdiff. [Breaking changes and changelog](https://github.com/oasdiff/oasdiff/blob/main/docs/BREAKING-CHANGES.md). Accessed September 11, 2026.
6. Buf. [Breaking-change detection](https://buf.build/docs/breaking/). Accessed September 11, 2026.
7. Write the Docs. [Docs as code](https://www.writethedocs.org/guide/docs-as-code/). Sphinx. [Doctest extension](https://www.sphinx-doc.org/en/master/usage/extensions/doctest.html). Accessed September 11, 2026.
8. GitHub Spec Kit community. [Conformance-report discussion #2726](https://github.com/github/spec-kit/discussions/2726). May 27, 2026. Proposal, not evidence of a shipped implementation.
9. Gloaguen et al. [Evaluating AGENTS.md, v2](https://arxiv.org/abs/2602.11988v2). June 23, 2026.
10. Taghavi and Bhavani. [Spec Kit Agents](https://arxiv.org/abs/2604.05278). April 7, 2026.
11. Liu et al. [Lost in the Middle, v3](https://arxiv.org/abs/2307.03172v3). November 20, 2023.
12. Agarwal et al. [SpecMine, v3](https://arxiv.org/abs/2608.25202v3). September 1, 2026.
13. Anthropic. [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), September 29, 2025; [Demystifying agent evaluations](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), January 9, 2026.
14. C-Reduce contributors. [Reducer implementation](https://github.com/csmith-project/creduce/blob/master/creduce/creduce.in). Accessed September 11, 2026.
15. GitHub. [Troubleshooting required status checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks). Accessed September 11, 2026.
