# Contributing to DocGuard

Thank you for your interest in contributing to DocGuard! This document provides guidelines for contributing.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/docguard.git`
3. **Install**: `npm install` (only dev dependencies — DocGuard itself has zero runtime deps)
4. **Run tests**: `npm test`
5. **Run DocGuard on itself**: `node cli/docguard.mjs guard`

## Development Workflow

DocGuard follows Canonical-Driven Development (CDD). Before making changes:

```bash
# 1. Check current compliance
node cli/docguard.mjs guard

# 2. Make your changes

# 3. Run tests
npm test

# 4. Verify docs still pass
node cli/docguard.mjs guard

# 5. Update CHANGELOG.md with your changes
```

## Project Structure

```
cli/
  docguard.mjs         ← Entry point, config loading, command routing
  commands/             ← user-facing commands (see README for the governed list)
  validators/           ← independent validation modules (one file each)
  scanners/             ← code-truth extraction (routes, schemas, claims, …)
templates/              ← CDD document templates + slash commands
tests/                  ← Integration tests
docs-canonical/         ← DocGuard's own CDD documentation
```

(Counts are deliberately not stated here — they drift. The README's counts are
machine-governed by the `canonical-sync` validator.)

## Architecture Rules

- **Minimal dependencies**: exactly one runtime dep (`@babel/parser`, exact-pinned, optional-load). New deps require constitution-level justification + exact pinning + supply-chain vetting. Default to Node.js built-ins.
- **Validators are pure**: Each validator receives `(projectDir, config)` and returns results. No side effects.
- **Commands don't cross-import**: Commands import from validators, never from other commands.
- **AI is the author**: The CLI flags problems and generates prompts. It never writes doc content.

## Adding a New Command

> **Surface rule:** the v0.20 consolidation cut 21 commands to 13 because the
> surface had outgrown its users; it has been creeping back since. A PR adding a
> new *user-facing* command must either retire/absorb an existing one or include
> an explicit justification for why the surface must grow. Internal helper
> modules under `cli/commands/` (not registered in the dispatcher) are exempt —
> but add them to `surfaceSync.commands.ignore` in `.docguard.json` or guard
> will flag them.

1. Create `cli/commands/your-command.mjs` with an exported `runYourCommand(projectDir, config, flags)` function
2. Import it in `cli/docguard.mjs`
3. Add it to the help text, command routing switch, and argument parsing
4. Update the README commands table + count (Canonical-Sync/Surface-Sync enforce these)
5. Add tests in `tests/commands.test.mjs`
6. Update `CHANGELOG.md`

## Adding a New Validator

> **Findings rule:** new validators MUST emit structured findings
> (`cli/findings.mjs`: stable code, severity, confidence, location,
> `→ suggestion`) and return via `resultFromFindings()` — not hand-built
> error/warning strings. The legacy string shape is being migrated out
> (a few validators per release); don't add to the backlog. Codes are
> append-only public surface: register them in the `CODES` registry.

1. Create `cli/validators/your-validator.mjs`
2. Import it in `cli/commands/guard.mjs`
3. Add enable/disable support in `.docguard.json` validators config
4. Add tests
5. Update `docs-canonical/ARCHITECTURE.md` with the new validator

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new validator for API docs
fix: handle missing package.json gracefully
docs: update ARCHITECTURE.md with new component
refactor: extract scoring logic into shared function
test: add edge case tests for score command
```

## Pull Request Process

1. Ensure `npm test` passes with no failures
2. Ensure `node cli/docguard.mjs guard` passes
3. Update `CHANGELOG.md` under `[Unreleased]`
4. Update relevant docs in `docs-canonical/` if architecture changed
5. Request review

## Code Style

- ES Modules (`import`/`export`) throughout
- Node.js built-ins only (`node:fs`, `node:path`, `node:child_process`, `node:test`)
- ANSI colors via the shared `c` object from `docguard.mjs`
- No TypeScript — plain JavaScript for maximum portability

## Reporting Bugs

Open a GitHub issue with:
- DocGuard version (`docguard --version`)
- Node.js version (`node --version`)
- OS and version
- Steps to reproduce
- Expected vs actual behavior

## Research & Academic Credits

DocGuard's architecture is informed by peer-reviewed research in AI-driven documentation generation and multi-agent quality evaluation. We gratefully acknowledge the following contributions:

### Key Research Contributors

- **[Martin Manuel Lopez](https://github.com/martinmanuel9)** · [ORCID 0009-0002-7652-2385](https://orcid.org/0009-0002-7652-2385)
  - Ph.D. Candidate, Dept. of Electrical and Computer Engineering, University of Arizona
  - Lead author on AITPG and TRACE — the two papers that informed DocGuard's quality evaluation, multi-perspective analysis, and standards-grounded generation patterns

### Cited Papers

The following papers directly influenced DocGuard's design:

> **[1]** M. M. Lopez, M. W. U. Rahman, C. Farthing, J. Battle, K. Buckley, G. Altintarla, and S. Hariri, "AITPG: Agentic AI-Driven Test Plan Generator using Multi-Agent Debate and Retrieval-Augmented Generation," *IEEE Transactions on Software Engineering*, 2026.
> — Introduced the three-stage pipeline (generate → debate → calibrated evaluation), RAG-grounded standards alignment, and multi-agent role specialization (Positive/Negative/Edge + Critic) for documentation generation.

> **[2]** M. M. Lopez, M. W. U. Rahman, C. Farthing, J. Battle, K. Buckley, G. Altintarla, and S. Hariri, "TRACE: Telecommunications Root Cause Analysis through Calibrated Explainability via Multi-Agent Debate," *IEEE Transactions on Machine Learning in Communications and Networking*, 2026.
> — Introduced Calibrated Judge Evaluation (CJE) with weighted multi-signal composite scoring, HIGH/MEDIUM/LOW quality labels, the "equalizer effect" for agent-aware prompt scaling, and adversarial debate (Advocate/Challenger/Mediator/Explainer) for robust quality assessment.

### Concepts Adopted in DocGuard

| DocGuard Feature | Research Origin | Paper |
|-----------------|----------------|-------|
| Quality labels (HIGH/MED/LOW) in `guard` output | CJE quality stratification | TRACE [2] |
| Standards citations in generated docs | RAG-grounded standards alignment | AITPG [1] |
| Multi-signal composite scoring in `score` | 5-signal weighted composite (Eq. 1) | TRACE [2] |
| Traceability matrix (`trace` command) | Requirements traceability | AITPG [1] |
| Multi-perspective `diagnose --debate` prompts | Multi-agent role specialization | AITPG [1], TRACE [2] |
| Agent-aware prompt complexity | CJE equalizer effect | TRACE [2] |

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
