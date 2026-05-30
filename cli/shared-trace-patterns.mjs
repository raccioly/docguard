/**
 * Shared trace patterns — the single source of truth for doc→code traceability,
 * used by BOTH the `docguard trace` command (cli/commands/trace.mjs) and the
 * guard-time Traceability validator (cli/validators/traceability.mjs).
 *
 * Previously each file had its own copy: trace.mjs was multilingual (v0.16-P2)
 * while the validator stayed JS/TS-only, so the README's "language-aware trace
 * mapping" claim was false for the `guard` path. Sharing here makes the claim
 * true and prevents the two from drifting again (field-report Issue 3).
 *
 * The API-REFERENCE entry additionally carries the explicit Next.js App Router
 * pattern (app/api, pages/api) preserved from the v0.22.0 #195 fix.
 */

/**
 * A markdown file is documentation, never the source that *implements* a
 * canonical doc — so it must not count as a doc→code match. Without this,
 * SECURITY.md's "Auth modules" glob (which includes `guard`) matched
 * `commands/docguard.guard.md` and listed DocGuard's own command docs as the
 * project's auth modules (field report). Real config-file matches (.env,
 * Dockerfile, pyproject.toml, .gitignore) are unaffected — none are `.md`.
 * Used by both `docguard trace` and the guard-time Traceability validator.
 */
export function isTraceableSource(relPath) {
  return !relPath.endsWith('.md');
}

export const TEST_PATTERNS = [
  // JS/TS
  /\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /\.test\.(mjs|cjs)$/,
  // Python — pytest conventions
  /(^|\/)test_[^/]+\.py$/, /[^/]+_test\.py$/, /(^|\/)tests?\/[^/]+\.py$/,
  // Go
  /_test\.go$/,
  // Java/Kotlin — JUnit/TestNG conventions
  /(?:Test|Tests|Spec|IT)\.(?:java|kt)$/,
  // Rust — tests live in tests/ or as #[cfg(test)] modules; pattern below covers integration tests
  /(^|\/)tests\/[^/]+\.rs$/,
  // Ruby/RSpec
  /_spec\.rb$/, /_test\.rb$/,
  // PHP/PHPUnit
  /Test\.php$/, /(^|\/)tests?\/[^/]+\.php$/,
];

