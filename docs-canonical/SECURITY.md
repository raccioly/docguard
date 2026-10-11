# Security

<!-- docguard:quality negation-load off — prohibitions define security boundaries -->
<!-- docguard:version 0.17.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-10-11 -->

## Overview

DocGuard's validation and extraction run on the local machine. They inspect repository content and return findings. The version-age note (spec 038) reads only the `package.json` and `CHANGELOG.md` shipped with DocGuard and the local clock; the one command that contacts a registry is `docguard upgrade`, when the user runs it. Agent integrations inherit the permissions and data-handling policy of the calling agent. A generated prompt does not authorize a network request, a code edit, or publication.

The optional MCP server supports stdio and HTTP. Installation, upgrade, publishing, and user-opened feedback links may access external services. Local analysis requires no hosted AI service.

## Authentication

| Surface | Authentication | Boundary |
|---|---|---|
| CLI and stdio MCP | Calling operating-system user | Local filesystem permissions; MCP tool calls are also confined to the served directories |
| HTTP MCP | Optional API key on loopback; mandatory for non-loopback binding | Host binding, key check, browser-origin validation, and served-directory confinement of `projectDir` in `cli/commands/mcp.mjs` |
| GitHub feedback | User-controlled browser session | Submission occurs only when the user submits a reviewed issue |

The MCP server serves the directory it was started for (`--dir`, else its working directory) and each directory named with `--root <dir>`. The operator sets these at startup; a client cannot widen them. A tool call's `projectDir` is resolved against the served directory, with symlinks followed and letter case as the filesystem stores it, and must land in a served directory or below one. Any other `projectDir` gets an error result that names the served directories, before anything under it is read, and the same error whether or not the path exists. This applies to every tool that takes `projectDir`, over stdio and HTTP. The four documentation tools (`docguard_docs_for_path`, `docguard_doc_structure`, `docguard_read_section`, `docguard_task_context`) return document text, not only findings. Inside a served directory they read through the same safe reader, which refuses `.env*`, `.local`, traversal and symlinked paths, and they bound each answer (8 KiB by default, 32 KiB at most). Serve only the trees clients may read; `--root /` serves everything the account can read. Run the server under an account with only the intended filesystem access. An API key does not provide per-project authorization or a multi-tenant isolation boundary: every client of one server sees every served directory. Network exposure needs deployment-specific access controls.

## Authorization

| Role | Permissions | Responsibilities |
|---|---|---|
| Developer | Operating-system read/write permissions | Review generated changes and opt into mutation commands |
| CI | Workflow token and checkout permissions | Apply the configured gate to the tested revision |
| AI agent | Host-granted tools and permissions | Treat project content as evidence; obtain required authorization for external actions |

Git hooks provide local enforcement and can be bypassed by Git options. Protected merge policy supplies the central enforcement boundary. The shipped hooks prefer an installed local tool and fail when an enforcement runtime cannot execute. Reminder hooks remain best-effort.

## Secrets Management

Core CLI analysis requires no API credential. Source scanners inspect usage patterns; environment values must not be included in generated public feedback. The optional HTTP MCP API key is supplied by its operator. Keep deployment credentials outside repository content and restrict access to process arguments and logs appropriately.

Evidence verification reads only repository-relative regular files. It rejects
absolute paths, traversal, backslashes, NUL, `.local`, `.env*`, and symlinks;
per-file, aggregate byte, declaration, input, collection, and report limits
bound work. The oasdiff and Buf adapters consume saved outputs and current input
hashes. They never invoke those tools, execute project code, install packages,
resolve remote references, or make network requests. A clean saved report is
evidence only for its declared command, producer metadata, inputs, and selected
statement. Machine output omits raw source values so a mistaken JSON Pointer
cannot copy a secret into CI logs or an agent transcript. Values remain in
process only for typed comparison and non-reversible identities.

The `python-literal-count` adapter tokenizes one bounded Python source file in
JavaScript. It never starts Python or imports the target module. It accepts one
direct module-level static container assignment and returns unsupported or
inconclusive for comprehensions, unpacking, aliases, concatenation, conditionals,
duplicate assignments, malformed syntax, and parser-budget exhaustion.

