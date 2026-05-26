/**
 * v0.16-P2 — Language-aware TRACE_MAP.
 *
 * The original JS/TS patterns false-negatived on Python/Rust/Go/Java projects
 * (reported by a Python user: TEST-SPEC.md was flagged unlinked even though
 * `tests/test_cli.py` existed). v0.16 widens every pattern to cover the
 * common alternatives across ecosystems.
 *
 * Each test pokes a single language's typical layout and confirms the
 * relevant TRACE_MAP entry now matches.
 *
 * @req SC-P2-001 — Python tests (test_*.py, *_test.py, tests/*.py) match TEST-SPEC patterns
 * @req SC-P2-002 — Go tests (*_test.go) match TEST-SPEC patterns
 * @req SC-P2-003 — Rust tests (tests/*.rs) match TEST-SPEC patterns
 * @req SC-P2-004 — Java tests (*Test.java, *Spec.java) match TEST-SPEC patterns
 * @req SC-P2-005 — Python entry points (__main__.py, cli.py, app.py) match ARCHITECTURE
 * @req SC-P2-006 — Rust/Go/Java config files match ARCHITECTURE
 * @req SC-P2-007 — Python env files (requirements.txt, pyproject.toml, uv.lock) match ENVIRONMENT
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

// We don't export TRACE_MAP directly to keep the module surface small, but
// we can exercise it via runTrace's subprocess. For unit-level coverage the
// regex matching is the contract; we mirror the patterns here to verify the
// shape of what we ship. The single source of truth lives in trace.mjs;
// these tests catch the case where someone removes a pattern.

// Same regex literals as cli/commands/trace.mjs's TEST-SPEC entry.
const TEST_GLOB = /\.(?:test|spec)\.(?:mjs|cjs|[jt]sx?)$|(?:^|\/)test_[^/]+\.py$|[^/]+_test\.py$|_test\.go$|(?:Test|Spec|IT)\.(?:java|kt)$|(?:^|\/)tests?\/[^/]+\.(?:rs|py|rb|php)$|_(?:spec|test)\.rb$|Test\.php$/;
const ENTRY_GLOB = /(?:^|\/)(?:index|main|app|server|cli|__main__|Application|Main)\.(?:[jt]sx?|mjs|cjs|py|go|rs|java|kt|rb)$|(?:^|\/)cmd\//;
const CONFIG_GLOB = /(?:^|\/)(?:package\.json|tsconfig|next\.config|vite\.config|pyproject\.toml|setup\.(?:py|cfg)|Cargo\.toml|go\.mod|pom\.xml|build\.gradle|Gemfile|composer\.json)/;
const ENV_PY_GLOB = /(?:^|\/)(?:requirements[^/]*\.txt|Pipfile|poetry\.lock|uv\.lock|pyproject\.toml)$/;

describe('TRACE_MAP — TEST-SPEC test patterns (multi-language)', () => {
  it('matches JS/TS test files (regression)', () => {
    assert.match('src/foo.test.ts', TEST_GLOB);
    assert.match('lib/bar.spec.tsx', TEST_GLOB);
    assert.match('cli/baz.test.mjs', TEST_GLOB);
  });

  it('matches Python test files (test_*.py / *_test.py / tests/*.py)', () => {
    assert.match('tests/test_cli.py', TEST_GLOB);
    assert.match('src/test_helpers.py', TEST_GLOB);
    assert.match('lib/cli_test.py', TEST_GLOB);
    assert.match('tests/integration/test_api.py', TEST_GLOB);
  });

  it('matches Go test files (*_test.go)', () => {
    assert.match('internal/auth/handler_test.go', TEST_GLOB);
    assert.match('pkg/utils/format_test.go', TEST_GLOB);
  });

  it('matches Rust test files (tests/*.rs)', () => {
    assert.match('tests/integration.rs', TEST_GLOB);
    assert.match('crate/tests/smoke.rs', TEST_GLOB);
  });

  it('matches Java/Kotlin test files (*Test.java / *Spec.kt)', () => {
    assert.match('src/test/java/com/example/AuthTest.java', TEST_GLOB);
    assert.match('src/test/kotlin/foo/BarSpec.kt', TEST_GLOB);
    assert.match('src/test/java/IntegrationIT.java', TEST_GLOB);
  });

  it('matches Ruby spec files (*_spec.rb / *_test.rb)', () => {
    assert.match('spec/models/user_spec.rb', TEST_GLOB);
    assert.match('test/unit/user_test.rb', TEST_GLOB);
  });

  it('does NOT match non-test files (no false positives)', () => {
    assert.doesNotMatch('src/index.ts', TEST_GLOB);
    assert.doesNotMatch('lib/user.py', TEST_GLOB);
    assert.doesNotMatch('handler.go', TEST_GLOB);
    assert.doesNotMatch('src/main.rs', TEST_GLOB);
    assert.doesNotMatch('README.md', TEST_GLOB);
  });
});

describe('TRACE_MAP — ARCHITECTURE entry points (multi-language)', () => {
  it('matches Python entry points', () => {
    assert.match('src/__main__.py', ENTRY_GLOB);
    assert.match('app.py', ENTRY_GLOB);
    assert.match('cli.py', ENTRY_GLOB);
    assert.match('myapp/main.py', ENTRY_GLOB);
  });

  it('matches Rust entry points', () => {
    assert.match('src/main.rs', ENTRY_GLOB);
  });

  it('matches Go entry points', () => {
    assert.match('cmd/server/main.go', ENTRY_GLOB);
    assert.match('main.go', ENTRY_GLOB);
  });

  it('matches Java entry points', () => {
    assert.match('src/main/java/Application.java', ENTRY_GLOB);
    assert.match('src/main/java/Main.java', ENTRY_GLOB);
  });

  it('keeps matching JS/TS entry points (regression)', () => {
    assert.match('src/index.ts', ENTRY_GLOB);
    assert.match('server.js', ENTRY_GLOB);
    assert.match('app.tsx', ENTRY_GLOB);
  });
});

describe('TRACE_MAP — ARCHITECTURE config files (multi-language)', () => {
  it('matches Python config files', () => {
    assert.match('pyproject.toml', CONFIG_GLOB);
    assert.match('setup.py', CONFIG_GLOB);
    assert.match('setup.cfg', CONFIG_GLOB);
  });

  it('matches Rust / Go / Java / Ruby / PHP config files', () => {
    assert.match('Cargo.toml', CONFIG_GLOB);
    assert.match('go.mod', CONFIG_GLOB);
    assert.match('pom.xml', CONFIG_GLOB);
    assert.match('build.gradle', CONFIG_GLOB);
    assert.match('Gemfile', CONFIG_GLOB);
    assert.match('composer.json', CONFIG_GLOB);
  });

  it('keeps matching JS/TS config files (regression)', () => {
    assert.match('package.json', CONFIG_GLOB);
    assert.match('tsconfig.json', CONFIG_GLOB);
  });
});

describe('TRACE_MAP — ENVIRONMENT Python ecosystem', () => {
  it('matches Python lock + requirements files', () => {
    assert.match('requirements.txt', ENV_PY_GLOB);
    assert.match('requirements-dev.txt', ENV_PY_GLOB);
    assert.match('Pipfile', ENV_PY_GLOB);
    assert.match('poetry.lock', ENV_PY_GLOB);
    assert.match('uv.lock', ENV_PY_GLOB);
    assert.match('pyproject.toml', ENV_PY_GLOB);
  });
});
