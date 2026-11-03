---
title: AWS AI-DLC
parent: Guides
nav_order: 7
---

# DocGuard with AWS AI-DLC

[AI-DLC](https://github.com/awslabs/aidlc-workflows) runs an agent through
gated stages (Inception → Construction → Operation) and checks traceability at
each gate. DocGuard keeps what those stages produced true afterwards, on every
change. The two connect in two ways.

## 1. DocGuard reads AI-DLC workspaces

`docguard guard` recognizes `aidlc/spaces/<space>/intents/<id>/` (and the legacy
`aidlc-docs/`) with no setup. The `aidlc` validator reports these findings,
all informational until you promote them:

| Code | Meaning |
|---|---|
| AID001 | A `traceability.json` row marked OK or Deferred names a file that no longer exists |
| AID002 | A GAP or ORPHAN row was left in a stage `aidlc-state.md` marks completed |
| AID003 | A file a unit's `source-manifest.json` claims was removed after the unit (git tells this apart from the unit's own deletions) |
| AID004 | A record that cannot be read, or a path that escapes the project |
| MEM001 | A learned rule in `memory/{org,team,project}.md` names a deleted path or an env var nothing uses |
| MEM002 | The CodeKB names a path that no longer exists |

DocGuard never writes AI-DLC files. To feed AI-DLC verified facts:

```bash
npx docguard-cli memory --export aidlc --write   # writes knowledge/docguard/canonical-memory.md
aidlc engine knowledge onboard aidlc/spaces/default/knowledge/docguard/canonical-memory.md
npx docguard-cli memory --consolidate aidlc      # repeated diary entries; writes nothing
```

## 2. DocGuard runs inside AI-DLC as a plugin

The `docguard` plugin (`extensions/aidlc/docguard/`) adds a `docguard-guard`
sensor to the code-generation and build-and-test gates.

The sensor passes when the work in progress introduced no drift: no blocking
finding, and no finding the HEAD commit did not already have. A project's
existing warnings do not fail its gates, but drift a stage writes does, whether
it is in a doc or in the code. If DocGuard is not installed, AI-DLC records
"could not run", never a pass.

```bash
npm install -g docguard-cli
cd extensions/aidlc/docguard          # in a DocGuard checkout or release
AIDLC_PROJECT_DIR=/path/to/project aidlc engine plugin build claude ./dist
# Claude Code: /plugin marketplace add ./dist   then   /plugin install docguard@docguard-aidlc
```

The sensor is advisory, like AI-DLC's own. To have it hold the gate, make it
blocking in your AI-DLC scope. To have DocGuard itself require checks, list
them in `requiredChecks` in `.docguard.json`.