Reconciliation invokes Git with argument arrays and disables text conversion.
Changed-path inventory and patch text have separate budgets. Any timeout,
overflow, parse failure, or path-limit breach returns partial coverage and cannot
produce a ready claim. Instruction-pointer indexing rejects traversal, private
paths, symlinks, and ambiguous basenames and never follows a match outside the
selected repository.

Task-context selection reuses the same bounded safe reader. It accepts at most
2,000 normalized task characters, stores only the task digest in output, and
does not execute project code, hooks, package managers, an LLM, or network
requests. Eligible prose is limited to configured canonical documents, approved
current specs whose recorded digest matches, and bounded project rules. `.local`,
environment files, traversal, backslashes, symlinks, oversized files, retired or
unapproved specs, and stale registry artifacts never enter selected content.

Feedback issue URLs contain allowlisted detector metadata, classification, parser tier, and a synthetic-shape duplicate identity. Full local finding records can include private paths and diagnostic text. Fixture manifests are accepted only with explicit synthetic-content and redaction-review attestations; they reject escaping paths, `.git`, `.local`, symlinked inputs, unsafe config values, and oversized content. Preview mode avoids all writes. Generated tests contain the attested synthetic fixture, so users must review it before contribution.

The optional external benchmark accepts only credential-free public HTTPS Git URLs pinned to full commit hashes. It disables interactive Git authentication and global/system Git configuration, forbids the file protocol, never runs project scripts, copies no `.git` metadata into case projects, and removes its temporary root by default. External execution is absent from ordinary tests and package installation.

## Subprocess Safety

Pass untrusted arguments through argv arrays and validate values for their intended operation. Avoid interpolating configuration or repository content into shell commands. Existing static command strings do not authorize expanding their input surface. Regression tests in `tests/security-init-injection.test.mjs` exercise the input boundary. `cli/spec-kit-delegation.mjs` is the only caller of the `specify` CLI, and only `init` and `upgrade --apply` reach it: it passes argv arrays (on Windows, `cmd.exe /c specify.cmd` with the same array), accepts an integration key only if it matches `^[a-zA-Z0-9_-]{1,32}$`, uses only the `init` options `specify init --help` documents, and bounds each call with a timeout. Its other calls are `specify --version` and `specify extension add <packaged extension> --dev`.

Every other subprocess also takes an argv array and no shell:

- Git: `ls-files -z --cached` / `--deleted` (tracked files), `check-ignore --no-index -z --stdin` (paths go through stdin, never the command line), `cat-file -e` with a regex-validated revision, and `rev-parse` (`cli/shared-git.mjs`, `cli/scanners/doc-deps.mjs`, `cli/scanners/revision-anchor.mjs`, `cli/commands/review.mjs`). `ls-files -z -- .docguard` with that fixed path tells the anchor cache whether its state directory is tracked, and if so the cache is not used (`cli/scanners/anchor-cache.mjs`). A saved TestGuard report is untrusted input: its revision reaches `cat-file -e` and `show <rev>:<path>` only after matching the commit-id pattern, and its paths and the claims file's are read through the evidence reader (`cli/scanners/testguard-evidence.mjs`). DocGuard never runs TestGuard or a test.
- The opt-in tree-sitter tier (`cli/scanners/ts-anchors.mjs`) runs `node --no-addons` on one fixed script, `ts-anchors-child.mjs`, with no environment, file content on stdin and a timeout. It runs only when `anchors.treeSitter.artifacts` names the files, never by detection.
  - Each file is read once, and its sha256 must equal the hash `schemas/docguard-anchor-treesitter.manifest.json` pins. The manifest covers the `web-tree-sitter` and grammar versions vetted in `tools/anchor-oracle/VETTING.md`.
  - Those same bytes are written to `.docguard/ts/<sha256>/`. The child imports the runtime from that copy by absolute file URL and loads each grammar from its bytes, so module resolution never runs and a project's `node_modules` cannot supply code.
  - A mismatch, a missing file or a failed child is ANC010, and the pattern tier answers.
