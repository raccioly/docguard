/**
 * Coverage follow-ups from specs 056–061 (spec 063).
 *
 * Each block reproduces one reported defect on a scratch project written to a
 * fresh temp dir; nothing here reads repository state.
 *
 * @req docguard.coverage-followups#FR-001
 * @req docguard.coverage-followups#FR-002
 * @req docguard.coverage-followups#FR-003
 * @req docguard.coverage-followups#FR-004
 * @req docguard.coverage-followups#FR-005
 * @req docguard.coverage-followups#FR-006
 * @req docguard.coverage-followups#FR-007
 * @req docguard.coverage-followups#FR-008
 * @req docguard.coverage-followups#FR-009
 * @req docguard.coverage-followups#FR-010
 * @req docguard.coverage-followups#SC-001
 * @req docguard.coverage-followups#SC-002
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildMemoryPlan } from '../cli/scanners/memory-plan.mjs';
import { scanRoutesDeep, findRouteFiles } from '../cli/scanners/routes.mjs';
import { detectProjectProfile } from '../cli/scanners/project-type.mjs';
import { scanSchemasDeep } from '../cli/scanners/schemas.mjs';
import { walkFiles, relPosix } from '../cli/shared-ignore.mjs';
import { grepEnvUsage, summarizeTiers, tierFor } from '../cli/shared-source.mjs';
import * as sharedSource from '../cli/shared-source.mjs';
import { pyAstAvailable } from '../cli/scanners/py-ast.mjs';
import { NEST_FILES, UNPARSEABLE } from './fixtures/js-framework-projects.mjs';
import { symlinkSync } from 'node:fs';
import { scanTestInventory } from '../cli/scanners/inventory.mjs';
import { validateApiSurface } from '../cli/validators/api-surface.mjs';
import { compareEndpoints } from '../cli/scanners/api-doc.mjs';
import { diffRoutes, diffEntities, diffEnvVars } from '../cli/commands/diff.mjs';
import * as techStack from '../cli/scanners/tech-stack.mjs';

const { scanCodeTechnologies, TECH_PATTERNS } = techStack;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');

const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-063-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

const cli = (dir, args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, input: '', timeout: 60000,
  });
  // eslint-disable-next-line no-control-regex
  return { ...r, stdout: String(r.stdout || '').replace(/\x1b\[[0-9;]*m/g, '') };
};
const jsonOut = r => JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
const key = r => `${r.method} ${r.path}`;
const routesOf = dir => scanRoutesDeep(dir, { framework: detectProjectProfile(dir, {}).frameworks.join(' ') }, {}, { config: {} });
const noCache = { diskCache: false };

const GO_MOD = 'module example.com/shop\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.1\n';
const GIN_MAIN = `package main

import "github.com/gin-gonic/gin"

type User struct {
	ID   int    \`json:"id"\`
	Name string \`json:"name"\`
}

func main() {
	r := gin.Default()
	r.GET("/health", health)
	r.GET("/users/:id", getUser)
	r.Run()
}
`;
const GIN = { 'go.mod': GO_MOD, 'cmd/api/main.go': GIN_MAIN };
const HONO = {
  'package.json': JSON.stringify({ name: 'web', dependencies: { hono: '4.0.0' } }),
  'src/app.ts': "import { Hono } from 'hono';\nconst app = new Hono();\napp.get('/ping', c => c.text('pong'));\nexport default app;\n",
};

// ── FR-001: the plan says what was read by pattern ───────────────────────────

describe('generate --plan reports pattern-read surfaces (FR-001)', () => {
  it('a Go project: patternRead with the language, not degraded, sections partial, no install hint', () => {
    const plan = buildMemoryPlan(project(GIN), noCache);
    const tiers = plan.surface.parserTiers;
    assert.equal(tiers.endpoints.tier, 'fallback-language');
    assert.equal(tiers.endpoints.degraded, false);
    assert.equal(tiers.endpoints.patternRead, true);
    assert.deepEqual(tiers.endpoints.patternLanguages, ['Go']);
    assert.equal(tiers.entities.patternRead, true, 'Go structs carry their file tier');
    assert.equal(tiers.degraded, false);
    assert.equal(tiers.patternRead, true);
    const endpoints = plan.docs.flatMap(d => d.sections).find(s => s.id === 'endpoints');
    assert.equal(endpoints.completeness, 'partial');
    assert.match(endpoints.partialReason, /no parser exists for Go/i);
    assert.ok(plan.notes.some(n => /no parser/i.test(n) && /Go/.test(n)), plan.notes.join('\n'));
    assert.ok(!plan.notes.some(n => /python3/.test(n)), plan.notes.join('\n'));
  });

  it('JSON and text output carry it; surface confidence is not lowered by pattern-only languages', () => {
    const dir = project(GIN);
    const out = jsonOut(cli(dir, ['generate', '--plan', '--format', 'json']));
    assert.equal(out.surface.parserTiers.endpoints.patternRead, true);
    assert.equal(out.surface.parserTiers.patternRead, true);
    assert.notEqual(out.surface.confidence, 'low');
    const text = cli(dir, ['generate', '--plan']).stdout;
    assert.match(text, /read by pattern/i);
  });

  it('a parsed language plus a pattern-only one is not degraded', () => {
    const plan = buildMemoryPlan(project({ ...HONO, ...GIN }), noCache);
    const tiers = plan.surface.parserTiers;
    assert.equal(tiers.endpoints.tier, 'mixed');
    assert.equal(tiers.endpoints.degraded, false);
    assert.equal(tiers.endpoints.patternRead, true);
    assert.equal(tiers.degraded, false);
    assert.ok(!plan.notes.some(n => /python3/.test(n)), plan.notes.join('\n'));
  });

  it('a JavaScript-only project is neither degraded nor pattern-read', () => {
    const tiers = buildMemoryPlan(project(HONO), noCache).surface.parserTiers;
    assert.equal(tiers.degraded, false);
    assert.equal(tiers.patternRead, false);
  });
});

// ── FR-002: build output is not source ───────────────────────────────────────

const CSPROJ = '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>\n';
const USERS_CONTROLLER = `using Microsoft.AspNetCore.Mvc;

namespace Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok();

    [HttpGet("{id}")]
    public IActionResult Get(int id) => Ok();
}
`;
const ASPNET = { 'Api/Api.csproj': CSPROJ, 'Api/Controllers/UsersController.cs': USERS_CONTROLLER };

describe('build output directories are skipped (FR-002)', () => {
  const BUILD_OUTPUT = {
    ...ASPNET,
    'Api/obj/Debug/net8.0/Api.GlobalUsings.g.cs': 'global using global::System;\n',
    'Api/obj/Debug/net8.0/Api.AssemblyInfo.cs': '[assembly: System.Reflection.AssemblyTitle("Api")]\n',
    'Api/bin/Release/net8.0/publish/wwwroot/js/site.js': 'const key = process.env.PUBLISH_ONLY_KEY;\n',
    'Api/bin/Release/net8.0/publish/wwwroot/js/site.test.js': "it('x', () => {});\n",
    '_build/dev/lib/app.js': 'const x = process.env.MIX_BUILD_KEY;\n',
    'tools/bin/cli.js': '#!/usr/bin/env node\nconst home = process.env.CLI_HOME;\n',
    'tools/bin/cli.test.js': "it('runs', () => {});\n",
    'tools/package.json': JSON.stringify({ name: 'tools', bin: { tool: 'bin/cli.js' } }),
  };

  it('the shared walker skips obj/, _build/ and a bin/ beside a .NET project, and keeps any other bin/', () => {
    const dir = project(BUILD_OUTPUT);
    const seen = [];
    walkFiles(dir, abs => seen.push(relPosix(dir, abs)));
    assert.ok(!seen.some(f => f.startsWith('Api/obj/')), seen.join(', '));
    assert.ok(!seen.some(f => f.startsWith('Api/bin/')), seen.join(', '));
    assert.ok(!seen.some(f => f.startsWith('_build/')), seen.join(', '));
    assert.ok(seen.includes('tools/bin/cli.js'));
  });

  it('the route walker does not read generated .cs files', () => {
    const dir = project(BUILD_OUTPUT);
    const files = findRouteFiles(dir, /\.cs$/).map(f => relPosix(dir, f));
    assert.deepEqual(files, ['Api/Controllers/UsersController.cs']);
    assert.equal(routesOf(dir).scan.files, 1);
  });

  it('the env walk and the test inventory skip .NET output', () => {
    const dir = project({
      'Api.csproj': CSPROJ,
      'Program.cs': 'var key = Environment.GetEnvironmentVariable("API_KEY");\n',
      'bin/Release/net8.0/publish/wwwroot/js/site.js': 'const key = process.env.PUBLISH_ONLY_KEY;\n',
      'bin/Release/net8.0/publish/wwwroot/js/site.test.js': "it('x', () => {});\n",
      'obj/Debug/net8.0/Api.AssemblyInfo.cs': 'var v = Environment.GetEnvironmentVariable("GENERATED_ONLY");\n',
    });
    const env = [...grepEnvUsage(dir, {})];
    assert.deepEqual(env, ['API_KEY']);
    assert.deepEqual(scanTestInventory(dir, {}).files, []);
  });

  it('the env walk and the test inventory still read a Node bin/', () => {
    const dir = project({
      'package.json': JSON.stringify({ name: 'tool', bin: { tool: 'bin/cli.js' } }),
      'bin/cli.js': '#!/usr/bin/env node\nconst home = process.env.CLI_HOME;\n',
      'bin/cli.test.js': "it('runs', () => {});\n",
    });
    assert.deepEqual([...grepEnvUsage(dir, {})], ['CLI_HOME']);
    assert.deepEqual(scanTestInventory(dir, {}).files.map(f => f.file), ['bin/cli.test.js']);
  });

  it('the model walker skips .NET output and _build/', () => {
    const model = name => `package models\n\ntype ${name} struct {\n\tID int \`gorm:"primaryKey" json:"id"\`\n}\n`;
    const dir = project({
      'Api.csproj': CSPROJ,
      'go.mod': GO_MOD,
      'models/user.go': model('User'),
      'bin/Debug/net8.0/gen/ghost.go': model('Ghost'),
      'obj/gen/phantom.go': model('Phantom'),
      '_build/gen/shadow.go': model('Shadow'),
    });
    const names = scanSchemasDeep(dir, {}, {}, {}).entities.map(e => e.name);
    assert.deepEqual(names, ['User']);
  });
});

// ── FR-003: ASP.NET Core routes compare case-insensitively ───────────────────

const API_DOC = '# API Reference\n\n#### GET `/api/users`\n\n#### GET `/api/users/{id}`\n';

describe('ASP.NET Core routes match case-insensitively (FR-003)', () => {
  it('the reader marks its routes', () => {
    const routes = routesOf(project(ASPNET));
    assert.deepEqual(routes.map(key).sort(), ['GET /api/Users', 'GET /api/Users/{id}']);
    assert.ok(routes.every(r => r.caseInsensitive === true));
  });

  it('guard reports no gap for a lower-case document', () => {
    const dir = project({ ...ASPNET, 'docs-canonical/API-REFERENCE.md': API_DOC });
    const result = validateApiSurface(dir, {});
    const api004 = [...(result.errors || []), ...(result.warnings || [])].filter(f => /API004|Undocumented endpoint|documented/i.test(typeof f === 'string' ? f : f.message || ''));
    assert.deepEqual(api004, []);
    assert.equal(result.passed, 2);
  });

  it('diff reports both endpoints matched', () => {
    const dir = project({ ...ASPNET, 'docs-canonical/API-REFERENCE.md': API_DOC });
    const r = diffRoutes(dir, {});
    assert.deepEqual(r.onlyInDocs, []);
    assert.deepEqual(r.onlyInCode, []);
    assert.equal(r.matched.length, 2);
  });

  it('an unmarked route still compares exactly', () => {
    const cmp = compareEndpoints([{ method: 'GET', path: '/api/users' }], [{ method: 'GET', path: '/api/Users' }]);
    assert.equal(cmp.matched.length, 0);
    const marked = compareEndpoints([{ method: 'GET', path: '/api/users' }], [{ method: 'GET', path: '/api/Users', caseInsensitive: true }]);
    assert.equal(marked.matched.length, 1);
    assert.deepEqual(marked.presentButUndocumented, []);
  });

  it('Spring and Laravel stay case-sensitive', () => {
    const spring = project({
      'pom.xml': '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>\n',
      'src/main/java/com/example/web/UserController.java': 'package com.example.web;\n\n@RestController\n@RequestMapping("/api/Users")\npublic class UserController {\n  @GetMapping public List<User> list() { return null; }\n}\n',
      'docs-canonical/API-REFERENCE.md': '#### GET `/api/users`\n',
    });
    const s = diffRoutes(spring, {});
    assert.deepEqual(s.onlyInDocs, ['GET /api/users']);
    assert.deepEqual(s.onlyInCode, ['GET /api/Users']);

    const laravel = project({
      'composer.json': JSON.stringify({ require: { 'laravel/framework': '^10.10' } }),
      'routes/web.php': "<?php\n\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::get('/Users', [UserController::class, 'index']);\n",
      'docs-canonical/API-REFERENCE.md': '#### GET `/users`\n',
    });
    const l = diffRoutes(laravel, {});
    assert.deepEqual(l.onlyInDocs, ['GET /users']);
    assert.deepEqual(l.onlyInCode, ['GET /Users']);
  });
});

// ── FR-004: Python limitations lower coverage ────────────────────────────────

const STARLETTE = {
  'requirements.txt': 'starlette\n',
  'app.py': 'from starlette.applications import Starlette\nfrom starlette.routing import Route\nimport os\napp = Starlette(routes=[Route(os.environ["P"], f), Route("/ok", f)])\n',
  'docs-canonical/API-REFERENCE.md': '#### GET `/ok`\n',
};

describe('Python route limitations reach API-surface coverage (FR-004)', () => {
  it('an unresolved path makes coverage partial with the framework, count and location', () => {
    const dir = project(STARLETTE);
    const routes = routesOf(dir);
    assert.ok(routes.limitations.some(l => l.code === 'python-unresolved-route-path'), 'routes.limitations still lists it');
    assert.deepEqual(routes.scan.unresolved.map(u => [u.framework, u.file, u.line, u.code]), [['Starlette', 'app.py', 4, 'python-unresolved-route-path']]);
    const result = validateApiSurface(dir, {});
    assert.equal(result.applicability?.status, 'partial');
    assert.match(result.applicability.reason, /1 Starlette route/);
    assert.match(result.applicability.reason, /app\.py:4/);
  });

  it('a limitation in a test or example file does not count', () => {
    const dir = project({
      ...STARLETTE,
      'app.py': 'from starlette.applications import Starlette\nfrom starlette.routing import Route\napp = Starlette(routes=[Route("/ok", f)])\n',
      'examples/demo.py': 'from starlette.applications import Starlette\nfrom starlette.routing import Route\nimport os\ndemo = Starlette(routes=[Route(os.environ["P"], f)])\n',
    });
    const routes = routesOf(dir);
    assert.deepEqual(routes.scan.unresolved, []);
    assert.notEqual(validateApiSurface(dir, {}).applicability?.status, 'partial');
  });

  it('a Django include that cannot be resolved is labelled Django', () => {
    const dir = project({
      'requirements.txt': 'django\n',
      'manage.py': 'import os\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "site_cfg.settings")\n',
      'site_cfg/__init__.py': '',
      'site_cfg/settings.py': 'ROOT_URLCONF = "site_cfg.urls"\n',
      'site_cfg/urls.py': 'from django.urls import path, include\nurlpatterns = [path("oauth/", include("social_django.urls")), path("ok/", view)]\n',
    });
    const unresolved = routesOf(dir).scan.unresolved;
    assert.ok(unresolved.some(u => u.framework === 'Django' && u.code === 'django-unresolved-include'), JSON.stringify(unresolved));
  });
});

// ── FR-005: every vocabulary name has a detection path ───────────────────────

describe('tech-stack vocabulary detection (FR-005)', () => {
  it('every technology in the vocabulary has a Node dependency or a universal signal', () => {
    const mapped = new Set([...Object.values(techStack.TECH_DEPENDENCIES || {}), ...(techStack.UNIVERSAL_TECH || [])]);
    assert.deepEqual(TECH_PATTERNS.filter(t => !mapped.has(t)), []);
  });

  for (const [dep, tech] of [['@angular/core', 'Angular'], ['svelte', 'Svelte'], ['@sveltejs/kit', 'Svelte'],
    ['mongodb', 'MongoDB'], ['mysql', 'MySQL'], ['postgres', 'PostgreSQL']]) {
    it(`${dep} is detected as ${tech}`, () => {
      const dir = project({ 'package.json': JSON.stringify({ dependencies: { [dep]: '1.0.0' } }) });
      assert.deepEqual(scanCodeTechnologies(dir, {}).evidence.map(e => e.tech), [tech]);
    });
  }

  it('a documented Angular or Svelte project gets no "documented but not found"', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { '@angular/core': '17.0.0', svelte: '4.0.0' } }),
      'docs-canonical/ARCHITECTURE.md': '# Architecture\n\n## Tech Stack\n\n- Angular\n- Svelte\n',
    });
    const out = cli(dir, ['diff', '--format', 'json']).stdout;
    const tech = JSON.parse(out.slice(out.indexOf('['))).find(x => x.title === 'Tech Stack');
    assert.deepEqual(tech.onlyInDocs, []);
    assert.deepEqual(tech.matched.sort(), ['Angular', 'Svelte']);
  });
});

// ── FR-006: diff reads the mapped documents ──────────────────────────────────

describe('diff resolves document roles (FR-006)', () => {
  const files = {
    'package.json': JSON.stringify({ dependencies: { express: '4.0.0', '@prisma/client': '5.0.0' } }),
    'src/app.js': "const express = require('express');\nconst app = express();\napp.get('/health', (req, res) => res.send(process.env.APP_SECRET));\n",
    'prisma/schema.prisma': 'model Account {\n  id Int @id\n}\n',
    '.env.example': 'APP_SECRET=\n',
    'docs/api.md': '#### GET `/health`\n',
    'docs/model.md': '### Account\n',
    'docs/env.md': '`APP_SECRET`\n',
  };
  const config = { docs: { roles: { apiReference: 'docs/api.md', dataModel: 'docs/model.md', environment: 'docs/env.md' } } };

  it('routes, entities and environment variables come from the mapped files', () => {
    const dir = project(files);
    const routes = diffRoutes(dir, config);
    assert.ok(routes, 'route section runs');
    assert.deepEqual(routes.matched, ['GET /health']);
    const entities = diffEntities(dir, config);
    assert.ok(entities, 'entity section runs');
    assert.deepEqual(entities.matched, ['account']);
    const env = diffEnvVars(dir, config);
    assert.ok(env, 'environment section runs');
    assert.deepEqual(env.matched, ['APP_SECRET']);
  });

  it('a nested canonical document is found when the default path is missing', () => {
    const dir = project({ ...files, 'docs-canonical/04-api/API-REFERENCE.md': '#### GET `/health`\n' });
    assert.deepEqual(diffRoutes(dir, {}).matched, ['GET /health']);
  });
});

// ── FR-007: generate --spec confidence ───────────────────────────────────────

describe('generate --spec keeps its confidence for pattern-only languages (FR-007)', () => {
  it('an area with parsed JavaScript routes and Go routes is not low confidence', () => {
    const dir = project({
      ...HONO,
      'go.mod': GO_MOD,
      'src/api/main.go': GIN_MAIN,
    });
    const r = jsonOut(cli(dir, ['generate', '--spec', 'src', '--format', 'json']));
    assert.ok(r.facts.some(f => f.kind === 'route' && f.tier === 'js-ast'), JSON.stringify(r.facts));
    assert.ok(r.facts.some(f => f.kind === 'route' && f.tier === 'fallback-language'), JSON.stringify(r.facts));
    assert.equal(r.confidence, 'high');
    assert.deepEqual(r.notes, []);
  });
});

// ── FR-008: docs ─────────────────────────────────────────────────────────────

describe('documentation (FR-008)', () => {
  it('the user docs describe the new fields and rules', () => {
    const read = rel => readFileSync(join(ROOT, rel), 'utf8');
    assert.match(read('docs/commands.md'), /patternRead/);
    assert.match(read('docs/reference/languages.md'), /patternRead/);
    assert.match(read('docs/reference/languages.md'), /case-insensitive/i);
    assert.match(read('docs/reference/languages.md'), /### Case-sensitive route matching[\s\S]*Express[\s\S]*caseSensitive[\s\S]*Koa[\s\S]*sensitive: true[\s\S]*Fastify[\s\S]*NestJS/);
    assert.match(read('docs/reference/languages.md'), /@babel\/parser. loads/);
    assert.match(read('docs/configuration.md'), /`obj`/);
    assert.match(read('docs/configuration.md'), /\.csproj/);
  });
});

// ── FR-009: Express, Koa, Fastify and NestJS case sensitivity ────────────────

const caseOf = routes => Object.fromEntries(routes.map(r => [key(r), r.caseInsensitive === true]).sort(([a], [b]) => a.localeCompare(b)));
const expressPkg = { 'package.json': JSON.stringify({ dependencies: { express: '5.1.0' } }) };
const EXPRESS_ROUTER = "const express = require('express');\nconst router = express.Router();\nrouter.get('/List', (req, res) => res.send('x'));\nmodule.exports = router;\n";
const expressApp = (setting = '') => "const express = require('express');\nconst items = require('./routes/items');\nconst app = express();\n" +
  setting + "app.get('/Users', (req, res) => res.send('x'));\napp.use('/API', items);\napp.listen(3000);\n";

describe('Express, Koa, Fastify and NestJS route case sensitivity (FR-009)', () => {
  it('Express matches ignoring case by default, through a mount', () => {
    const dir = project({ ...expressPkg, 'src/app.js': expressApp(), 'src/routes/items.js': EXPRESS_ROUTER,
      'docs-canonical/API-REFERENCE.md': '#### GET `/users`\n\n#### GET `/api/list`\n' });
    assert.deepEqual(caseOf(routesOf(dir)), { 'GET /API/List': true, 'GET /Users': true });
    const r = diffRoutes(dir, {});
    assert.deepEqual(r.onlyInDocs, []);
    assert.deepEqual(r.onlyInCode, []);
  });

  for (const [label, setting] of [['app.set(..., true)', "app.set('case sensitive routing', true);\n"], ['app.enable(...)', "app.enable('case sensitive routing');\n"]]) {
    it(`${label} makes the app's routes and the prefixes it matches case-sensitive`, () => {
      const dir = project({ ...expressPkg, 'src/app.js': expressApp(setting), 'src/routes/items.js': EXPRESS_ROUTER });
      assert.deepEqual(caseOf(routesOf(dir)), { 'GET /API/List': false, 'GET /Users': false });
    });
  }

  it('app.disable(...) and app.set(..., false) keep the default', () => {
    const dir = project({ ...expressPkg, 'src/app.js': expressApp("app.disable('case sensitive routing');\n"), 'src/routes/items.js': EXPRESS_ROUTER });
    assert.deepEqual(caseOf(routesOf(dir)), { 'GET /API/List': true, 'GET /Users': true });
  });

  it('Router({ caseSensitive: true }) is case-sensitive; the app keeps its own setting', () => {
    const dir = project({ ...expressPkg, 'src/app.js': expressApp(),
      'src/routes/items.js': EXPRESS_ROUTER.replace('express.Router()', 'express.Router({ caseSensitive: true })') });
    assert.deepEqual(caseOf(routesOf(dir)), { 'GET /API/List': false, 'GET /Users': true });
  });

  it('a setting that is not a literal leaves the routes case-sensitive and is noted', () => {
    const dir = project({ ...expressPkg, 'src/app.js': expressApp("app.set('case sensitive routing', process.env.CS === '1');\n"),
      'src/routes/items.js': EXPRESS_ROUTER, 'docs-canonical/API-REFERENCE.md': '#### GET `/users`\n' });
    const routes = routesOf(dir);
    assert.deepEqual(caseOf(routes), { 'GET /API/List': false, 'GET /Users': false });
    assert.deepEqual(routes.scan.caseNotes.map(n => [n.framework, n.file, n.line]), [['Express', 'src/app.js', 4]]);
    assert.match(diffRoutes(dir, {}).limitation, /Express src\/app\.js:4/);
  });

  it('Koa routers match ignoring case unless sensitive: true; unreadable options are case-sensitive', () => {
    const koa = (opts) => ({
      'package.json': JSON.stringify({ dependencies: { koa: '2.15.0', '@koa/router': '12.0.1' } }),
      'src/server.js': `const Koa = require('koa');\nconst Router = require('@koa/router');\nconst app = new Koa();\nconst router = new Router(${opts});\nrouter.get('/Users', ctx => {});\napp.use(router.routes());\n`,
    });
    assert.deepEqual(caseOf(routesOf(project(koa('')))), { 'GET /Users': true });
    assert.deepEqual(caseOf(routesOf(project(koa('{ sensitive: true }')))), { 'GET /Users': false });
    assert.deepEqual(caseOf(routesOf(project(koa('{ prefix: "" }')))), { 'GET /Users': true });
    const unread = routesOf(project(koa('options')));
    assert.deepEqual(caseOf(unread), { 'GET /Users': false });
    assert.equal(unread.scan.caseNotes[0].framework, 'Koa');
  });

  it('Fastify is case-sensitive unless the server sets caseSensitive: false', () => {
    const fastify = (opts) => ({
      'package.json': JSON.stringify({ dependencies: { fastify: '5.2.1' } }),
      'src/server.js': `const fastify = require('fastify')(${opts});\nfastify.get('/Users', async () => ({}));\nfastify.listen({ port: 3000 });\n`,
    });
    assert.deepEqual(caseOf(routesOf(project(fastify('')))), { 'GET /Users': false });
    assert.deepEqual(caseOf(routesOf(project(fastify('{ caseSensitive: false }')))), { 'GET /Users': true });
  });

  it('NestJS follows its adapter: Express by default, Fastify case-sensitive', () => {
    const express = routesOf(project(NEST_FILES));
    assert.ok(express.length > 0 && express.every(r => r.caseInsensitive === true));
    const pkg = JSON.parse(NEST_FILES['package.json']);
    pkg.dependencies['@nestjs/platform-fastify'] = '10.3.8';
    const fastify = routesOf(project({ ...NEST_FILES, 'package.json': JSON.stringify(pkg) }));
    assert.ok(fastify.length > 0 && fastify.every(r => !r.caseInsensitive));
  });

  it('Hono and Next.js routes are never marked', () => {
    assert.ok(routesOf(project(HONO)).every(r => !r.caseInsensitive));
    const next = routesOf(project({
      'package.json': JSON.stringify({ dependencies: { next: '14.2.0', react: '18.3.1' } }),
      'app/api/Users/route.ts': 'export async function GET() { return Response.json([]); }\n',
    }));
    assert.ok(next.length > 0 && next.every(r => !r.caseInsensitive));
  });
});

// ── FR-010: the fallback advice names what is missing ────────────────────────

let noPython = null;
function pathWithoutPython() {
  if (noPython) return noPython;
  noPython = mkdtempSync(join(tmpdir(), 'docguard-063-nopy-'));
  dirs.push(noPython);
  for (const bin of ['node', 'git']) {
    const which = spawnSync('command', ['-v', bin], { shell: true, encoding: 'utf8' }).stdout.trim();
    if (which) symlinkSync(which, join(noPython, bin));
  }
  return noPython;
}
const planNotes = (dir, env = process.env) => {
  const r = spawnSync(process.execPath, [CLI, 'generate', '--plan', '--format', 'json'], { cwd: dir, encoding: 'utf8', env: { ...env, NO_COLOR: '1' }, timeout: 60000 });
  return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).notes.join('\n');
};
const FASTAPI = {
  'requirements.txt': 'fastapi\n',
  'app/main.py': 'from fastapi import FastAPI\napp = FastAPI()\n\n@app.get("/items")\ndef items():\n    return []\n',
};

describe('the pattern-fallback advice names the missing prerequisite (FR-010)', () => {
  it('a TypeScript file that does not parse: fix its syntax, not install python3', () => {
    const notes = planNotes(project({ ...HONO, 'src/app.ts': HONO['src/app.ts'] + UNPARSEABLE }));
    assert.match(notes, /pattern fallback/);
    assert.match(notes, /JavaScript\/TypeScript syntax error/);
    assert.doesNotMatch(notes, /python3/);
  });

  it('Python without an interpreter: put python3 on PATH', () => {
    const notes = planNotes(project(FASTAPI), { ...process.env, PATH: pathWithoutPython() });
    assert.match(notes, /python3/);
    assert.doesNotMatch(notes, /@babel\/parser|JavaScript/);
  });

  it('a Python file that does not parse: fix the Python syntax error', { skip: pyAstAvailable() ? false : 'python3 not on PATH' }, () => {
    const notes = planNotes(project({ ...FASTAPI, 'app/broken.py': 'from fastapi import APIRouter\nrouter = APIRouter()\n@router.get("/x")\ndef x(:\n' }));
    assert.match(notes, /Python syntax error/);
    assert.doesNotMatch(notes, /python3 \(or/);
  });

  it('@babel/parser missing: reinstall docguard-cli', () => {
    const advice = sharedSource.patternFallbackAdvice;
    assert.equal(typeof advice, 'function');
    const summary = summarizeTiers([{ ...tierFor('src/a.ts', null), file: 'src/a.ts' }]);
    assert.match(advice(summary.regexCauses), /@babel\/parser/);
    assert.doesNotMatch(advice(summary.regexCauses), /python3/);
    const both = summarizeTiers([summary, { ...tierFor('app/x.py', null, 'No usable python3 interpreter; routes matched by pattern.'), file: 'app/x.py' }]);
    assert.match(advice(both.regexCauses), /python3.*@babel\/parser/);
  });

  it('generate --spec gives the same advice', () => {
    const dir = project({ ...HONO, 'src/app.ts': HONO['src/app.ts'] + UNPARSEABLE });
    const r = jsonOut(cli(dir, ['generate', '--spec', 'src', '--format', 'json']));
    assert.equal(r.confidence, 'low');
    assert.match(r.notes.join(' '), /JavaScript\/TypeScript syntax error/);
    assert.doesNotMatch(r.notes.join(' '), /python3/);
  });
});
