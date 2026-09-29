# Contract: DocGuard → `specify` CLI

All invocations use an argument array (`execFileSync('specify', args)`; on Windows
`execFileSync('cmd.exe', ['/c', 'specify.cmd', ...args])`), `stdio: 'pipe'`, and a timeout.

## 1. Capability probe

```text
specify init --help                      timeout 15 s
```

Parse long options (`--[a-z][a-z-]*`) after stripping ANSI. `--integration` present ⇒ supported.

## 2. Initialization (only from `docguard init`)

```text
specify init --here --force
             --integration <key>
             [--integration-options "--commands-dir .agent/commands/"]   # key = generic only
             [--non-interactive]        # when listed by the probe
             [--ignore-agent-tools]     # when listed by the probe
             [--script sh|ps]           # when listed; ps on win32
                                         timeout 60 s
```

Never passed: `--ai`, `--ai-skills`, `--ai-commands-dir`, `--no-git`.

## 3. Extension registration (after 2 succeeds, or when already initialized)

```text
specify extension add <docguardPackageRoot>/extensions/spec-kit-docguard --dev
                                         timeout 60 s
```

Skipped when `.specify/extensions/.registry` parses and contains `extensions.docguard`.

## Failure semantics

A non-zero exit, a spawn error or a timeout produces `status: 'failed'` with `reason` taken from
stderr, then stdout, then the error message (ANSI-stripped, 400 characters max). The caller
prints the reason and `manualCommand`; it never prints a success line for a failed step.