export const TRACE_MAP = {
  'ARCHITECTURE.md': {
    standard: 'arc42 / C4 Model',
    sourcePatterns: [
      // Entry points: JS (index/main/app/server.[jt]sx?), Python (__main__.py, main.py, app.py, cli.py),
      // Go (main.go, cmd/), Rust (main.rs, lib.rs), Java (Application.java, Main.java)
      { label: 'Entry points', glob: /(?:^|\/)(?:index|main|app|server|cli|__main__|Application|Main)\.(?:[jt]sx?|mjs|cjs|py|go|rs|java|kt|rb)$|(?:^|\/)cmd\// },
      // Config files: JS (package.json/tsconfig/next.config/vite.config), Python (pyproject.toml/setup.py/setup.cfg),
      // Rust (Cargo.toml), Go (go.mod), Java/Kotlin (pom.xml/build.gradle), Ruby (Gemfile), PHP (composer.json)
      { label: 'Config files', glob: /(?:^|\/)(?:package\.json|tsconfig|next\.config|vite\.config|pyproject\.toml|setup\.(?:py|cfg)|Cargo\.toml|go\.mod|pom\.xml|build\.gradle|Gemfile|composer\.json)/ },
      // Route handlers + module dirs
      { label: 'Route handlers / modules', glob: /(?:^|\/)(?:routes?|api|pages|app|controllers?|handlers?|views?|services?)\// },
    ],
  },
  'DATA-MODEL.md': {
    standard: 'C4 Component / ER (Chen)',
    sourcePatterns: [
      // Schema/model files: JS (schema/model/entity/migration/prisma), Python (models.py/schema.py/Pydantic/SQLAlchemy),
      // Go (models/), Rust (struct definitions in models/), Java (entities/)
      { label: 'Schema definitions', glob: /(?:schema|model|entity|migration|prisma)/i },
      // Type definitions: JS types.ts, Python types.py, Rust types.rs
      { label: 'Type definitions', glob: /(?:^|\/)types?\.(?:[jt]sx?|mjs|py|rs|go|java|kt)$/ },
      // ORM/database libs (any language)
      { label: 'Database configs', glob: /(?:drizzle|knex|sequelize|typeorm|sqlalchemy|alembic|django|diesel|sqlx|gorm|hibernate|active.?record)/i },
    ],
  },
  'TEST-SPEC.md': {
    standard: 'ISO/IEC/IEEE 29119-3',
    sourcePatterns: [
      // Test files in any ecosystem (mirrors TEST_PATTERNS above)
      { label: 'Test files', glob: /\.(?:test|spec)\.(?:mjs|cjs|[jt]sx?)$|(?:^|\/)test_[^/]+\.py$|[^/]+_test\.py$|_test\.go$|(?:Test|Spec|IT)\.(?:java|kt)$|(?:^|\/)tests?\/[^/]+\.(?:rs|py|rb|php)$|_(?:spec|test)\.rb$|Test\.php$/ },
      // Test runner configs: JS (jest/vitest/playwright/cypress), Python (pytest.ini/tox.ini), Rust (Cargo.toml has [[test]]),
      // Java (pom.xml/build.gradle), Go (no config file typically)
      { label: 'Test config', glob: /(?:jest|vitest|playwright|cypress|pytest|tox|phpunit)\.config|(?:^|\/)pytest\.ini$|(?:^|\/)tox\.ini$|(?:^|\/)phpunit\.xml$/ },
      { label: 'E2E / integration tests', glob: /(?:^|\/)(?:e2e|integration|tests?\/integration)\// },
    ],
  },
  'SECURITY.md': {
    standard: 'OWASP ASVS v4.0',
    sourcePatterns: [
      // Auth modules — semantic, language-agnostic
      { label: 'Auth modules', glob: /(?:auth|login|session|jwt|oauth|middleware|guard|csrf|cors|permissions?|policy)/i },
      // Secret configs — .env family + secrets.* / keyring patterns
      { label: 'Secret configs', glob: /\.env(?:\.|$)|(?:^|\/)secrets?\.(?:py|js|ts|yaml|yml|json)$|keyring/i },
      // Gitignore + ignore files
      { label: 'Ignore files', glob: /^\.(?:git|docker|npm)ignore$/ },
    ],
  },
  'ENVIRONMENT.md': {
    standard: '12-Factor App',
    sourcePatterns: [
      // .env family across all ecosystems
      { label: 'Env files', glob: /\.env(?:\.|$)|(?:^|\/)\.envrc$/ },
      // Containerization
      { label: 'Container configs', glob: /(?:^|\/)(?:Dockerfile|docker-compose|\.dockerignore|Containerfile)/ },
      // Python venv / requirements / lock files
      { label: 'Python env', glob: /(?:^|\/)(?:requirements[^/]*\.txt|Pipfile|poetry\.lock|uv\.lock|pyproject\.toml)$/ },
      // CI/CD configs
      { label: 'CI/CD configs', glob: /(?:^|\/)\.(?:github|gitlab-ci|circleci|drone|gitea)/ },
    ],
  },
  'API-REFERENCE.md': {
    standard: 'OpenAPI 3.1',
    sourcePatterns: [
      // Route handlers + Python views/urls + Java/Spring controllers
      { label: 'Route handlers', glob: /(?:^|\/)(?:routes?|controllers?|handlers?|views?|urls?\.py)/ },
      { label: 'Next.js API routes', glob: /(^|\/)(app|pages)\/api\// },
      // OpenAPI / API specs
      { label: 'API spec', glob: /(?:openapi|swagger|asyncapi)\.(?:json|ya?ml)/ },
      // Middleware / decorators
      { label: 'API middleware', glob: /(?:^|\/)middleware\/|decorators?\.py$/ },
    ],
  },
};