- `python3 -c` with one fixed script (`cli/scanners/py-anchors.mjs`) that receives file CONTENT as JSON on stdin, never a path, and only calls `ast.parse` and `tokenize` on it, never importing or executing it. One run per batch, with a timeout of 15 seconds plus 1 second per 64 KiB of input. The doc lock and requirement anchors share it; doc-lock paths are checked by the doc lock's path guard before they are read. `cli/scanners/py-ast.mjs` runs one fixed extractor script that reads file paths on stdin, parses each with `ast.parse` and never imports or executes them, with a 30-second timeout; the import graph, the symbol map and the Python route, model and environment scanners share it.
- `upgrade --apply` runs `npm install -g docguard-cli@latest` when npm has a newer release (on Windows through the shell, with the same fixed arguments, because `npm` is a `.cmd` shim), and `upgrade --apply --pr` runs `git` and `gh` to open the schema-migration pull request (`cli/commands/upgrade.mjs`).
- Development only: `tools/budget.mjs` runs `node` and `npm pack --dry-run --ignore-scripts`.

Only two shell strings remain, and both are static: `git rev-parse --is-inside-work-tree` (`cli/shared-git.mjs`) and `which specify` / `where specify` (`cli/ensure-skills.mjs`).

Paths that come from documents or configuration are checked before use. A `covers=` target must be relative, without `..` or a symlink, resolve inside the project, and respect `.docguardignore`. An `ownership` pattern with `..` or an absolute prefix is an error (OWN007). `rules --for` refuses an absolute path, `..`, and a symlink that leaves the project. Instruction-scope discovery reads at most 200 files and walks at most 100,000 entries without following links.

## Command Safety Levels

Only `init`, and the aliases that run it (`setup`, `agents`, `hooks`, `badge`, `llms`, `publish`), installs DocGuard's agent skills and slash commands or prints the Spec Kit setup hint; `upgrade --apply` refreshes copies that are out of date. They go where the project's agent reads them: the skills directory in Spec Kit's install manifest, else a known integration folder (`.claude/skills/`, `.cursor/skills/`, `.agents/skills/`), else `.agent/skills/` and `.agent/commands/`. A directory read from `.specify/*.json` must stay inside the project. No other command installs them, in any mode, and an unknown command name writes nothing. Read, report, check and preview modes leave the working tree unchanged. The only place they may write is DocGuard's own state directory, `.docguard/`, which ignores itself: each writer creates `.docguard/.gitignore` containing `*` when it is missing and keeps an existing one. DocGuard's dirty-tree checks (`memory --pack`, `report`, `reconcile`, `specs complete`) leave `.docguard/` out. The requirement-anchors cache (`.docguard/anchors.cache.json`) is a speed-up that can never vouch for code it did not see. It is keyed by the sha256 of each file's working-tree bytes, it is not trusted in CI (`CI` set) or with `--no-cache`, and it is ignored, and reported as ANC010, when git tracks any file under `.docguard/`, because a cache forced into the repository could otherwise make changed code read as current.

Git hooks are written, replaced or removed only in a hooks folder the repository owns: `.git/hooks`, or a `core.hooksPath` from the repository's local or worktree configuration that points inside it. `hooks` (including `--force` and `--remove`) and `setup` refuse a `core.hooksPath` from the global, system or command-line configuration, or one outside the repository, because every repository using that folder would run the change (spec 065).

