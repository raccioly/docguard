/**
 * Honest coverage for fallback languages (specs/043-fallback-language-coverage).
 *
 * DocGuard reads JS/TS and Python with a syntax tree and every other language
 * by pattern, or not at all. On Go, Java/Spring and Ruby projects it reported
 * `checked` where it had seen nothing: routes carried no tier, env reads in
 * those languages were invisible, Spring's `com.example` package was dropped as
 * an examples directory, route discovery stopped at depth 5, and the symbol map
 * blamed the project for having no imports. Each case below builds a temporary
 * project, so nothing depends on this repository's state.
 *
 * @req docguard.fallback-language-coverage#FR-001
 * @req docguard.fallback-language-coverage#FR-002
 * @req docguard.fallback-language-coverage#FR-003
 * @req docguard.fallback-language-coverage#FR-004
 * @req docguard.fallback-language-coverage#FR-005
 * @req docguard.fallback-language-coverage#FR-006
 * @req docguard.fallback-language-coverage#FR-007
 * @req docguard.fallback-language-coverage#FR-008
 * @req docguard.fallback-language-coverage#FR-009
 * @req docguard.fallback-language-coverage#FR-010
 * @req docguard.fallback-language-coverage#FR-011
 * @req docguard.fallback-language-coverage#SC-001
 * @req docguard.fallback-language-coverage#SC-002
 * @req docguard.fallback-language-coverage#SC-003
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { grepEnvUsage, summarizeTiers, tierApplicability, tierFor } from '../cli/shared-source.mjs';
import { isNonProductDir, isNonProductPath } from '../cli/shared-ignore.mjs';
import { findRouteFiles, scanRoutesDeep } from '../cli/scanners/routes.mjs';
import { routeScanGaps } from '../cli/validators/api-surface.mjs';
import { validateEnvironment } from '../cli/validators/environment.mjs';
import { buildImportGraph, clearImportGraphCache } from '../cli/scanners/import-graph.mjs';
import { buildSymbolMap } from '../cli/scanners/symbol-map.mjs';
import { renderModuleGraph } from '../cli/scanners/module-diagram.mjs';
import { pyAstAvailable } from '../cli/scanners/py-ast.mjs';
import { detectEcosystems } from '../cli/scanners/project-type.mjs';
import { scanComponents } from '../cli/scanners/inventory.mjs';

const CLI = resolve('cli/docguard.mjs');
const NO_SPEC = { openapi: { found: false } };

function project(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-043-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

function run(dir, args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return r.stdout;
}
const guard = dir => JSON.parse(run(dir, ['guard', '--format', 'json']));
const validator = (data, key) => data.validators.find(v => v.key === key);

const DOCS = {
  '.docguard.json': JSON.stringify({ projectName: 'fx', profile: 'starter', validators: { apiSurface: true, environment: true } }),
  'docs-canonical/ARCHITECTURE.md': '# Architecture\n\nA service.\n',
  'docs-canonical/API-REFERENCE.md': '# API Reference\n\n## GET /nothing\n\nNothing.\n',
  'docs-canonical/ENVIRONMENT.md': '# Environment\n\n## Setup Steps\n\nRun it.\n\n## Environment Variables\n\n| Name | Purpose |\n|---|---|\n| `DATABASE_URL` | db |\n',
};

const goProject = (envName = 'DATABASE_URL') => ({
  ...DOCS,
  'go.mod': 'module github.com/acme/todo\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.1\n',
  'cmd/server/main.go': `package main

import (
	"os"
	"github.com/gin-gonic/gin"
)

func main() {
	dsn := os.Getenv("${envName}")
	_ = dsn
	r := gin.Default()
	r.GET("/todos", list)
	r.POST("/todos", create)
	r.Run()
}
`,
});

// A standard Maven layout: the controller sits seven directories deep, in
// Spring Initializr's default `com.example` package.
const SPRING_CONTROLLER = 'src/main/java/com/example/shop/web/ProductController.java';
const springProject = () => ({
  ...DOCS,
  'pom.xml': '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>\n',
  [SPRING_CONTROLLER]: `package com.example.shop.web;

@RestController
@RequestMapping("/api/products")
public class ProductController {
  private final String key = System.getenv("PAYMENT_API_KEY");
  @GetMapping("/{id}") public Product get() { return null; }
  @PostMapping public Product create() { return null; }
}
`,
});

const railsProject = () => ({
  ...DOCS,
  Gemfile: 'source "https://rubygems.org"\ngem "rails"\n',
  'config/routes.rb': "Rails.application.routes.draw do\n  get '/health', to: 'health#index'\nend\n",
  'app/services/billing.rb': 'class Billing\n  KEY = ENV["STRIPE_SECRET"]\nend\n',
});

describe('a pattern-only language is partial coverage (FR-001)', () => {
  it('names the language and the count, and says absence is weak evidence', () => {
    const summary = summarizeTiers([
      { ...tierFor('cmd/a.go', null), file: 'cmd/a.go' },
      { ...tierFor('cmd/b.go', null), file: 'cmd/b.go' },
    ]);
    assert.equal(summary.tier, 'fallback-language');
    const gap = tierApplicability(summary, 'source file');
    assert.equal(gap.status, 'partial');
    assert.match(gap.reason, /^Findings are retained; /);
    assert.match(gap.reason, /2 source files in Go/);
    assert.match(gap.reason, /no syntax tree/i);
    assert.match(gap.reason, /weak evidence/);
  });

  it('keeps the regex-fallback message byte for byte', () => {
    const gap = tierApplicability(summarizeTiers([{ tier: 'regex-fallback', tierReason: 'No usable python3.' }]), 'source file');
    assert.equal(gap.reason, 'Findings are retained; 1 source file read by the pattern fallback rather than a syntax tree, so absence of a finding there is weak evidence. No usable python3.');
  });

  it('names both causes when a scan mixes them', () => {
    const gap = tierApplicability(summarizeTiers([
      { tier: 'py-ast' },
      { tier: 'regex-fallback', tierReason: 'No usable python3.' },
      { ...tierFor('A.java', null), file: 'A.java' },
      { ...tierFor('b.rb', null), file: 'b.rb' },
    ]), 'source file');
    assert.equal(gap.status, 'partial');
    assert.match(gap.reason, /1 source file read by the pattern fallback/);
    assert.match(gap.reason, /2 source files in Java, Ruby/);
    assert.match(gap.reason, /python3/);
  });
});

describe('guard on Go, Spring and Rails projects (FR-001, FR-002, SC-001)', () => {
  for (const [name, files, language, route] of [
    ['Go (Gin)', goProject(), 'Go', 'GET /todos'],
    ['Java (Spring, Maven layout)', springProject(), 'Java', 'GET /api/products/{id}'],
    ['Ruby (Rails)', railsProject(), 'Ruby', 'GET /health'],
  ]) {
    it(`${name}: apiSurface is partial and its findings carry fallback-language`, t => {
      const data = guard(project(t, files));
      const api = validator(data, 'apiSurface');
      assert.equal(api.applicability.status, 'partial', JSON.stringify(api.applicability));
      assert.match(api.applicability.reason, new RegExp(language));
      const findings = data.findings.filter(f => f.code === 'API004' || f.code === 'API005');
      assert.ok(findings.some(f => f.message.includes(route)), `${route} is reported as undocumented`);
      assert.ok(findings.length > 0 && findings.every(f => f.parserTier === 'fallback-language'),
        findings.map(f => f.parserTier).join(','));
    });
  }

  it('every route from a pattern-only scanner carries the tier, and an empty scan still reports it', t => {
    const dir = project(t, { 'main.go': 'package main\nfunc main() { r.GET("/ping", ping) }\n', 'util.go': 'package main\n' });
    const routes = scanRoutesDeep(dir, { framework: 'Gin' }, NO_SPEC, { config: {} });
    assert.equal(routes.length, 1);
    assert.equal(routes[0].tier, 'fallback-language');
    assert.match(routes[0].tierReason, /\.go/);
    assert.equal(routes.scanTier.tier, 'fallback-language');
    assert.equal(routes.scanTier.degraded, 2, 'the scan tier counts every file read, not only routes');

    const empty = project(t, { 'main.go': 'package main\nfunc main() {}\n' });
    const none = scanRoutesDeep(empty, { framework: 'Gin' }, NO_SPEC, { config: {} });
    assert.equal(none.length, 0);
    assert.equal(none.scanTier.tier, 'fallback-language');
  });

  it('renaming a Go env var produces ENV003 carrying the tier; the unchanged name does not', t => {
    const clean = guard(project(t, goProject('DATABASE_URL')));
    assert.equal(clean.findings.filter(f => f.code === 'ENV003').length, 0);

    const renamed = guard(project(t, goProject('DB_URL')));
    const env = renamed.findings.filter(f => f.code === 'ENV003');
    assert.equal(env.length, 1);
    assert.match(env[0].message, /DB_URL/);
    assert.equal(env[0].parserTier, 'fallback-language');
  });

  it('diff no longer lists a Go-read variable as missing from code', t => {
    const out = JSON.parse(run(project(t, goProject('DATABASE_URL')), ['diff', '--format', 'json']));
    const env = out.find(r => r.title === 'Environment Variables');
    assert.deepEqual(env.onlyInDocs, []);
    assert.ok(env.matched.includes('DATABASE_URL'));
  });
});

describe('env reads in every supported language (FR-003)', () => {
  it('reads each language\'s own forms, in code only', t => {
    const dir = project(t, {
      'src/main.go': 'package main\nimport "os"\nfunc f() {\n  a := os.Getenv("GO_ONE")\n  b, _ := os.LookupEnv(`GO_TWO`)\n  // os.Getenv("GO_COMMENT")\n  s := "os.Getenv(\\"GO_STRING\\")"\n  x := ENV["NOT_RUBY"]\n}\n',
      'src/billing.rb': 'KEY = ENV["RB_ONE"]\nURL = ENV.fetch("RB_TWO", "x")\nR = ENV.fetch(\'RB_THREE\')\n# ENV["RB_COMMENT"]\n',
      'src/App.java': 'class App {\n  String a = System.getenv("JAVA_ONE");\n  @Value("${JAVA_TWO}") String b;\n  @Value("${JAVA_THREE:fallback}") String c;\n  /* System.getenv("JAVA_COMMENT") */\n}\n',
      'src/App.kt': 'val k = System.getenv("KT_ONE")\n',
      'src/Program.cs': 'var c = Environment.GetEnvironmentVariable("CS_ONE");\n',
      'src/index.php': "<?php\n$a = getenv('PHP_ONE');\n$b = $_ENV['PHP_TWO'];\n$c = env('PHP_THREE', 'x');\n",
      'src/main.rs': 'fn main() {\n  let a = env::var("RS_ONE");\n  let b = std::env::var_os("RS_TWO");\n}\n',
      'src/main/resources/application.yml': 'spring:\n  datasource:\n    url: ${SPRING_ONE}\n    password: "${SPRING_TWO:changeme}"\n# ${SPRING_COMMENT}\n    port: ${server.port}\n',
      'src/main/resources/application-prod.properties': 'server.port=${SPRING_THREE:8080}\n! ${SPRING_BANG_COMMENT}\n',
      'src/main/resources/bootstrap.yaml': 'x: ${SPRING_FOUR}\n',
      'src/main/resources/other.yml': 'x: ${NOT_SPRING_CONFIG}\n',
    });
    const names = [...grepEnvUsage(dir, {})].sort();
    assert.deepEqual(names, [
      'CS_ONE', 'GO_ONE', 'GO_TWO', 'JAVA_ONE', 'JAVA_THREE', 'JAVA_TWO', 'KT_ONE',
      'PHP_ONE', 'PHP_THREE', 'PHP_TWO', 'RB_ONE', 'RB_THREE', 'RB_TWO', 'RS_ONE', 'RS_TWO',
      'SPRING_FOUR', 'SPRING_ONE', 'SPRING_THREE', 'SPRING_TWO',
    ]);
  });
});

