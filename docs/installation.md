---
title: Installation
nav_order: 3
---

# Installation

DocGuard is a Node.js command-line tool. It is published as **`docguard-cli`**
on npm and PyPI, and the command it installs is **`docguard`**. Every channel on
this page runs the same CLI. They differ in how it reaches your machine and how
its version is pinned.

In the examples, replace `X.Y.Z` with a release version. To find the latest one,
run `npm view docguard-cli version` or open the
[releases page](https://github.com/raccioly/docguard/releases).

## Choose a channel

| Channel | Command | Needs | Use it for |
|---|---|---|---|
| [npx](#run-with-npx) | `npx docguard-cli@X.Y.Z guard` | Node.js | Trying it, one-off runs, CI |
| [npm, global](#install-globally-with-npm) | `npm i -g docguard-cli` | Node.js | Daily use on your machine |
| [npm, project](#add-it-to-a-project-with-npm) | `npm i -D -E docguard-cli@X.Y.Z` | Node.js | A version pinned in the repository |
| [PyPI](#pypi-pip-pipx-uv) | `pipx install docguard-cli` | Python 3.8+ **and** Node.js | Python-first toolchains |
| [Homebrew](#homebrew) | `brew install raccioly/tap/docguard` | Homebrew | macOS and Linux workstations |
| [Docker](#docker-ghcr) | `docker run -i --rm -v "$PWD":/workspace ghcr.io/raccioly/docguard:X.Y.Z` | Docker | The MCP server without a local Node.js |
| [GitHub Action](#github-action) | `uses: raccioly/docguard@vX.Y.Z` | GitHub Actions | Pull request gates |
| [pre-commit](#pre-commit-framework) | `repo: https://github.com/raccioly/docguard` | pre-commit | Commit and push hooks |
| [Spec Kit extension](#spec-kit-extension) | `docguard init` | Spec Kit 0.11.2+ | Spec Kit projects |
| [Claude Desktop](#claude-desktop-mcpb-bundle) | `docguard-vX.Y.Z.mcpb` | Claude Desktop | Using the MCP tools in Claude Desktop |
| [Offline](#offline-and-air-gapped-use) | pre-filled npm cache | Node.js | Machines with no registry access |

## Requirements

| Requirement | Needed for | Without it |
|---|---|---|
| **Node.js 18 or later** | Everything. `package.json` declares `"engines": { "node": ">=18.0.0" }`. Releases are tested on Node.js 18, 20, 22 and 24. | Nothing runs. The PyPI wrapper and the Homebrew formula still need Node.js. |
| `git` | Checks and commands that read history: freshness, `diff --since`, `specs require`, `specs complete`, `reconcile`. | DocGuard treats the project as having no Git history, and those checks do not run. In CI, clone with full history (`fetch-depth: 0`). |
| `python3` (or `python`) | Reading Python projects with Python's own syntax tree. | Python routes, models and settings are read by a pattern fallback. Results are marked partial (`parserTier`, `confidence: low`). See [Languages and Frameworks](reference/languages.md). |
| `@babel/parser` | Reading JavaScript and TypeScript with a syntax tree. It is DocGuard's only runtime dependency, pinned to an exact version and installed with the package. | The CLI still starts. JavaScript and TypeScript fall back to the regex tier. This only happens when the dependency is missing, for example when you run an unpacked tarball. |

DocGuard runs no install scripts, so `npm i -g docguard-cli --ignore-scripts`
behaves the same as a plain install.

### Network use

Validation runs locally and makes no network calls. You need the network only
to download DocGuard, and for the few commands that use it at your request:
`docguard upgrade`, `upgrade --pr`, `impact --prs` and `feedback`. The full list
is in [PRIVACY.md](https://github.com/raccioly/docguard/blob/main/PRIVACY.md).

## npm

### Run with npx

```bash
npx docguard-cli@X.Y.Z demo        # sample project, no setup
npx docguard-cli@X.Y.Z diagnose    # your project
```

Without a version, npx uses the copy installed in the project if there is one.
Otherwise it resolves the package from the registry. Pin a version wherever the
result must be reproducible, such as CI, scripts and agent configuration.

### Install globally with npm

```bash
npm install -g docguard-cli
docguard --version
```

### Add it to a project with npm

This pins the version in `package.json` and the lockfile, so every contributor
and CI job runs the same release:

```bash
npm install --save-dev --save-exact docguard-cli@X.Y.Z
```

Then call it from npm scripts:

```json
{
  "scripts": {
    "guard": "docguard guard",
    "score": "docguard score",
    "lint:docs": "docguard ci --threshold 70"
  }
}
```

`npx docguard <command>` also runs the project's copy.

## PyPI (pip, pipx, uv)

```bash
pipx install docguard-cli          # isolated, recommended
uv tool install docguard-cli       # or with uv
pip install docguard-cli           # or into the current environment

uvx --from docguard-cli docguard --version   # run once without installing
```

The PyPI package is a thin Python wrapper (`docguard_cli/wrapper.py`). It
contains no copy of DocGuard and has no Python dependencies. The `docguard`
command it installs:

1. Looks for Node.js 18 or later on `PATH` (`node`, `node18`, `node20`,
   `node22`). If none is found, it prints how to install Node.js and exits 1.
2. Looks for `node_modules/docguard-cli/cli/docguard.mjs` in the current
   directory and each parent. If found, it runs that copy with `node`. This copy
   is pinned by the project and works offline.
3. Otherwise runs `npx -y docguard-cli@latest`, forwarding every argument and
   the exit code.

The PyPI version does not pin the CLI version. Outside a project that has
`docguard-cli` in `node_modules`, the wrapper always runs the latest npm
release, and the first run needs the network. To pin, add `docguard-cli` to the
project with npm ([above](#add-it-to-a-project-with-npm)). The wrapper then runs
that copy.

## Homebrew

```bash
brew install raccioly/tap/docguard
docguard --version
```

The formula lives in the `raccioly/homebrew-tap` repository. It installs the
npm package from the npm registry, pinned by SHA-256, and depends on
Homebrew's `node`. The release workflow updates it after each npm publish,
from the published tarball, and checks that tarball against npm's recorded
integrity first. Its source template is
[`packaging/homebrew/docguard.rb`](https://github.com/raccioly/docguard/blob/main/packaging/homebrew/docguard.rb).

## Docker (GHCR)

The container image runs the **MCP server**. It needs no local Node.js and is
public, so pulling it needs no authentication.

```bash
docker run -i --rm -v "$PWD":/workspace ghcr.io/raccioly/docguard:X.Y.Z
```

| Property | Value |
|---|---|
| Image | `ghcr.io/raccioly/docguard` |
| Tags | The bare version (`0.43.1`, no `v`) and `latest`. Pin a version. |
| Platform | `linux/amd64` only. On an arm64 host, Docker needs amd64 emulation (`--platform linux/amd64`). |
| Base | `node:20-alpine` |
| Entrypoint | `node /app/cli/docguard.mjs mcp`: the stdio MCP transport. stdout is the JSON-RPC channel, so send nothing else to it. |
| Working directory | `/workspace`. Mount the project there. |
| Writes | None. The server is read-only. |
| Not included | `git` and `python3`. History-based checks do not run, and Python is read by the pattern fallback. |

Tools inspect `/workspace` by default. A `projectDir` passed in a tool call must
be `/workspace` or a directory inside it. To serve another mounted tree, add
`--root <dir>` after the image name. See the [MCP Server](reference/mcp.md)
reference for the tools and client setup.

The image is built for the MCP server. You can run another command by replacing
the entrypoint, with the limitations in the table above:

```bash
docker run --rm -v "$PWD":/workspace --entrypoint node \
  ghcr.io/raccioly/docguard:X.Y.Z /app/cli/docguard.mjs guard
```

For CI, prefer [npx or the GitHub Action](guides/ci.md). Both run with `git`
available.

To build the image yourself from a checkout, run
`docker build -t docguard-mcp .` using the repository's `Dockerfile`.

## GitHub Action

```yaml
- uses: actions/checkout@v4
  with: { fetch-depth: 0 }
- uses: raccioly/docguard@vX.Y.Z
  with:
    command: guard
```

The action installs the `docguard-cli` version it was released with, so pinning
the action also pins the CLI. Its inputs, outputs, pull request feedback and
the spec-first gate are covered in [Continuous Integration](guides/ci.md).

## pre-commit framework

The repository is a [pre-commit](https://pre-commit.com) hook source
(`.pre-commit-hooks.yaml`):

```yaml
repos:
  - repo: https://github.com/raccioly/docguard
    rev: vX.Y.Z
    hooks:
      - id: docguard-guard        # guard --changed-only on each commit
      - id: docguard-guard-full   # full guard on push
```

`docguard-guard-full` runs at the `pre-push` stage. It needs pre-commit 3.2 or
later, and the push hook installed once per clone with
`pre-commit install --hook-type pre-push`.

To install plain Git hooks without the pre-commit framework, use
`docguard init --with hooks`.

## Spec Kit extension

DocGuard ships a [Spec Kit](https://github.com/github/spec-kit) extension. It
adds the `speckit.docguard.*` commands and the workflow hooks. It requires Spec
Kit 0.11.2 or later, and `node` and `npx` on `PATH`.

**Recommended: let `docguard init` register it.** With the `specify` CLI on
`PATH`, `docguard init` initializes Spec Kit for your coding agent and
registers the extension copy that ships inside the installed npm package. That
copy is always the same version as your CLI.

```bash
npm install -g docguard-cli
docguard init
```

**To register it yourself**, install from the release archive or from a local
copy:

```bash
# From the GitHub release (Spec Kit asks you to confirm the external source)
specify extension add docguard --from \
  https://github.com/raccioly/docguard/releases/download/vX.Y.Z/spec-kit-docguard-vX.Y.Z.zip

# From the npm package already in the project
specify extension add ./node_modules/docguard-cli/extensions/spec-kit-docguard --dev
```

`specify extension add docguard` without `--from` does not install DocGuard on
a default Spec Kit setup. DocGuard is listed in Spec Kit's community catalog,
which Spec Kit treats as discovery only. Spec Kit refuses to install from it
and suggests `--from <archive-url>`. The catalog entry is also updated by hand
after each release and can lag behind npm.

The [Spec Kit guide](guides/spec-kit.md) covers what the extension adds and how
to use it.

## Claude Desktop (MCPB bundle)

Each GitHub release includes a Claude Desktop extension bundle,
`docguard-vX.Y.Z.mcpb`.

1. Download it from the
   [latest release](https://github.com/raccioly/docguard/releases/latest).
2. In Claude Desktop, open **Settings → Extensions** and drag the file in.
3. Choose the project folder DocGuard should analyze when asked.

The bundle contains the npm package and its one production dependency, so
nothing is downloaded from npm. Its tools are read-only. A tool call may pass a
`projectDir` inside the chosen folder, and folders outside it are refused. The
bundle does not update itself; to upgrade, install the bundle from a newer
release.

For Claude Code, Cursor and other MCP clients, register the server with a
command instead, for example
`claude mcp add docguard -- npx -y docguard-cli@X.Y.Z mcp`. See
[MCP Server](reference/mcp.md) and [AI Integration](ai-integration.md).

## Offline and air-gapped use

Validation never uses the network, so DocGuard works offline once it is
installed. Only the install step needs a way in. Choose one of these:

**Pre-filled npm cache (complete install).** On a connected machine, install
once into a dedicated cache. Then copy the cache directory to the offline
machine and install from it:

```bash
# connected machine
npm install -g --cache ./docguard-npm-cache docguard-cli@X.Y.Z

# offline machine, after copying ./docguard-npm-cache
npm install -g --offline --cache ./docguard-npm-cache docguard-cli@X.Y.Z
docguard --version
```

**Project-local copy.** Install into a directory with
`npm install --prefix ./docguard-offline docguard-cli@X.Y.Z` and copy that
directory. Run `./docguard-offline/node_modules/.bin/docguard`.

**Bare `npm pack` tarball (reduced tier).** `npm pack docguard-cli@X.Y.Z`
produces `docguard-cli-X.Y.Z.tgz`. Unpacked, it runs with
`node package/cli/docguard.mjs`. The tarball does not include `@babel/parser`,
so JavaScript and TypeScript are read by the regex fallback. Installing the
tarball with `npm install` offline fails, because npm must resolve
`@babel/parser` and its own dependencies. Use the npm cache method for a
complete offline install.

Other channels:

- **PyPI wrapper**: runs offline only when the project has `docguard-cli` in
  `node_modules`. Otherwise it calls `npx docguard-cli@latest`, which needs
  the registry.
- **Docker**: move the image with `docker save` and `docker load`.

Guard's text output, the MCP server and the context pack say so when your
release is more than 14 days old. This note makes no network call. DocGuard
compares the release date in its bundled `CHANGELOG.md` with your clock. Set
`DOCGUARD_NO_UPDATE_HINT=1` to turn it off.

## Verify the installation

```bash
docguard --version     # prints the installed version
docguard demo          # runs guard against a built-in sample project
```

`demo` runs in a temporary directory and removes it afterwards. It writes
nothing to your project.

## Upgrading

Upgrade through the channel you installed with:

| Channel | Command |
|---|---|
| npm, global | `npm install -g docguard-cli@latest` |
| npm, project | `npm install --save-dev --save-exact docguard-cli@X.Y.Z` |
| npx | Change the pinned version in your scripts or CI |
| pipx / uv / pip | `pipx upgrade docguard-cli` / `uv tool upgrade docguard-cli` / `pip install --upgrade docguard-cli`. This updates only the wrapper; see [PyPI](#pypi-pip-pipx-uv) for which CLI it runs. |
| Homebrew | `brew upgrade docguard` |
| Docker | Pull and run the new tag |
| GitHub Action / pre-commit | Change `@vX.Y.Z` / `rev:` |
| Spec Kit extension | `docguard upgrade --apply` or `docguard init` re-registers it when its version differs from the CLI's |
| Claude Desktop | Install the `.mcpb` from the newer release |

`docguard upgrade` reports whether a newer CLI exists. It contacts the npm
registry. It also reports whether `.docguard.json` or the installed agent files
are behind. `docguard upgrade --apply` runs `npm install -g docguard-cli@latest`,
migrates the configuration and refreshes agent files. Use `--apply` for a
global npm install. For other channels, upgrade the CLI as shown above, then run
`docguard upgrade --apply` to migrate the project. See
[Upgrading](guides/upgrading.md) for release notes, baselines and
configuration migration.

## Uninstalling

| Channel | Command |
|---|---|
| npm, global | `npm uninstall -g docguard-cli` |
| npm, project | `npm uninstall docguard-cli` |
| pipx / uv / pip | `pipx uninstall docguard-cli` / `uv tool uninstall docguard-cli` / `pip uninstall docguard-cli` |
| Homebrew | `brew uninstall docguard`, then `brew untap raccioly/tap` if nothing else uses the tap |
| Docker | `docker rmi ghcr.io/raccioly/docguard:X.Y.Z` |
| Spec Kit extension | `specify extension remove docguard` |
| Claude Desktop | Remove the extension in **Settings → Extensions** |

Removing the CLI leaves your project files alone. They are plain files in your
repository; delete the ones you no longer want:

- `.docguard.json`: configuration, written by `docguard init`.
- `.docguard/`: local state, such as fix history, score history and caches.
- `.docguard.baseline.json`: written by `guard --update-baseline`.
- `.docguard-specs.json`: the spec registry, written by `specs --write`.
- Agent skills and commands that `init` installed. Their paths are listed in
  [Coding Agents](reference/agents.md).
- Git hooks from `docguard init --with hooks`. Remove DocGuard's part with
  `docguard hooks --remove`, which keeps any other commands in those hooks.

## Supply chain

| Artifact | Built by | Verification |
|---|---|---|
| npm package | `release.yml`, `publish-npm` job, with npm Trusted Publishing (OIDC) | npm provenance attestation, generated automatically on publish. Check it with `npm audit signatures` in a project that installs it. |
| PyPI package | `release.yml`, `publish-pypi` job, with PyPI Trusted Publishing (OIDC) | PyPI attestations published by the publishing action. |
| Homebrew formula | `release.yml`, `publish-homebrew` job | Built from the published npm tarball after checking npm's `dist.integrity`. The formula pins its SHA-256. |
| GHCR image | `release.yml`, `publish-ghcr` job, with the Docker CLI | The job checks that the image answers an MCP `initialize` before it pushes. The image is not signed and has no attestation. |
| Spec Kit ZIP, MCPB bundle | `release.yml`, `build-extension` and `build-mcpb` jobs | Attached to the GitHub release. No checksum file or attestation is published for them. |
| GitHub Action | `action.yml` at the release tag | The actions it uses are pinned to commit SHAs. Pin `raccioly/docguard` to a reviewed tag or commit. |

The npm and PyPI jobs authenticate with OIDC; no long-lived registry token is
stored. DocGuard has one runtime dependency, `@babel/parser`, pinned to an
exact version.
