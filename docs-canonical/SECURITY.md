# Security

<!-- docguard:quality negation-load off — prohibitions define security boundaries -->
<!-- docguard:version 0.7.0 -->
<!-- docguard:status active -->
<!-- docguard:last-reviewed 2026-09-14 -->

## Overview

DocGuard's validation and extraction run on the local machine. They inspect repository content and return findings. Agent integrations inherit the permissions and data-handling policy of the calling agent. A generated prompt does not authorize a network request, a code edit, or publication.

The optional MCP server supports stdio and HTTP. Installation, upgrade, publishing, and user-opened feedback links may access external services. Local analysis requires no hosted AI service.

## Authentication

| Surface | Authentication | Boundary |
|---|---|---|
| CLI and stdio MCP | Calling operating-system user | Local filesystem permissions |
| HTTP MCP | Optional API key on loopback; mandatory for non-loopback binding | Host binding, key check, and browser-origin validation in `cli/commands/mcp.mjs` |
| GitHub feedback | User-controlled browser session | Submission occurs only when the user submits a reviewed issue |

HTTP clients can cause the server to inspect project directories available to its process. Run it under an account with only the intended filesystem access. An API key does not provide per-project authorization or a multi-tenant isolation boundary. Network exposure needs deployment-specific access controls.

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

Feedback issue URLs contain allowlisted detector metadata, classification, parser tier, and a synthetic-shape duplicate identity. Full local finding records can include private paths and diagnostic text. Fixture manifests are accepted only with explicit synthetic-content and redaction-review attestations; they reject escaping paths, `.git`, `.local`, symlinked inputs, unsafe config values, and oversized content. Preview mode avoids all writes. Generated tests contain the attested synthetic fixture, so users must review it before contribution.

The optional external benchmark accepts only credential-free public HTTPS Git URLs pinned to full commit hashes. It disables interactive Git authentication and global/system Git configuration, forbids the file protocol, never runs project scripts, copies no `.git` metadata into case projects, and removes its temporary root by default. External execution is absent from ordinary tests and package installation.

## Subprocess Safety

Pass untrusted arguments through argv arrays and validate values for their intended operation. Avoid interpolating configuration or repository content into shell commands. Existing static command strings do not authorize expanding their input surface. Regression tests in `tests/security-init-injection.test.mjs` exercise the input boundary.

## Command Safety Levels

| Operation | Source writes | Auxiliary writes / effects |
|---|---|---|
| guard, score, diff, diagnose | None by default | Plan caching may create `.docguard/` artifacts; explicit mutation flags change behavior |
| ci | None | Records history unless `--no-history` is set |
| feedback | None | Saves local records or an explicitly requested direct `tests/*.test.mjs` contribution unless `--preview`; prints opt-in URLs but never submits |
| memory --pack | None | Writes a generated context pack |
| fix --write, sync --write | Targeted documentation edits | Backups and fix history where supported |
| reconcile | None by default | `--write` delegates only mechanical generated-section refreshes to `sync` |
| specs, specs preflight | None for check/plan modes | `specs --write` refreshes the registry; `specs complete --write` transactionally records a reviewed outcome and active context |
| verify --evidence | None | Reads the strict local manifest, selected Markdown, source files, and saved reports; guard consumes the same evaluator |
| retire --write | Explicit clean tracked documentation only | Requires retained-ref recovery proof, clean replacement/evidence docs, and no live Markdown backreferences |
| init, generate | Documentation and configuration scaffolding | Explicit force options may overwrite content |
| hooks | Hook configuration and executable scripts | Auto-fix hooks may edit and stage documentation |
| report | None by default | `--out` writes an artifact |

Review the exact command and flags before assigning privileges. CLI help is the authoritative command inventory.

## Supply Chain

The package declares one exact-pinned dependency, `@babel/parser`, with its transitive Babel dependencies recorded in `package-lock.json`. AST extraction degrades to a regex fallback when Babel is unavailable. Python AST extraction optionally uses the installed `python3` runtime. No additional runtime package is introduced by the trust improvements.

Cloudflare binding extraction reads source and Wrangler file presence only. It
does not load configuration, import application modules, contact Cloudflare, or
read binding values. AST trust requires an official handler/export/import/class
signal and lexical identity; similarly named local objects do not grant binding
status. The parser fallback discloses unsupported class, Pages, and imported-env
forms instead of treating their absence from the inventory as proof.

Dependency audit results are time-specific observations. Run the current audit and supported Node-version matrix before release; a historical clean audit is not a continuing guarantee. Pin third-party CI actions to verified commit SHAs and install from the lockfile.

## .gitignore Audit

Exclude `node_modules`, environment values, generated build output, and private local files from version control. `.docguardignore` controls analysis coverage separately; it is not a secrecy boundary for every tool that runs in the repository.

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
| 0.10.0 | 2026-09-14 | Prevent scoped evidence output from exposing raw source values |
| 0.9.0 | 2026-09-14 | Document public benchmark isolation and synthetic feedback-fixture privacy boundaries |
| 0.8.0 | 2026-09-14 | Document reconciliation and transactional spec lifecycle authority |
| 0.7.0 | 2026-09-11 | Document HTTP MCP, auxiliary writes, enforcement scope, and feedback privacy |