describe('a language with no env patterns is partial, never a pass (FR-004)', () => {
  const swift = () => ({ ...DOCS, 'src/App.swift': 'let k = ProcessInfo.processInfo.environment["SWIFT_KEY"]\n', 'src/main.go': 'package main\n' });

  it('Environment names the language and the count', t => {
    const dir = project(t, swift());
    const result = validateEnvironment(dir, {});
    assert.equal(result.applicability?.status, 'partial');
    assert.match(result.applicability.reason, /1 Swift file/);
    assert.deepEqual(grepEnvUsage(dir, {}).unscanned, [{ language: 'Swift', files: 1 }]);
  });

  it('diff prints the same limitation, and its JSON carries it', t => {
    const dir = project(t, swift());
    const env = JSON.parse(run(dir, ['diff', '--format', 'json'])).find(r => r.title === 'Environment Variables');
    assert.match(env.limitation, /Swift/);
    assert.match(run(dir, ['diff']), /Swift/);
  });

  it('a project whose languages all have patterns stays checked', t => {
    const result = validateEnvironment(project(t, goProject()), {});
    assert.equal(result.applicability, undefined);
    assert.equal(result.errors.length + result.warnings.length, 0);
  });
});

describe('the env scan follows Go and Rails layouts (FR-005)', () => {
  it('reads a Go module outside the conventional roots, and Rails config/*.rb', t => {
    const go = project(t, {
      'go.mod': 'module x\n',
      'api/openapi.yaml': 'openapi: 3.0.0\n',
      'cmd/server/main.go': 'package main\nimport "os"\nvar a = os.Getenv("GO_CMD")\n',
      'internal/db/db.go': 'package db\nimport "os"\nvar b = os.Getenv("GO_INTERNAL")\n',
    });
    assert.deepEqual([...grepEnvUsage(go, {})].sort(), ['GO_CMD', 'GO_INTERNAL']);

    const rails = project(t, {
      Gemfile: 'gem "rails"\n',
      'app/models/user.rb': 'class User; end\n',
      'config/initializers/stripe.rb': 'Stripe.api_key = ENV["CFG_STRIPE_KEY"]\n',
    });
    assert.deepEqual([...grepEnvUsage(rails, {})], ['CFG_STRIPE_KEY']);
  });

  it('adds nothing without the manifest', t => {
    const dir = project(t, {
      'src/index.js': 'export const a = 1;\n',
      'tools/gen/main.go': 'package main\nimport "os"\nvar a = os.Getenv("STRAY_GO")\n',
      'config/x.rb': 'A = ENV["STRAY_RB"]\n',
    });
    assert.deepEqual([...grepEnvUsage(dir, {})], []);
  });
});