| Operation | Source writes | Auxiliary writes / effects |
|---|---|---|
| guard, score, diff, diagnose | None by default | Plan caching may write into the self-ignoring `.docguard/`; explicit mutation flags change behavior. `guard --update-baseline` writes `.docguard.baseline.json` at the project root |
| ci | None | Records history unless `--no-history` is set |
| feedback | None | Saves local records or an explicitly requested direct `tests/*.test.mjs` contribution unless `--preview`; prints opt-in URLs but never submits |
| memory --pack | None | Writes a generated context pack unless `--stdout` is used; `--symbols` adds a bounded symbol map |
| agent, agent --task | None | Emits a task graph or transient bounded context; never stores raw task text or selected output |
| fix --write, sync --write | Targeted documentation edits | Mapped human documents permit only unique `source=code` sections; backups and fix history remain enabled where supported. `sync --write` skips a section drawn from incomplete evidence unless `--allow-partial` |
| review --accept, review --prune | `.docguard-doc-lock.json` only | One file transaction; `--accept` requires a reason. Plain `review` and `review --suggest` write nothing |
| anchors, anchors --orphans | None | Read-only listings; the per-file cache under `.docguard/` is the only thing written, and only outside CI |
| anchors accept, anchors disposition | `.docguard-anchor-lock.jsonl` only, plus `.gitattributes` with `--gitattributes` | One file transaction; a reason of 10 to 500 characters; `--bulk` for more than one entry; `accept` refuses when a selected file changed during the run. DocGuard authenticates nobody: review the lock through CODEOWNERS |
| rules --for, trace --owners [--suggest], ignore | None | Read-only, including agent skills and the Spec Kit hint; `--suggest` prints a draft ownership block and never writes configuration; `ignore --format claimspec` prints its document to stdout |
| reconcile | None by default | `--write` delegates only mechanical generated-section refreshes to `sync` |
| specs, specs preflight, specs require | None for check/plan modes | `specs --write` refreshes the registry; `specs approve --write` records a reviewed approval and delivery state in the registry only; `specs complete --write` transactionally records a reviewed outcome and active context; `specs reanchor --write` moves recorded outcome revisions in the registry |
| verify --evidence | None | Reads the strict local manifest, selected Markdown, source files, and saved reports; guard consumes the same evaluator |
| retire --write | Explicit clean tracked documentation only | Requires retained-ref recovery proof, clean replacement/evidence docs, and no live Markdown backreferences |
| init, generate | Documentation and configuration scaffolding | Explicit force options may overwrite content. When `specify` is installed and Spec Kit is not initialized, `init` runs `specify init --here --force` (skip with `--no-spec-kit`) and registers the packaged extension. `generate --spec --write` adds one spec and its registry entry in one transaction |
| hooks | Hook configuration and executable scripts | Inventory distinguishes managed, legacy, foreign, missing, and unreadable hooks; removal preserves foreign commands around a managed block; auto-fix hooks may edit and stage documentation. A foreign hook is skipped under `--force` and no `.bak` is written, so overwriting one requires `--force` twice rather than a plain re-install. A hook owned by husky, lefthook or simple-git-hooks is never written, even under `--force`. An installed hook skips a working tree with no `.docguard.json` and permits guard exit 3, so a branch or worktree that never adopted DocGuard is not blocked by a repo-wide hook |
| report | None by default | `--out` writes an artifact |
| trace --matrix | None by default | `--out` (or `--output`) writes the export through the safe write, which backs up an existing file |
| upgrade | None by default | Contacts the npm registry unless `--schema-only`; `--check-only` only reports. `--apply` installs the newer CLI globally, migrates `.docguard.json`, refreshes out-of-date agent files and re-registers the Spec Kit extension when its registered version differs; `--pr` puts the migration on a new branch and opens a pull request instead of editing in place |

Review the exact command and flags before assigning privileges. CLI help is the authoritative command inventory.

Mapped paths do not weaken the write boundary. A new target or an existing
`docguard:generated true` file can receive a single-role full-document write;
otherwise only an exact code-owned section can change. The command validates
all mapped targets before its first visible write, rejects malformed or shared
ownership, and treats `--force` as overwrite intent rather than authorization.

## Supply Chain

The package declares one exact-pinned dependency, `@babel/parser`, with its transitive Babel dependencies recorded in `package-lock.json`. AST extraction degrades to a regex fallback when Babel is unavailable. Python AST extraction optionally uses the installed `python3` runtime. No additional runtime package is introduced by the trust improvements. tree-sitter is not a dependency. `tools/anchor-oracle/` is a CI-only tool outside the package's `files`, with its own lockfile. Every package in it is vetted in `VETTING.md`, and it installs with `npm ci --ignore-scripts`. A user who enables the tree-sitter tier supplies the artifacts, and DocGuard loads them only when they match the shipped manifest.

Cloudflare binding extraction reads source and Wrangler file presence only. It
does not load configuration, import application modules, contact Cloudflare, or
read binding values. AST trust requires an official handler/export/import/class
signal and lexical identity; similarly named local objects do not grant binding
status. The parser fallback discloses unsupported class, Pages, and imported-env
forms instead of treating their absence from the inventory as proof.

Repository-root guidance reads only bounded ancestor metadata: regular
`.docguard.json`, `package.json`, and `pnpm-workspace.yaml` files, plus Git's
reported working-tree root. It does not execute package managers or project
code, follow manifest symlinks, scan outside the selected Git boundary, or
change the directory passed to a command.

