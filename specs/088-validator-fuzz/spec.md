# Feature Specification: Every Document Parser Survives Any Input, Quickly and Deterministically

**Feature Branch**: `claude/docguard-aws-comparison-077b3f`

**Created**: 2026-11-03

**Status**: Draft

**Spec ID**: `docguard.validator-fuzz`

**Lineage**: Eleventh feature of the DocGuard × AI-DLC program (issue 607). It protects the parsers that specs 081 to 092 added or extended:
- requirement IDs and the Spec Kit chain (085);
- decision records (086);
- AI-DLC stage progress and memory references (089, 091);
- waiver metadata (084).

It also protects older shared readers: headings, doc sections, covers lists, lifecycle status, API reference tables, HTML comments and `.docguardignore`.

**Input**: DocGuard's parsers read text people and agents write. An agent can emit anything, and AI-DLC writes hundreds of records per intent. Unit tests cover the shapes their authors thought of. Nothing checks the rest:
- that a parser never throws;
- that it gives the same answer twice;
- that it never takes quadratic or exponential time on a crafted line. In CI, that is a hang. On an MCP server, it is a denial of service.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The suite fuzzes every parser on every run (Priority: P1)

**Independent Test**: `node --test tests/validator-fuzz.test.mjs` with a fixed seed.

**Acceptance Scenarios**:

1. **Given** each registered parser, **Then** it receives 200 generated documents and the pathological inputs. Each call returns without throwing, and twice gives the same result.
2. **Given** each call, **Then** it finishes within 250 ms plus 1 ms per 100 characters of input.
3. **Given** a planted parser that throws, varies its answer, or backtracks catastrophically, **Then** the harness reports `throws`, `nondeterministic` or `slow`. The harness proves it can fail.

### User Story 2 - A maintainer runs a deep fuzz and keeps what it finds (Priority: P2)

**Acceptance Scenarios**:

1. **Given** `node tools/fuzz.mjs --cases 20000 --seed <n>`, **Then** every failure prints its parser, kind, seed and case.
2. **Given** `--save`, **Then** the failing input is shrunk line by line while it still fails the same way, and written to `tests/fixtures/fuzz/<parser>-<hash>.txt`. The suite replays every file there against its parser.

### Edge Cases

- **Generation must reach the parsers.** A generator that only makes noise would pass trivially. The grammar mixes structured blocks (ADR sections, stage progress, covered sections, requirement lists) with mutations, and the test asserts that each parser returns a non-empty result on part of the corpus.
- **Quadratic behavior hides at small sizes.** The pathological set includes inputs of about 200 KB.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `tools/fuzz.mjs` MUST generate documents from a seeded 32-bit generator. The same seed MUST give the same documents, with no dependency.
- **FR-002**: For every parser in its `TARGETS` list and every input, it MUST check three properties: no throw, a deterministic result, and time within `250 + length / 100` ms. It MUST also check each parser's result shape where one is declared.
- **FR-003**: `tests/validator-fuzz.test.mjs` MUST run a fixed seed with 200 cases per parser plus the pathological set, replay `tests/fixtures/fuzz/`, prove the harness detects planted faults, and require each parser to be reached by part of the corpus.
- **FR-004**: A failure found by the harness MUST be fixed in the parser, not exempted, and its input MUST be kept as a pathological case or a saved fixture.
- **FR-005**: `docs-canonical/TEST-SPEC.md`, `CONTRIBUTING.md` and `CHANGELOG.md` MUST describe the harness and how to run a deep fuzz.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every acceptance scenario has a test.
- **SC-002**: Six seeds of 3,000 cases each across 19 parsers report no failure after the fixes this spec makes.
- **SC-003**: The suite's fuzz test takes under 5 seconds.

## Verification Notes

On 2026-11-03 the first runs reported no failure on 20 KB inputs. Probing at 200 KB found one real defect:
- `stripHtmlComments` re-masked the rest of a line's code spans for every comment on the line, so it was quadratic in the number of comments.
- One generated 265 KB line holding 3,333 `docguard:section` comments took 9.7 s.
- The reader feeds Docs-Sync, requirement parsing and instruction pointers, so a generated one-line HTML table in a doc would stall guard.

The fix scans for the first opener outside code spans and stops there. A differential run over 590,732 line and state pairs found no output difference from the old code. The 265 KB line now takes under 1 ms.

The pathological set now includes about 200 KB inputs, and the old code fails it: 5.6 s against a 2.2 s budget.

Generation was tuned until every parser was reached. In a 2,000-document sample, the low end was ADR parsing at 9%, covered sections at 8% and stage progress at 17%.

- **SC-002**: seeds 1, 2, 3, 42, 1337 and 9001 ran 3,000 cases each across the 19 parsers, plus the pathological set, after the comment-reader fix. No failures.
- **SC-003**: `tests/validator-fuzz.test.mjs` runs in about 1 second; the test asserts the fixed-seed run stays under 5 seconds.

## Assumptions

- Parsers are pure functions of their text. Anything that reads the filesystem or git is out of scope here; spec 081's observation gaps cover those.

## Out of Scope

- Coverage-guided fuzzing and new dependencies.
- Fuzzing whole validators against generated repositories.