describe('package segments are product code (FR-006)', () => {
  it('exempts JVM packages and Go internal packages, and nothing else', () => {
    for (const p of [
      SPRING_CONTROLLER,
      'src/main/kotlin/org/samples/App.kt',
      'app/src/main/java/com/example/App.java',
      'src/main/java/com/acme/tests/Helper.java',
      'internal/example/greeter.go',
      'lib/io/examples/codec.js',
    ]) assert.equal(isNonProductPath(p), false, p);
    for (const p of [
      'examples/demo/main.go',
      'example/main.go',
      'src/test/java/com/example/FooTest.java',
      'examples/demo/src/main/java/com/x/App.java',
      'tests/fixtures/app.js',
      'pkg/example/x.go',
    ]) assert.equal(isNonProductPath(p), true, p);
  });

  it('walkers apply the same rule through the parent path', () => {
    assert.equal(isNonProductDir('example'), true);
    assert.equal(isNonProductDir('example', {}, 'src/main/java/com'), false);
    assert.equal(isNonProductDir('example', {}, 'internal'), false);
    assert.equal(isNonProductDir('tests', {}, 'src'), true);
  });

  it('the env scan reads a Spring controller in com.example', t => {
    assert.deepEqual([...grepEnvUsage(project(t, springProject()), {})], ['PAYMENT_API_KEY']);
  });

  it('the manifest walk reads a nested Go module in internal/example, not one in examples/', t => {
    const dir = project(t, {
      'go.mod': 'module x\n',
      'internal/example/go.mod': 'module x/internal/example\n\nrequire github.com/gin-gonic/gin v1.9.1\n',
      'examples/demo/go.mod': 'module x/examples/demo\n\nrequire github.com/labstack/echo v4.0.0\n',
    });
    const dirs = detectEcosystems(dir, {}).map(e => e.dir).sort();
    assert.ok(dirs.includes('internal/example'), dirs.join(','));
    assert.ok(!dirs.some(d => d.startsWith('examples')), dirs.join(','));
  });

  it('the component inventory descends into a com/example package', t => {
    const maven = scanComponents(project(t, springProject()), {}).map(c => c.path);
    assert.ok(maven.includes('src/main/java/com/example'), maven.join(','));
    const wrapped = scanComponents(project(t, {
      'src/com/example/app/Main.kt': 'fun main() {}\n',
      'src/com/example/core/Core.kt': 'object Core\n',
    }), {}).map(c => c.path);
    assert.deepEqual(wrapped.sort(), ['src/com/example/app', 'src/com/example/core']);
  });
});

