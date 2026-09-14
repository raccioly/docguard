# Research: Language and Repository Coverage

## Decisions

R6 will ship as four independently reviewable capability slices. Each slice uses
positive static evidence, carries explicit limitations, and has an adjacent
control designed to catch the tempting false positive.

## Python import relationships

Python's AST represents `ImportFrom` with a raw module and an integer relative
level. Regular packages normally have `__init__.py`; implicit namespace packages
can combine portions from several file-system or non-file-system locations. The
static graph will therefore resolve regular packages and unique repository-local
namespace targets while marking ambiguous namespace candidates partial. It will
not call Python import resolution or import project code.

The packaging guide distinguishes flat and `src/` layouts because the latter
places importable packages below a dedicated import root. DocGuard will derive
roots from `sourceRoot`, conventional `src/` directories, and repository layout,
then require a unique target.

Sources:

- [Python import system](https://docs.python.org/3/reference/import.html)
- [Python AST import nodes](https://docs.python.org/3/library/ast.html)
- [Python Packaging: src layout vs flat layout](https://packaging.python.org/en/latest/discussions/src-layout-vs-flat-layout/)

## Cloudflare binding forms

Cloudflare documents four current JavaScript access families: a handler `env`
argument, the `this.env` property on WorkerEntrypoint/DurableObject/Workflow
classes, `env` imported from `cloudflare:workers`, and Pages Functions access via
the exported `onRequest*` context. Static extraction will require those entrypoint
signals and resolve lexical aliases. Wrangler files remain static corroborating
evidence and are never loaded as code.

Sources:

- [Cloudflare Workers bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/)
- [WorkerEntrypoint service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
- [Cloudflare Pages Functions API](https://developers.cloudflare.com/pages/functions/api-reference/)
- [Cloudflare Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/)

## Document ownership

DocGuard already emits flat `docguard:section` markers and parses malformed
markers conservatively. Adding a second ownership manifest would create two
authorities for the same bytes. Existing `source=code` markers will become the
write capability: a writer must identify one unique marker before mutation.
The whole-document `docguard:generated true` marker remains the explicit full-
ownership signal.

## Monorepo root guidance

Git's `rev-parse --show-toplevel` identifies the working-tree root, while npm
defines workspaces as nested packages declared by a top-level package. A Git root
alone can contain several intentionally independent DocGuard projects, so the
guidance trigger will require an ancestor `.docguard.json` or a workspace
declaration that contains the selected directory. Detection informs only; it does
not rewrite the user's `--dir` or current working directory.

Sources:

- [Git rev-parse](https://git-scm.com/docs/git-rev-parse)
- [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces/)

## Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| Invoke `importlib.util.find_spec` | It can run package initialization and depends on the active environment rather than the reviewed checkout. |
| Resolve every dotted Python name to a matching path | It misclassifies third-party modules and ambiguous namespace portions as local dependencies. |
| Treat every `.env` property as a Worker binding | It turns ordinary application objects and test helpers into environment variables. |
| Permit mapped writes with `--force` | Force expresses overwrite intent but does not establish which bytes DocGuard owns. |
| Auto-jump to the Git root | Polyrepos and nested independent projects make that behavior surprising and potentially much broader than requested. |