Dependency audit results are time-specific observations. Run the current audit and supported Node-version matrix before release; a historical clean audit is not a continuing guarantee. Pin third-party CI actions to verified commit SHAs and install from the lockfile. The release workflow's `publish-homebrew` job holds the only stored release secret, `HOMEBREW_TAP_DEPLOY_KEY`, a write deploy key scoped to `raccioly/homebrew-tap`. It checks the downloaded npm tarball against `dist.integrity` and pins GitHub's SSH host keys before pushing.

No workflow job runs code beside a token that can write to the repository. Every workflow defaults to `contents: read`, and a job that writes asks for its own scope. A job that runs the test suite or DocGuard on itself holds no write permission and checks out with `persist-credentials: false`, because a bot may merge new test files without a maintainer (spec 067). A job holding `contents`, `actions`, `pull-requests` or `issues` write runs no package manager, build tool or test: the release assets (Spec Kit ZIP, Claude Desktop bundle, PyPI distribution) are built in read-only jobs and handed over as workflow artifacts, the scheduled release cuts and tests in read-only jobs and pushes the exact patch it validated from a job that runs only `git`, `gh` and `jq`, and the GHCR job logs in only after building and smoke-testing the image. The publishing jobs hold only their registry credential (`id-token` or `packages`). `tests/workflow-permissions.test.mjs` fails any workflow that breaks these rules (spec 068).

## .gitignore Audit

Exclude `node_modules`, environment values, generated build output, and private local files from version control. `.docguardignore` controls analysis coverage separately; it is not a secrecy boundary for every tool that runs in the repository.

A `.docguardignore` entry can end: `expires:YYYY-MM-DD` keeps it through that UTC day. An expired entry, or one whose expiry is not a calendar date, excludes nothing, so the Security validator scans the paths it hid again; guard reports IGN001 or IGN003. `securityIgnore` patterns carry no reason or expiry; `docguard ignore` lists them with every other suppression.

## Security Rules Checklist

- Validate subprocess inputs at their call boundaries.
- Preserve provenance checks before mechanical edits.
- Keep private diagnostics separate from public feedback payloads.
- Treat submitted reproductions as untrusted data.
- Require credentials for non-loopback HTTP MCP binding.
- Disclose unknown or unsupported verification instead of asserting success.
- Verify protected merge policy independently of local hook installation.

## Revision History

| Version | Date | Changes |
|---|---|---|
| 0.17.0 | 2026-10-11 | Workflow jobs run tests, package managers and build tools without a repository write token; release assets are built read-only (spec 068) |
| 0.16.0 | 2026-10-11 | Git hooks are written only in a hooks folder the repository owns (spec 065) |
| 0.15.0 | 2026-10-10 | `.docguardignore` expiries fail closed (an expired or unreadable entry excludes nothing); `docguard ignore` is read-only (spec 057) |
| 0.14.0 | 2026-10-10 | Freshness review for specs 038–053: `upgrade --apply` also installs agent files and calls `specify` (spec 048), the `upgrade` and `guard --update-baseline` write levels, the `npm`/`git`/`gh` subprocesses of `upgrade`, the shared Python extractor's stdin and timeout, and where agent files are written |
| 0.13.0 | 2026-09-30 | Only `init` installs agent skills and slash commands; read and preview modes write nothing; `.docguard/` ignores itself and dirty checks leave it out (spec 042) |
| 0.12.0 | 2026-09-30 | Freshness review for specs 028–037: full subprocess inventory (git, `python3 -c`, dev tooling), the remaining static shell strings, path checks for `covers=`, ownership patterns and `rules --for`, the MCP documentation tools' boundary, and the `review`, `rules` and `trace --owners` write levels |
| 0.11.0 | 2026-09-29 | Freshness review: the `specify` subprocess boundary, hook-manager ownership, the spec-first gate, and the Homebrew tap deploy key |
| 0.10.0 | 2026-09-14 | Prevent scoped evidence output from exposing raw source values |
| 0.9.0 | 2026-09-14 | Document public benchmark isolation and synthetic feedback-fixture privacy boundaries |
| 0.8.0 | 2026-09-14 | Document reconciliation and transactional spec lifecycle authority |
| 0.7.0 | 2026-09-11 | Document HTTP MCP, auxiliary writes, enforcement scope, and feedback privacy |