describe('routes found only in non-product paths are reported (FR-007)', () => {
  it('names the excluded count and the setting', t => {
    const data = guard(project(t, {
      ...DOCS,
      'go.mod': 'module x\n\nrequire github.com/gin-gonic/gin v1.9.1\n',
      'main.go': 'package main\nfunc main() {}\n',
      'tests/fixtures/app/main.go': 'package app\nfunc f() { r.GET("/fixture-only", h) }\n',
    }));
    const api = validator(data, 'apiSurface');
    assert.equal(api.applicability.status, 'partial');
    assert.match(api.applicability.reason, /1 route .*excluded/);
    assert.match(api.applicability.reason, /detection\.includeNonProduct/);
  });

  it('the shared-ignore comment describes what callers do', () => {
    const src = readFileSync(resolve('cli/shared-ignore.mjs'), 'utf8');
    const comment = src.slice(src.indexOf('Directory names that hold NON-PRODUCT code'), src.indexOf('export const DEFAULT_DETECTION_IGNORE_DIRS'));
    assert.doesNotMatch(comment, /SHOULD surface/);
    assert.match(comment, /API-surface/);
    assert.match(comment, /detection\.includeNonProduct/);
  });
});

describe('route discovery reaches Maven depth, within a disclosed cap (FR-008)', () => {
  it('finds a controller nine directories deep', t => {
    const dir = project(t, {
      'src/main/java/com/acme/billing/api/v1/web/controllers/InvoiceController.java':
        '@RestController\n@RequestMapping("/invoices")\npublic class InvoiceController {\n  @GetMapping public List<Invoice> all() { return null; }\n}\n',
    });
    const routes = scanRoutesDeep(dir, { framework: 'Spring Boot' }, NO_SPEC, { config: {} });
    assert.deepEqual(routes.map(r => `${r.method} ${r.path}`), ['GET /invoices']);
  });

  it('stops at the file cap and says so', t => {
    const files = {};
    for (let i = 0; i < 5; i++) files[`src/C${i}.java`] = `@GetMapping("/c${i}") void c() {}\n`;
    const dir = project(t, files);
    const found = findRouteFiles(dir, /\.java$/, { maxFiles: 3 });
    assert.equal(found.length, 3);
    assert.equal(found.truncated, true);
    const routes = scanRoutesDeep(dir, { framework: 'Spring Boot' }, NO_SPEC, { config: {}, maxFiles: 3 });
    assert.equal(routes.scan.truncated, true);
    assert.ok(routeScanGaps(routes.scan, routes.length).some(r => /cap/.test(r)));
  });
});

