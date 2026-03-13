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
  commands/             ← 11 user-facing commands
  validators/           ← 9 independent validation modules
templates/              ← CDD document templates + slash commands
vscode-extension/       ← VS Code extension
tests/                  ← Integration tests
docs-canonical/         ← DocGuard's own CDD documentation
```

## Architecture Rules

- **Zero dependencies**: DocGuard has no `node_modules` runtime deps. Keep it that way.
- **Validators are pure**: Each validator receives `(projectDir, config)` and returns results. No side effects.
- **Commands don't cross-import**: Commands import from validators, never from other commands.
- **AI is the author**: The CLI flags problems and generates prompts. It never writes doc content.

## Adding a New Command

1. Create `cli/commands/your-command.mjs` with an exported `runYourCommand(projectDir, config, flags)` function
2. Import it in `cli/docguard.mjs`
3. Add it to the help text, command routing switch, and argument parsing
4. Add tests in `tests/commands.test.mjs`
5. Update `CHANGELOG.md`

## Adding a New Validator

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

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
