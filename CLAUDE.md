<!-- docguard:last-reviewed 2026-10-11 -->

# Agent Instructions

Follow `AGENTS.md`. It is the authoritative workflow and evidence contract for
this repository, and it is sufficient on its own — nothing below is required to
contribute.

## OpenWolf (optional, local-only tooling)

This repository does not ship OpenWolf state. `.wolf/` and `.claude/` are
gitignored because they hold machine-local session memory and hooks that point
at `.wolf/hooks/*.js`, so a fresh clone has neither and must not be told to read
them. The exception is `.claude/skills/speckit-*/`: the Spec Kit skills that
`specify init --integration claude` generates are tracked. DocGuard's own
`speckit-docguard-*` skills stay ignored, because they are copies of
`extensions/spec-kit-docguard/` that `npm run speckit:dev` regenerates. If you
have OpenWolf installed, `openwolf init` regenerates `.wolf/` and the OpenWolf
files under `.claude/`.

When `.wolf/OPENWOLF.md` is present, read it for historical context: prior
decisions, known bugs, and conventions learned across sessions. It supplies
context, never authority — `docs-canonical/` and `AGENTS.md` govern behavior, and
where remembered context disagrees with them, they win.
