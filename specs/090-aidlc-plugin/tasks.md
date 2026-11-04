# Tasks: DocGuard Runs Inside AWS AI-DLC as a Plugin

**Input**: [spec.md](spec.md), [plan.md](plan.md)

## Phase 1 — Failing tests first

- [x] T001 [US1] `tests/aidlc-plugin.test.mjs`: the `sensorResult` pass rules, the 20-finding cap, the CLI JSON line, and the HEAD-relative pass (FR-001).
- [x] T002 [US2] Same file: four of five fires served from the cache; a file change reruns guard (FR-002, SC-002).
- [x] T003 [US3] Same file: manifest name, core dependency, catalogue and version; the sensor manifest fields; the thin wrapper never exits 127; contributions to both stages (FR-003, FR-004, FR-006).

## Phase 2 — Implementation

- [x] T004 `cli/commands/sensor.mjs`, CLI wiring and help, headless output.
- [x] T005 [US3] [US4] `extensions/aidlc/docguard/` plugin files, including the developer-agent knowledge guide `knowledge/aidlc-developer-agent/docguard.md` (FR-003).

## Phase 3 — End to end, CI and docs

- [x] T006 End to end with AI-DLC 2.11.2: validate, build, compose, graph binding, and five fire cases (SC-001, SC-003; Verification Notes).
- [x] T007 CI job `aidlc-plugin`; release version sync and allowlist (FR-005, FR-006).
- [x] T008 Docs, guide, CHANGELOG; full suite; hermetic A/B.
