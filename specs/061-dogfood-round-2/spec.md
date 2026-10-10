# Feature Specification: Fixes From Dogfooding, Round 2

**Feature Branch**: `spec/061-dogfood-round-2`

**Created**: 2026-10-10

**Status**: Draft

**Spec ID**: `docguard.dogfood-round-2`

**Lineage**: Three false positives reported from running v0.43.0 on a zero-dependency Node project (#525, #526, #527). Follows `docguard.dogfood-findings` (050). Extends `docguard.generated-docs-consistency` (044), whose `detectCodeTechnologies` is shared by DDF001, `diff` and `generate`, and `docguard.precision-evidence-loop` (007), which made natural-language SEC001 values low-confidence.

**Input**: "Fix three dogfood issues filed today: #525, #526, #527."

## Problem

1. **DDF002 ignores `testPattern` on the docs side (#525).** The code side collects test files with the configured `testPattern`/`testPatterns`, but documented tests are read only when they look like `name.test.<ext>` or `name.spec.<ext>`. A TEST-SPEC that lists `test_bot.mjs` under `"testPattern": "test_*.mjs"` can never match, so every such test is reported as "in code but not documented".
2. **DDF001 only reads manifests (#526).** Tech Stack drift detects technologies from `package.json`, a Dockerfile or compose file at a package root, and `.tf` files. A project that calls DynamoDB through its own signed HTTP client and starts DynamoDB Local with `docker run` in a shell script gets a permanent "documented but not found in code: `DynamoDB`, `Docker`".
3. **DDF001 does not know TypeORM or Sequelize.** Its vocabulary names Prisma and Drizzle but not the two other ORMs spec 056 makes first-class model sources, so a project using either has its ORM neither reported when undocumented nor matched when documented.
4. **DDF001 needs a `package.json`.** Without one the check returns nothing, so a Python, Go, Ruby, Rust, PHP or C# project gets no tech-stack drift check at all.
5. **`diff` reads a fixed test-spec path.** It reads `docs-canonical/TEST-SPEC.md` even when `docs.roles.testSpec` maps the test spec elsewhere, while guard's DDF002 follows the mapping.
6. **SEC001 flags UI copy (#527).** A translation catalog entry such as `f_password: 'Password'` (or `'Contraseña'`, `'Confirm Password'`) is reported as a hardcoded password, with blocking severity.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Documented tests that follow the project's own naming match (Priority: P1)

1. **Given** `"testPattern": "test_*.mjs"`, root files `test_bot.mjs` and `test_web.mjs`, and a TEST-SPEC naming both in backticks, **Then** DDF002 reports nothing.
2. **Given** the same project with a TEST-SPEC naming `test_gone.mjs`, which does not exist, **Then** DDF002 reports it as documented but not found.
3. **Given** a project with no test pattern, **Then** DDF002 and `diff` report exactly what they reported before.

### User Story 2 - Technologies used without a manifest entry are found (Priority: P1)

1. **Given** a project whose source signs DynamoDB requests itself (`X-Amz-Target` of a `DynamoDB_<version>.<Operation>` target, a `DDB_ENDPOINT` setting) and whose `start.sh` runs `docker run amazon/dynamodb-local`, and an ARCHITECTURE that names DynamoDB and Docker, **Then** DDF001 reports nothing.
2. **Given** the same project with an ARCHITECTURE that names neither, **Then** DDF001 names both technologies and the file each one was found in, and `diff` shows the same files.
3. **Given** the signal appears only in a test file, a fixture, or a commented-out line, **Then** it is not evidence.

### User Story 3 - Every first-class ORM is a named technology (Priority: P2)

1. **Given** a `typeorm` or `sequelize` dependency and an ARCHITECTURE that does not name it, **Then** DDF001 reports it in code but not documented.
2. **Given** an ARCHITECTURE that names TypeORM or Sequelize and no such dependency, **Then** DDF001 reports it documented but not found.
3. **Given** a `mongoose` dependency, **Then** DDF001 reports MongoDB, as before, and nothing named Mongoose.

### User Story 4 - Every ecosystem gets the tech-stack check (Priority: P1)

1. **Given** a Python project with `psycopg2-binary` and `redis` in its manifests and an ARCHITECTURE naming PostgreSQL and Redis, **Then** DDF001 reports nothing; **given** PostgreSQL is named but no driver is declared, **Then** DDF001 reports it documented but not found.
2. **Given** a Python-only project whose ARCHITECTURE names React or DynamoDB, **Then** DDF001 does not report them as missing: no Python manifest could show React, and DynamoDB is reached through boto3, which names no service.
3. **Given** a project with no manifest of any kind, **Then** DDF001 is skipped, as before.
4. **Given** a Node project, **Then** DDF001 reports exactly what it reported before.
5. **Given** `generate` on a Python project, **Then** guard reports no DDF001 for the tech stack it wrote.

### User Story 5 - `diff` reads the mapped test spec (Priority: P2)

1. **Given** `docs.roles.testSpec` maps the test spec to `handbook/testing.md`, **Then** `diff` compares that document's tests with the code.

### User Story 6 - Password labels are not credentials (Priority: P1)

1. **Given** a catalog with `f_password: 'Password'`, `de: { password: 'Passwort' }`, `es: { password: 'Contraseña' }`, `confirmPassword: 'Confirm Password'` or `labels.password = 'Enter password'`, **Then** SEC001 reports nothing.
2. **Given** `password: 'hunter2xyz!'`, `DB_PASSWORD = 's3cr3tP4ssw0rd'`, `DB_PASSWORD = 'Password'` or `password: 'password'`, **Then** SEC001 still reports a hardcoded password.

## Requirements *(mandatory)*

- **FR-001**: A backticked, whitespace-free token in the test spec MUST count as a documented test file when it has today's `.test.<ext>`/`.spec.<ext>` shape, or when it matches a configured test pattern (`testPatterns`, or the legacy `testPattern`): the whole pattern, or, for a bare file name, the pattern's last path segment. `guard` (DDF002) and `diff` MUST use this one definition, and the code side MUST read the same patterns. Without a configured pattern the result MUST be unchanged.
- **FR-002**: The code side of DDF001 MUST also recognise DynamoDB from product source text: a `DynamoDB_<8 digits>.<Operation>` target, a `dynamodb.<region>.amazonaws.com` endpoint, the `amazon/dynamodb-local` image, `AWS.DynamoDB` (SDK v2), `boto3` `client`/`resource('dynamodb')`, or a `DYNAMODB_ENDPOINT`/`DDB_ENDPOINT` name; and from the `@aws-sdk/lib-dynamodb` dependency. Test files, non-product directories (tests, fixtures, examples), ignored paths and whole-line comments MUST NOT count. No other technology gains a text signal: names such as Redis or Postgres are too ambiguous in prose and protocol strings.
- **FR-003**: The code side of DDF001 MUST also recognise Docker from `docker run`, `docker build`, `docker compose` or `docker-compose <command>` in a shell script, a Makefile, or a CI workflow (`.github/workflows/*.yml`, `.gitlab-ci.yml`), and from a compose file (`compose.yaml`, `compose.yml`, `docker-compose*.yml`) anywhere in product paths. Commented lines MUST NOT count.
- **FR-004**: Every technology detected by a text signal (FR-002, FR-003) MUST name the file it came from: in the DDF001 message, after the technology's name when it is reported as in code but not documented, and in `diff` output, which lists the source file of every detected technology (text and JSON). Messages for technologies detected from manifests MUST stay byte-identical.
- **FR-005**: SEC001 MUST NOT report a value that is a password label: after trimming trailing `:`, `*` or an ellipsis, the value is a word for "password" in a common language, or a phrase of at most four words made only of letters that contains one, or the same words as its key (camelCase or snake_case, ignoring a leading UI prefix such as `f_` or `lbl`). A value qualifies only when it starts with an uppercase letter or a letter from a script without case, and only when its key is not an all-caps constant name. Every other value keeps today's classification.

- **FR-006**: TypeORM (`typeorm`) and Sequelize (`sequelize`) MUST be named technologies with their dependency mapping, so DDF001, `diff` and `generate` report them like Prisma and Drizzle. `mongoose` MUST keep mapping to MongoDB only.

- **FR-007**: DDF001 MUST run whenever the project has a dependency manifest of any ecosystem `detectEcosystems` parses (`package.json`, `pyproject.toml`, `requirements.txt`, `setup.py`, `Pipfile`, `go.mod`, `Gemfile`, `Cargo.toml`, `composer.json`, `*.csproj`, `pom.xml`, `build.gradle`), and MUST read each one's dependencies with the detection `generate` uses. A technology documented but not found MUST be reported only when one of the project's manifests could have shown it: Docker and Terraform everywhere; every technology when a `package.json` exists (unchanged); otherwise only the technologies whose common clients are all dedicated packages of that ecosystem. Node project results MUST be unchanged.
- **FR-008**: `diff` MUST resolve the test-spec document with `resolveDocRole`, as guard's DDF002 does.

## Success Criteria *(mandatory)*

- **SC-001**: Each fix has a reproduction test that fails before the change and passes after, with negative cases showing real defects are still reported.
- **SC-002**: The full suite passes and guard on this repository reports no new findings.

## Out of Scope

- A way to suppress one document-level finding with a reason (#526's second suggestion). Spec 057 adds reasons and expiry to suppressions.
- Naming Angular and Svelte from `package.json` (`@angular/core`, `svelte`). Both are in the vocabulary without a dependency mapping, so a Node project that documents them sees them reported as not found. Fixing it changes Node results, which FR-007 keeps unchanged; tracked separately.
- `diff`'s route section still reads `docs-canonical/API-REFERENCE.md` / `ARCHITECTURE.md` by fixed path.
- Text signals for Redis, PostgreSQL, MySQL or MongoDB. Their names and wire protocols are too ambiguous for an unparsed scan.

<!-- docguard:implementation-outcomes:start -->
## Implementation Outcomes

- `cdf35252487a397598f75026daa96b4a8d946e70` — Reviewed at cdf3525 on main: all 11 tasks are checked and were delivered by #535; the full suite (3279 tests) passes at this revision and on Node 18, 20, 22 and 24 in CI, and guard reports 0 errors. Evidence: `cli/commands/diff.mjs`, `cli/scanners/tech-stack.mjs`, `cli/validators/docs-diff.mjs`, `cli/validators/security.mjs`, `docs-canonical/ARCHITECTURE.md`, `tests/dogfood-round-2.test.mjs`. Accepted deviations: none. Successor: none.
<!-- docguard:implementation-outcomes:end -->