describe('a detected framework with no route is not a pass (FR-009)', () => {
  const unmatched = () => ({
    ...DOCS,
    'pom.xml': '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>\n',
    'src/main/java/com/acme/Legacy.java': '@Controller\npublic class Legacy {\n  @RequestMapping(value = "/legacy", method = RequestMethod.GET) public String x() { return ""; }\n}\n',
  });

  it('reports partial, naming the framework and the files read', t => {
    const api = validator(guard(project(t, unmatched())), 'apiSurface');
    assert.equal(api.applicability.status, 'partial');
    assert.match(api.applicability.reason, /Spring Boot/);
    assert.match(api.applicability.reason, /no route/);
    assert.match(api.applicability.reason, /1 file/);
  });

  it('without an API reference doc it stays missing-prerequisite', t => {
    const files = unmatched();
    delete files['docs-canonical/API-REFERENCE.md'];
    assert.equal(validator(guard(project(t, files)), 'apiSurface').applicability.status, 'missing-prerequisite');
  });
});

describe('unanalysed languages are named, not blamed (FR-010)', () => {
  it('a Go and Java project: the symbol map and module graph say the language is not analysed', t => {
    const dir = project(t, { ...goProject(), 'svc/App.java': 'class App {}\n' });
    clearImportGraphCache();
    const map = buildSymbolMap(dir, {}).text;
    assert.doesNotMatch(map, /No import edges were found/);
    assert.doesNotMatch(map, /_No ranked source files\._/);
    assert.match(map, /not analysed/);
    assert.match(map, /1 Go file/);
    assert.match(map, /1 Java file/);

    const graph = renderModuleGraph(buildImportGraph(dir, {}), {});
    assert.doesNotMatch(graph.body, /_No source modules found for the module graph\._/);
    assert.match(graph.body, /not analysed/);
    assert.match(graph.body, /Go/);
  });

  it('a JS project with Go files keeps its ranking and diagram, and adds one line', t => {
    const dir = project(t, {
      'package.json': '{"name":"x","type":"module"}\n',
      'src/a.mjs': "import { b } from './b.mjs';\nexport const a = b;\n",
      'src/b.mjs': 'export const b = 1;\n',
      'src/tool/main.go': 'package main\n',
    });
    clearImportGraphCache();
    const map = buildSymbolMap(dir, {}).text;
    assert.match(map, /- `src\/b\.mjs`: b/);
    assert.match(map, /_Not analysed: 1 Go file \(the import graph reads JS\/TS and Python only\)\._/);
    const graph = renderModuleGraph(buildImportGraph(dir, {}), {});
    assert.match(graph.body, /```mermaid/);
    assert.match(graph.body, /1 Go file is not analysed/);
    assert.equal(graph.completeness, 'complete', 'a code-dependent gap is captioned, not partial');
  });
});

describe('JS and Python projects are unchanged (SC-002)', () => {
  it('Express: apiSurface checked, findings keep their tier, env checked', t => {
    const data = guard(project(t, {
      ...DOCS,
      'package.json': '{"name":"x","dependencies":{"express":"4.0.0"}}\n',
      'src/app.js': "const app = require('express')();\nconst db = process.env.DATABASE_URL;\napp.get('/nothing', h);\napp.post('/orders', h);\n",
    }));
    assert.equal(validator(data, 'apiSurface').applicability.status, 'checked');
    assert.equal(validator(data, 'environment').applicability.status, 'checked');
    const api5 = data.findings.filter(f => f.code === 'API005');
    assert.equal(api5.length, 1);
    assert.equal(api5[0].parserTier, 'not-applicable');
  });

  it('Flask read with a syntax tree: checked, py-ast', { skip: pyAstAvailable() ? false : 'no python3 on this host' }, t => {
    const data = guard(project(t, {
      ...DOCS,
      'requirements.txt': 'flask\n',
      'src/main.py': 'import os\nfrom flask import Flask\napp = Flask(__name__)\nDB = os.environ["DATABASE_URL"]\n\n@app.route("/nothing")\ndef n():\n    return ""\n\n@app.route("/orders", methods=["POST"])\ndef o():\n    return ""\n',
    }));
    assert.equal(validator(data, 'apiSurface').applicability.status, 'checked');
    assert.equal(validator(data, 'environment').applicability.status, 'checked');
    assert.ok(data.findings.filter(f => f.code === 'API005').every(f => f.parserTier === 'py-ast'));
  });
});

describe('a project shaped like this repository is unchanged (SC-003)', () => {
  it('needsEnvVars:false and a module-graph include keep coverage and bytes', t => {
    const config = { projectTypeConfig: { needsEnvVars: false, needsEnvExample: false }, diagrams: { moduleGraph: { include: ['cli'] } } };
    const dir = project(t, {
      ...DOCS,
      '.docguard.json': JSON.stringify({ projectName: 'shape', profile: 'starter', ...config }),
      'package.json': '{"name":"shape","type":"module"}\n',
      'cli/main.mjs': "import { x } from './lib/x.mjs';\nexport const y = x;\n",
      'cli/lib/x.mjs': 'export const x = 1;\n',
      'packaging/homebrew/formula.rb': 'class Formula\n  url ENV["HOMEBREW_URL"]\nend\n',
      'packaging/App.swift': 'let x = 1\n',
    });
    assert.equal(validateEnvironment(dir, config).applicability, undefined);
    clearImportGraphCache();
    const graph = renderModuleGraph(buildImportGraph(dir, config), config);
    assert.doesNotMatch(graph.body, /not analysed/);
    assert.equal(graph.body, '```mermaid\ngraph LR\n  m_cli["cli"]\n  m_cli_lib["cli/lib"]\n  m_cli --> m_cli_lib\n```');
  });
});

describe('docs describe the behaviour (FR-011)', () => {
  const read = p => readFileSync(resolve(p), 'utf8');

  it('README, ARCHITECTURE, DATA-MODEL, the schema, explain, ENV003 help and CHANGELOG', () => {
    const readme = read('README.md');
    const tierParagraph = readme.slice(readme.indexOf('**`parserTier`**'), readme.indexOf('Every channel appears on every finding'));
    assert.match(tierParagraph, /fallback-language/);
    assert.match(tierParagraph, /Go, Java/);
    assert.match(tierParagraph, /partial/);

    const arch = read('docs-canonical/ARCHITECTURE.md');
    const row = arch.split('\n').find(l => l.startsWith('| **Analyzer tier**'));
    assert.doesNotMatch(row, /not a gap/);
    assert.match(row, /fallback-language/);

    assert.match(read('docs-canonical/DATA-MODEL.md'), /`detection\.includeNonProduct`/);
    const schema = JSON.parse(read('schemas/docguard-config.schema.json'));
    assert.equal(schema.properties.detection.properties.includeNonProduct.type, 'boolean');

    assert.match(read('cli/commands/explain.mjs'), /os\.Getenv/);
    assert.match(read('cli/findings.mjs'), /System\.getenv/);

    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## [Unreleased]'), changelog.indexOf('\n## [', changelog.indexOf('## [Unreleased]') + 5));
    assert.match(unreleased, /specs\/043-fallback-language-coverage/);
  });
});
