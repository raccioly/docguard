# Anchor oracle: package vetting

Constitution II applies to every package that `npm ci` installs here, transitive ones included.

- **Source.** Each package must be on the official registry.
- **Adoption.** More than 10,000 weekly downloads.
- **Maintainers.** More than one.
- **Age.** First published more than 30 days earlier.
- **Pinning.** Exact versions, with integrity hashes in `package-lock.json`.

This directory is a CI-only tool. It is outside the published package's `files`, so nothing here is a DocGuard dependency.

## Evidence (2026-10-11)

Collected with `npm view <name>@<version> --json`, `npm view <name> time maintainers --json` and `https://api.npmjs.org/downloads/point/last-week/<name>`, for every entry in `package-lock.json`.

| Package | Version | Registry | Weekly downloads | Maintainers | First published | This version | Install scripts | License |
|---|---|---|---:|---:|---|---|---|---|
| `node-addon-api` | 8.9.2 | registry.npmjs.org | 97,303,209 | 7 | 2017-05-04 | 2026-08-12 (60 days) | none | MIT |
| `node-gyp-build` | 4.8.4 | registry.npmjs.org | 54,916,808 | 2 | 2017-01-25 | 2024-11-19 (691 days) | none | MIT |
| `tree-sitter-c` | 0.24.1 | registry.npmjs.org | 431,247 | 9 | 2015-03-08 | 2025-05-24 (505 days) | yes, never run | MIT |
| `tree-sitter-c-sharp` | 0.23.5 | registry.npmjs.org | 234,513 | 7 | 2017-11-22 | 2026-04-14 (180 days) | yes, never run | MIT |
| `tree-sitter-cpp` | 0.23.4 | registry.npmjs.org | 295,182 | 8 | 2017-01-31 | 2024-11-11 (699 days) | yes, never run | MIT |
| `tree-sitter-c` | 0.23.6 | registry.npmjs.org | 431,247 | 9 | 2015-03-08 | 2025-05-24 (505 days) | yes, never run | MIT |
| `tree-sitter-go` | 0.25.0 | registry.npmjs.org | 742,009 | 8 | 2016-09-04 | 2025-08-29 (408 days) | yes, never run | MIT |
| `tree-sitter-java` | 0.23.5 | registry.npmjs.org | 421,976 | 11 | 2017-11-27 | 2024-12-21 (659 days) | yes, never run | MIT |
| `tree-sitter-php` | 0.24.2 | registry.npmjs.org | 321,398 | 5 | 2017-12-14 | 2025-08-18 (419 days) | yes, never run | MIT |
| `tree-sitter-ruby` | 0.23.1 | registry.npmjs.org | 305,098 | 12 | 2017-02-02 | 2024-11-11 (699 days) | yes, never run | MIT |
| `tree-sitter-rust` | 0.24.0 | registry.npmjs.org | 465,800 | 10 | 2017-03-29 | 2025-04-01 (558 days) | yes, never run | MIT |
| `web-tree-sitter` | 0.27.0 | registry.npmjs.org | 8,279,288 | 8 | 2019-05-07 | 2026-08-30 (42 days) | none | MIT |

Every row passes every criterion. The pinned `web-tree-sitter` is 0.27.0, not 0.27.1: 0.27.1 was published 3 days before this check, inside the 30-day window.

## Install scripts never run

The grammar packages declare `install` scripts that build native Node bindings through `node-gyp-build`. The oracle needs none of them: it loads each grammar's prebuilt `.wasm` file into `web-tree-sitter`. CI installs with `npm ci --ignore-scripts`, so no package script runs. `node-addon-api` and `node-gyp-build` are installed only because the grammars declare them, and nothing loads them.

## Rejected

| Package | Why | Effect |
|---|---|---|
| `tree-sitter-kotlin` 0.3.8 | One maintainer | Kotlin has no oracle and keeps the pattern tier's medium confidence |
| `tree-sitter-swift` 0.7.1 | One maintainer | Swift has no oracle and keeps the pattern tier's medium confidence |
| `tree-sitter-javascript`, `tree-sitter-typescript`, `tree-sitter-python` | Not needed | JS/TS and Python anchor through Babel and `python3`'s `ast`, not the pattern tier |

## Grammar compatibility

Each grammar's `.wasm` loads in `web-tree-sitter` 0.27.0. The ABI versions are:
- **14:** Rust, Java, Ruby, C++;
- **15:** Go, C#, PHP, C.

`run.mjs` loads them by path from this directory's `node_modules`.

## Re-vetting

Repeat every check above before changing a version, and record the new evidence here in the same change. A package that stops meeting a criterion is removed, and its language is reported as having no oracle.
