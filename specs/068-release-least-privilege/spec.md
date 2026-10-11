# Feature Specification: Release Workflows Run Code Without Write Tokens

**Feature Branch**: `ci/release-least-privilege`

**Created**: 2026-10-11

**Status**: Draft

**Spec ID**: `docguard.release-least-privilege`

**Lineage**: Hardens the release pipeline of `docguard.tokenless-scheduled-releases` (011), `docguard.release-dispatch-window` (023) and `docguard.release-readiness` (026). Found while narrowing Jules auto-merge (`docguard.jules-policy`, spec 067): a bot may now merge new test files without a maintainer, and the release workflows run the test suite while holding write tokens.

**Input**: "Run release-workflow tests without write tokens."

## Problem

1. **The release test job can write to the repository.** `release.yml` grants `contents: write` at the workflow level. Its `test` job inherits it and runs `npm test`, and the checkout leaves the token in `.git/config`, where any test can read it and push.
2. **The scheduled release runs tests with three write scopes.** `scheduled-release.yml` is one job holding `contents`, `actions` and `pull-requests` write. It runs `npm ci` and `npm test` in the same checkout it later pushes from, so test code could change what the release branch carries, push elsewhere, or dispatch workflows.
3. **Third-party build tools run next to a write token.** `build-mcpb` runs `npm pack`, `npm install` and `npx @anthropic-ai/mcpb` in a job holding `contents: write` with persisted credentials; `build-extension` builds and uploads in the same write job.
4. **PyPI's build shares the job that can publish.** `publish-pypi` runs `pip install build` and `python -m build` in the job holding `id-token: write`.
5. **The GHCR job logs in before it builds.** `publish-ghcr` stores the registry credential before running `docker build` and the image smoke test.
6. **Nothing stops this from coming back.** No test checks workflow permissions against what each job runs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Merged test code cannot use a write token (Priority: P1)

1. **Given** any workflow job that runs the test suite or DocGuard on this repository, **Then** it holds no write permission and its checkout does not persist credentials.
2. **Given** the scheduled release, **Then** the version cut and the test run happen in read-only jobs, and the job that pushes the release branch applies the exact patch the cut produced and runs no repository code.

### User Story 2 - Build tools never share a job with a write token (Priority: P1)

1. **Given** the release assets (Spec Kit extension ZIP, Claude Desktop bundle, PyPI distribution), **Then** they are built in read-only jobs, and the jobs that attach or publish them receive only the built files.
2. **Given** the GHCR image, **Then** the registry login happens only after the image is built and smoke-tested.

### User Story 3 - The rule is enforced (Priority: P1)

1. **Given** a pull request that gives a test-running job a write permission, or runs a package manager, build tool or test in a job holding `contents`, `actions`, `pull-requests` or `issues` write, **Then** the test suite fails and names the job.

## Requirements *(mandatory)*

- **FR-001**: Every workflow's top-level `permissions` MUST be read-only; a job that needs more MUST request it in its own `permissions` block.
- **FR-002**: A job that runs repository test code or DocGuard on this repository (`npm test`, `node --test`, `node cli/docguard.mjs`) MUST hold no write permission, and every `actions/checkout` in it MUST set `persist-credentials: false`.
- **FR-003**: A job holding `contents`, `actions`, `pull-requests` or `issues` write MUST NOT run a package manager, build tool, test runner or third-party package (`npm`, `npx`, `pip`, `python -m build`, `docker build`, `node --test`, `node cli/`). Publishing jobs MAY hold only their registry credential (`id-token` or `packages`).
- **FR-004**: The Spec Kit extension ZIP, the Claude Desktop bundle and the PyPI distribution MUST be built in read-only jobs and handed to the attaching or publishing job as workflow artifacts; those jobs MUST NOT build.
- **FR-005**: The scheduled release MUST cut the version in a read-only job that uploads the release patch before any test runs; run `npm test` and guard on that patch in a separate read-only job; and push the release branch from a job that checks every path in the patch against the release path list, applies it, and runs no repository code. The recovery dispatch of `release.yml` MUST run in a job that holds only `actions: write` and checks nothing out.
- **FR-006**: `publish-ghcr` MUST log in to the registry only after the image is built and smoke-tested.
- **FR-007**: A test MUST fail when any workflow under `.github/workflows/` violates FR-001, FR-002 or FR-003, naming the workflow and the job.
- **FR-008**: `docs-canonical/SECURITY.md` MUST state the rule, and the release documentation MUST describe the new job layout.

## Success Criteria *(mandatory)*

- **SC-001**: The FR-007 test fails on the workflows before the change and passes after; the existing release-workflow tests pass against the new layout.
- **SC-002**: The full suite and guard pass, and the next release publishes every surface (npm, PyPI, GHCR, MCPB, extension ZIP, Homebrew, catalog reminder).

## Out of Scope

- Changing how npm is published: `publish-npm` keeps `id-token: write` (Trusted Publishing and provenance need it) and runs `npm publish`, whose `prepublishOnly` runs the CLI's `--version`. It holds no repository write permission.
- `publish-homebrew` keeps its deploy key, scoped to `raccioly/homebrew-tap`.
