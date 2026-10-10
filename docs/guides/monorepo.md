---
title: Monorepos
parent: Guides
nav_order: 4
---

# Monorepos

DocGuard checks one project directory per run. In a repository with several
packages, you choose what that directory is: the repository root, with one set
of documents for everything, or each package, with its own configuration and
documents. This guide covers both, how DocGuard picks the directory, and what
it does not do.

## How DocGuard picks the project directory

Every command works on the current directory, or on the directory you pass with
`--dir`:

```bash
docguard guard                      # the current directory
docguard guard --dir packages/api   # an explicit directory
```

From that directory DocGuard reads `.docguard.json`, `.docguardignore`, the
canonical documents and the baseline. It never changes the directory on its
own.

### Ancestor-root guidance

If you run a command inside a package that has no `.docguard.json` of its own,
DocGuard checks whether a parent directory governs it. It walks up (at most 32
levels, and never past the Git repository root) looking for either of these:

- a `.docguard.json`;
- a workspace declaration that lists the package: `workspaces` in
  `package.json`, or `packages` in `pnpm-workspace.yaml`.

When it finds one, it still checks the directory you are in, and prints on
stderr how to check the whole repository instead:

```text
DocGuard is checking /repo/packages/api.
/repo appears to govern this package via package.json#workspaces; the scan scope was not changed.
Re-run for repository scope: docguard guard --dir /repo
```

With `--format json`, `sarif` or `junit`, stdout is unchanged and stays valid.
Stderr gets one JSON line of type `docguard.repository-root-guidance`, with the
selected directory, the suggested one, the reason and the rerun command.

The guidance does not appear when:

- the current directory has its own `.docguard.json`;
- you passed `--dir` (any explicit path counts, including `--dir .`);
- the workspace patterns do not match the package;
- a nested Git repository sits between the package and the ancestor.

## Layout 1: one project at the repository root

Use this when the repository has one architecture and one set of documents, and
the packages are parts of one system.

```text
repo/
├── .docguard.json
├── docs-canonical/
├── package.json            # "workspaces": ["packages/*"]
└── packages/
    ├── api/
    └── web/
```

Run `docguard init` and every other command from the root.

### Where DocGuard looks for code

Routes, environment variables, data models, dependencies and test files are
collected from these source roots, in order:

1. `sourceRoot` in `.docguard.json`, if set;
2. each workspace package from `package.json` `workspaces` (an array, or an
   object with `packages`) and from `pnpm-workspace.yaml`;
3. the conventional directories that exist: `src`, `app`, `lib`, `server`,
   `api`, `functions`, `backend/src`, `backend`, `cli` (and `pages`,
   `components`, `hooks`, `utils` in a Next.js project).

The repository root itself is scanned only when none of these exist.

```json
{ "sourceRoot": "services/backend/src" }
```

> **Note:** The CLI also accepts an array for `sourceRoot`, but the published
> JSON schema declares a string. An editor that validates `.docguard.json`
> against the schema flags an array.

### Project type

Type detection reads the manifest at the root only. A workspace root whose own
`package.json` names no framework is typed `unknown`. That type assumes the
project needs documented environment variables, an `.env.example` and a data
model, which may not match your repository.

`init` writes both `projectType` and the `projectTypeConfig` flags derived from
it, and the flags in the file win. Edit both:

```json
{
  "projectType": "api",
  "projectTypeConfig": {
    "needsEnvVars": true,
    "needsEnvExample": true,
    "needsE2E": false,
    "needsDatabase": true
  }
}
```

Valid types are `cli`, `library`, `webapp`, `api` and `unknown`. The flags each
type implies are listed in [Configuration](../configuration.md), under "Project
Type Defaults".

### Where DocGuard looks for documents

- `docs-canonical/` at the root, including its subdirectories.
- Conventional documentation directories **at the root only**: `docs`, `doc`,
  `documentation`, `docs-canonical`, `docs-implementation`, `guides`, `guide`,
  `handbook`, `manual`, `wiki`, `extensions`, and `website/docs`.
- Documents mapped with `docs.roles`.

A package's own `packages/api/docs/` is not found automatically. The guard
summary counts it as "outside any tier". Add it with `docs.dirs`:

```json
{ "docs": { "dirs": ["packages/api/docs", "packages/web/docs"] } }
```

`docs.dirs` adds directories to the inventory and to freshness review. It does
not make them canonical documents. A canonical role (`architecture`,
`dataModel`, …) maps to one file for the whole project, through `docs.roles`.
If each package needs its own architecture document checked as canonical, use
layout 2.

### Agent instructions in packages

Nested `AGENTS.md` files work as a chain from the root down to each directory.
STR004 reports a chain over the byte budget (32 KiB by default, Codex's limit).
To freeze existing debt in one package, key an allowance by the deepest file in
its chain:

```json
{
  "agentInstructions": {
    "allowances": { "packages/big/AGENTS.md": 40000 }
  }
}
```

### Leaving a package out

List it in `.docguardignore` at the root:

```text
packages/legacy/
```

A `dir/` pattern matches that directory at any depth, as in `.gitignore`.

## Layout 2: each package is its own project

Use this when packages are owned by different teams, released separately, or
need their own canonical documents.

```text
repo/
└── packages/
    ├── api/
    │   ├── .docguard.json
    │   └── docs-canonical/
    └── web/
        ├── .docguard.json
        └── docs-canonical/
```

Adopt each package on its own, following
[Existing Projects](existing-projects.md):

```bash
docguard init --dir packages/api
docguard guard --dir packages/api
```

Each package keeps its own `.docguard.json`, documents, `.docguard.baseline.json`
and `.docguard/` state directory. Git-based checks still work, because Git
metadata is found in an ancestor directory.

> **Note:** A run at the root does not read the packages' `.docguard.json`
> files or their `docs-canonical/` directories, and does not combine their
> results. Run each package separately.

Mapped document roles cannot point outside the package: `docs.roles` rejects
absolute paths and parent traversal (`../`).

Both layouts can coexist. A root project for repository-wide documents and a
project per package are separate runs.

## CI per package

### GitHub Actions

Give each package its own job and set `working-directory`:

```yaml
name: DocGuard
on: [pull_request]
permissions: { contents: read }
jobs:
  docguard-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: raccioly/docguard@v0.43.1
        with:
          command: guard
          working-directory: packages/api
          pr-comment: 'false'
  docguard-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: raccioly/docguard@v0.43.1
        with:
          command: guard
          working-directory: packages/web
          pr-comment: 'false'
```

Set `pr-comment: 'false'` when more than one job runs the action on the same
pull request. The sticky comment is found by a fixed marker, so each job would
overwrite the last one's comment. Inline annotations still work: the action
rewrites finding paths to be relative to the repository root.

A matrix over package directories works the same way, with the package path in
`working-directory`.

### Other CI systems

Loop over the packages and fail on errors (exit `1`), not on warnings (exit
`2`):

```bash
failed=0
for dir in packages/api packages/web; do
  docguard ci --dir "$dir"
  [ $? -eq 1 ] && failed=1
done
exit "$failed"
```

More CI recipes are in [CI](ci.md).

## The MCP server in a monorepo

`docguard mcp` serves one directory, and a tool call's `projectDir` must sit
inside it. Started at the repository root, it can answer for any package.
Started inside a package, it refuses other packages unless you add
`--root <dir>` for each extra tree. See [MCP](../reference/mcp.md).

## What is not supported

- **A single run that finds and combines per-package projects.** Run each
  package with `--dir`, or in its own CI job.
- **Workspace declarations other than `package.json` `workspaces` and
  `pnpm-workspace.yaml`.** Nx project files, `lerna.json` package lists, Rush,
  Cargo and Go workspaces, and Maven or Gradle multi-module builds do not add
  source roots, and do not trigger ancestor-root guidance. Set `sourceRoot` or
  rely on the conventional directories, or use layout 2.
- **Checking only the packages a change touched.** DocGuard has no
  changed-package detection. Use your CI's path filters to decide which
  package jobs run. Inside one package, `guard --changed-only` limits the run
  to changed files.
- **Conventional documentation directories inside packages, at a root run.**
  Add them with `docs.dirs`.
