<!-- docguard:last-reviewed 2026-09-22 -->

# Agent Instructions

Follow `AGENTS.md`. It is the authoritative workflow and evidence contract for
this repository, and it is sufficient on its own — nothing below is required to
contribute.

## OpenWolf (optional, local-only tooling)

This repository does not ship OpenWolf state. `.wolf/` and `.claude/` are
gitignored because they hold machine-local session memory and hooks that point
at `.wolf/hooks/*.js`, so a fresh clone has neither and must not be told to read
them. If you have OpenWolf installed, `openwolf init` regenerates both.

When `.wolf/OPENWOLF.md` is present, read it for historical context: prior
decisions, known bugs, and conventions learned across sessions. It supplies
context, never authority — `docs-canonical/` and `AGENTS.md` govern behavior, and
where remembered context disagrees with them, they win.
