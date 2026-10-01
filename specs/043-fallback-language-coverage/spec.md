# Feature Specification: Honest Coverage for Fallback Languages

**Feature Branch**: `fix/fallback-language-coverage`

**Created**: 2026-09-30

**Status**: Draft

**Spec ID**: `docguard.fallback-language-coverage`

**Lineage**:
- Relates to `docguard.calibrated-finding-channels` (specs/013). That spec
  added `parserTier` and the rule that a degraded analyzer downgrades a
  validator to `partial`. It exempted `fallback-language` ("no AST tier
  exists; not a gap"), while the README promised `partial` for it. This spec
  ends the exemption.
- Relates to `docguard.language-repository-coverage` (specs/009), which made
  unsupported analysis visible for JS/TS and Python. This spec does the same
  for Go, Java, Kotlin, Ruby, Rust, PHP and C#.

**Input**: Confirmed bug cluster. On Go, Java/Spring and Ruby projects DocGuard
reported a clean pass where it saw nothing.

## Problem

DocGuard reads JS/TS and Python with a syntax tree. It reads other languages
with patterns, or not at all. Five defects hid that difference:

1. **Coverage said `checked`.**
   - `tierApplicability()` returned no gap for `fallback-language`.
   - Go, Java and Ruby routes carried no tier, so their API findings said
     `parserTier: "not-applicable"`.
   - The API-surface validator reported `checked` on projects whose routes it
     matched by pattern only.
2. **Environment variables were read only in JS and Python.**
   - A Go `os.Getenv("X")`, a Ruby `ENV["X"]`, a Java `System.getenv("X")` and
     a Spring `${X}` were invisible.
   - With nothing found, the code-vs-doc env check was skipped silently, and
     the validator still said `checked`.
   - Renaming a Go env var produced no finding, while `diff` listed a
     still-used variable as "not found in code".
3. **Spring's default package was treated as an examples directory.**
   `src/main/java/com/example/shop/web/ProductController.java` matched the
   `example` non-product rule, so its routes and env reads were dropped.
   `com.example` is Spring Initializr's default package.
4. **Route discovery stopped at depth 5.** A controller in a standard Maven
   layout sits at depth 7 or more, so a Spring project had zero routes. Guard
   then reported the API surface as `no-matches` or `missing-prerequisite`
   instead of reporting the gap.
5. **The symbol map and module graph blamed the project.** On a Go or Java
   project they said "No import edges were found", "_No ranked source
   files._" or "_No source modules found_", when the language is simply not
   analysed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A pattern-only language is reported as partial coverage (Priority: P1)

A maintainer runs guard on a Go, Java or Ruby service. The API-surface
validator says its coverage is partial and names the language, and each API
finding carries `parserTier: "fallback-language"`.

**Acceptance Scenarios**:

1. **Given** a Gin project whose routes are matched by pattern, **When** guard
   runs, **Then** `apiSurface` is `partial`, the reason names Go and the file
   count, and API004/API005 carry `fallback-language`.
2. **Given** a Rails project, **Then** the same holds for Ruby.
3. **Given** an Express or Flask project read with a syntax tree, **Then**
   coverage and findings are unchanged.

### User Story 2 - Env vars are found in every supported language (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a Go file that calls `os.Getenv("DATABASE_URL")`, and
   ENVIRONMENT.md documents `DATABASE_URL`, **Then** there is no ENV003 and
   `diff` does not list it as "not found in code".
2. **Given** that file renames the variable to `DB_URL`, **Then** guard
   reports ENV003 naming `DB_URL`.
3. **Given** a Spring `application.yml` with `${SHOP_DB_URL}` and
   `${SHOP_DB_PASSWORD:changeme}`, **Then** both names are found.
4. **Given** a Swift or Scala source file, which has no env patterns, **Then**
   the Environment validator is `partial` and names the language, and `diff`
   prints the same limitation.
5. **Given** a string literal or a comment that mentions `os.Getenv("X")`,
   **Then** `X` is not counted.

### User Story 3 - A standard Spring project is scanned (Priority: P1)

**Acceptance Scenarios**:

1. **Given** `src/main/java/com/example/shop/web/ProductController.java`,
   **Then** it is product code and its routes are found.
2. **Given** a top-level `examples/` directory, **Then** it is still
   non-product, as today.
3. **Given** Spring is detected and the scan finds no route, **Then**
   `apiSurface` is `partial` and says so, never `no-matches`.

### User Story 4 - Unanalysed languages are named (Priority: P2)

**Acceptance Scenarios**:

1. **Given** a Go-only project, **Then** the symbol map and the module graph
   say that Go is not analysed and how many files that covers.
2. **Given** a JS project with a few Go files in scope, **Then** both outputs
   keep their ranking and diagram, and add one line naming the unanalysed
   files.

### Edge Cases

- **Mixed tiers:** a Flask project with Go routes reports `mixed`; the reason
  names both the pattern-fallback files and the pattern-only languages.
- **Routes only in test/fixture/example paths:** they are still excluded. When
  that leaves no route, the reason says how many were excluded and names
  `detection.includeNonProduct`.
- **Deep trees:** discovery is bounded by the ignore rules, a depth of 32 and
  a cap of 20,000 files. Hitting the cap makes the coverage `partial`.
- **Go layout:** when `go.mod` is at the root, the env scan reads the module's
  Go files even when a conventional root such as `api/` exists and would
  otherwise hide `cmd/` and `internal/`.
- **Go `internal/example`:** a Go package, not an examples directory.
- **API reference doc missing:** the status stays `missing-prerequisite`, as
  today, and no route scan runs for it.
- **This repository:** its moduleGraph `include` is `cli`. It declares
  `needsEnvVars: false`. Its outputs do not change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A validator whose code facts include items read in a language
  with no AST tier (`fallback-language`) MUST report `applicability: partial`.
  - The reason names the languages and the file count.
  - It says the absence of a finding there is weak evidence.
  - Findings are retained.
  - The message for `regex-fallback` alone is unchanged.
- **FR-002**: The Spring, Rails, Go and Rust route scanners MUST give each
  route `tier: "fallback-language"` with a reason. Each scan MUST report a
  tier over every file it read, including when it found no route.
  API-surface findings drawn from those scans MUST carry that tier, never
  `not-applicable`.
- **FR-003**: Env detection MUST recognise, in code (not in strings or
  comments), each form only in its own language:
  - Go `os.Getenv` and `os.LookupEnv`;
  - Ruby `ENV["X"]` and `ENV.fetch("X")`;
  - Java and Kotlin `System.getenv("X")` and Spring `@Value("${X}")`;
  - C# `Environment.GetEnvironmentVariable("X")`;
  - PHP `getenv("X")`, `$_ENV["X"]` and `env("X")`;
  - Rust `env::var("X")` and `env::var_os("X")`.

  It MUST also read `${X}` and `${X:default}` placeholders from Spring
  `application*` and `bootstrap*` `.yml`, `.yaml` and `.properties` files,
  skipping comment lines.
- **FR-004**: When the env scan's source roots contain source files in a
  language with no env patterns, the Environment validator MUST report
  `partial`, naming the languages and file counts. It MUST NOT report
  `checked` in that case. `diff` MUST print the same limitation under
  Environment Variables, and its JSON MUST carry it as `limitation`.
- **FR-005**: The env scan MUST cover the languages' own layouts, and nothing
  more:
  - when `go.mod` is at the project root, it reads every `.go` file in the
    module, because a Go package can live in any directory;
  - when a `Gemfile` is at the root, it reads the `.rb` files under
    `config/`.

  Other scanners' source roots are unchanged.
- **FR-006**: A path segment MUST NOT be treated as a non-product directory
  when it is a package name:
  - any segment below `src/main/java`, `src/main/kotlin`, `src/main/scala` or
    `src/main/groovy`;
  - `example`, `examples`, `sample` or `samples` directly after a
    reverse-domain segment (`com`, `org`, `net`, `io`, …) or after Go
    `internal`.

  Directory walkers that prune non-product directories MUST apply the same
  rule, using the directory's path.
- **FR-007**: When route evidence exists only in non-product paths, the
  API-surface reason MUST say how many routes were excluded and name
  `detection.includeNonProduct`. The shared-ignore comment MUST describe what
  callers actually do.
- **FR-008**: Route file discovery MUST NOT stop at depth 5. It is bounded by
  the ignore rules, a depth of 32 and a cap of 20,000 files per scan.
  Reaching the cap MUST make the coverage `partial`.
- **FR-009**: When a framework whose routes are read by pattern only is
  detected and its route scan yields no route, the API-surface validator MUST
  NOT report `checked` or `no-matches`. It reports `partial`, naming the
  framework and the number of files read. Without an API reference doc the
  validator still reports `missing-prerequisite` and does not scan routes, so
  it claims nothing about the code.
- **FR-010**: The symbol map and the module graph MUST name the source
  languages the import graph does not read (JS/TS and Python only), with file
  counts, for files in their scope.
  - When no analysable file exists, they MUST say the language is not
    analysed instead of "No import edges were found", "_No ranked source
    files._" or "_No source modules found for the module graph._"
  - The module graph's completeness is unchanged by this: the gap depends on
    the code, not on the machine.
- **FR-011**: The README `parserTier` paragraph, ARCHITECTURE.md's
  analyzer-tier row, DATA-MODEL's config table (`detection.includeNonProduct`),
  the config schema, `docguard explain environment`, the ENV003 help text and
  CHANGELOG `### Fixed` MUST describe the behaviour above.

## Success Criteria *(mandatory)*

- **SC-001**: On temporary Go (Gin), Java (Spring, Maven layout,
  `com.example`, depth 7) and Ruby (Rails) projects:
  - guard reports `apiSurface` as `partial`, naming the language;
  - API findings carry `fallback-language`;
  - the Environment validator finds the project's env reads;
  - renaming a Go env var produces ENV003.
- **SC-002**: An Express project and a Flask project produce the same
  `apiSurface` and `environment` coverage and findings as before.
- **SC-003**: A project shaped like this repository keeps its Environment
  coverage and its module-graph bytes:
  - it declares `needsEnvVars: false` and a module-graph `include`;
  - it holds a source file in another language outside that scope.

  On this repository itself, `docguard guard` reports no new finding and no
  change in check coverage.

## Assumptions

- Pattern reading is the only analyzer DocGuard has for these languages.
  Adding a parser is out of scope, so honest coverage is the fix.
- A literal name is the only form any env pattern can see. Dynamic names
  (`os.Getenv(key)`) are invisible in every language, as they are today in JS.

## Out of Scope

- **Parsers for Go, Java, Ruby and the other pattern-only languages**:
  rejected. It would add dependencies (Constitution II).
- **Tiers on JS/TS route scanners** (Express, Fastify, Hono, Next.js):
  unchanged. Their findings keep today's tier, and
  `docguard.calibrated-finding-channels` owns that surface.
- **The Architecture validator**: its reason already names its scope ("JS/TS
  and Python static import graphs"). A Go-only project reports
  `not-applicable`.
- **Env reads inside ERB-templated YAML** (Rails `database.yml`): not read.
