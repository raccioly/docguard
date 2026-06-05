/**
 * Project-Type Detection — the language-agnostic spine.
 *
 * DocGuard documents ANY project, not just JS/web. This scanner identifies
 * every ecosystem present (polyglot/monorepo-aware) from its manifest files and
 * extracts deterministic facts (language, framework, kind, dependencies, entry
 * points). The AI agent then writes language-appropriate prose grounded in
 * these facts.
 *
 * Supported ecosystems:
 *   JS/TS · Python · Rust · Go · Java/Kotlin · Ruby · PHP · C#/.NET
 *
 * Zero NPM dependencies — minimal manifest parsing with Node.js built-ins.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative, dirname, basename } from 'node:path';
import { shouldIgnore, relPosix } from '../shared-ignore.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'target',
  '.cache', '__pycache__', '.venv', 'venv', 'vendor', '.turbo', '.vercel',
  'bin', 'obj', '.gradle', '.idea', 'cdk.out', '.claude',
]);

// Manifest filename → ecosystem language.
const MANIFESTS = [
  { file: 'package.json', lang: 'JavaScript' },
  { file: 'pyproject.toml', lang: 'Python' },
  { file: 'requirements.txt', lang: 'Python' },
  { file: 'setup.py', lang: 'Python' },
  { file: 'Pipfile', lang: 'Python' },
  { file: 'Cargo.toml', lang: 'Rust' },
  { file: 'go.mod', lang: 'Go' },
  { file: 'pom.xml', lang: 'Java' },
  { file: 'build.gradle', lang: 'Java' },
  { file: 'build.gradle.kts', lang: 'Kotlin' },
  { file: 'Gemfile', lang: 'Ruby' },
  { file: 'composer.json', lang: 'PHP' },
];

function readSafe(p) { try { return readFileSync(p, 'utf-8'); } catch { return ''; } }
function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; } }

/** Recursively find manifest files (bounded depth, ignoring vendor dirs). */
function findManifests(projectDir, maxDepth = 4, config = {}) {
  const root = resolve(projectDir);
  const found = []; // { absDir, file, lang }
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        // Honor config.ignore / .docguardignore: a user who excludes tests/ or
        // base-research/ must not have those dirs' manifests (e.g. a fixture
        // package.json declaring express) misclassify the project's stack.
        if (shouldIgnore(relPosix(root, join(dir, e.name)), config)) continue;
        walk(join(dir, e.name), depth + 1);
      } else if (e.isFile()) {
        if (shouldIgnore(relPosix(root, join(dir, e.name)), config)) continue;
        const m = MANIFESTS.find(x => x.file === e.name);
        if (m) found.push({ absDir: dir, file: e.name, lang: m.lang });
        else if (e.name.endsWith('.csproj')) found.push({ absDir: dir, file: e.name, lang: 'C#' });
      }
    }
  };
  walk(root, 0);
  return found;
}

// ── Dependency extraction per ecosystem ──────────────────────────────────────

/** Extract names from a TOML [section] of `name = "ver"` lines (Cargo, etc.). */
function tomlSectionDeps(content, sections) {
  const deps = {};
  const lines = content.split('\n');
  let active = false;
  for (const raw of lines) {
    const line = raw.trim();
    const sec = line.match(/^\[([^\]]+)\]/);
    if (sec) { active = sections.includes(sec[1]); continue; }
    if (!active || !line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_.\-]+)\s*=\s*(?:"([^"]*)"|\{[^}]*version\s*=\s*"([^"]*)"|\{)/);
    if (m) deps[m[1]] = m[2] || m[3] || '*';
  }
  return deps;
}

/** pyproject [project] dependencies = ["pkg>=1", ...] and poetry table form. */
function pyprojectDeps(content) {
  const deps = {};
  // PEP 621 array form
  const arr = content.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
  if (arr) {
    for (const m of arr[1].matchAll(/["']([A-Za-z0-9_.\-]+)\s*[><=~!\[]?/g)) deps[m[1]] = '*';
  }
  // Poetry table form
  Object.assign(deps, tomlSectionDeps(content, ['tool.poetry.dependencies']));
  return deps;
}

function requirementsDeps(content) {
  const deps = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('-')) continue;
    const m = line.match(/^([A-Za-z0-9_.\-]+)\s*(?:[><=~!]=?\s*([0-9][\w.\-]*))?/);
    if (m) deps[m[1].toLowerCase()] = m[2] || '*';
  }
  return deps;
}

function goModDeps(content) {
  const deps = {};
  // require ( ... ) block + single-line requires
  const block = content.match(/require\s*\(([\s\S]*?)\)/);
  const collect = (text) => {
    for (const m of text.matchAll(/^\s*([\w.\-/]+)\s+v([\w.\-]+)/gm)) deps[m[1]] = 'v' + m[2];
  };
  if (block) collect(block[1]);
  for (const m of content.matchAll(/^require\s+([\w.\-/]+)\s+v([\w.\-]+)/gm)) deps[m[1]] = 'v' + m[2];
  return deps;
}

function gradleDeps(content) {
  const deps = {};
  for (const m of content.matchAll(/(?:implementation|api|compile|testImplementation)\s*[(\s]['"]([^'":]+):([^'":]+)(?::([^'"]+))?['"]/g)) {
    deps[`${m[1]}:${m[2]}`] = m[3] || '*';
  }
  return deps;
}

function pomDeps(content) {
  const deps = {};
  for (const m of content.matchAll(/<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>/g)) {
    deps[`${m[1].trim()}:${m[2].trim()}`] = '*';
  }
  return deps;
}

function gemfileDeps(content) {
  const deps = {};
  for (const m of content.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)) deps[m[1]] = '*';
  return deps;
}

function csprojDeps(content) {
  const deps = {};
  for (const m of content.matchAll(/<PackageReference\s+Include="([^"]+)"(?:\s+Version="([^"]+)")?/g)) {
    deps[m[1]] = m[2] || '*';
  }
  return deps;
}

// ── Framework + kind classification per ecosystem ────────────────────────────

function has(deps, ...names) {
  const keys = Object.keys(deps).map(k => k.toLowerCase());
  return names.some(n => keys.some(k => k === n.toLowerCase() || k.endsWith('/' + n.toLowerCase()) || k.endsWith(':' + n.toLowerCase())));
}

function classify(lang, dir, deps) {
  let framework = null;
  let kind = 'library';

  if (lang === 'JavaScript' || lang === 'TypeScript') {
    if (has(deps, 'next')) { framework = 'Next.js'; kind = 'webapp'; }
    else if (has(deps, 'react', 'vue', '@angular/core', 'svelte', '@sveltejs/kit', 'nuxt')) { framework = has(deps,'react')?'React':has(deps,'vue')?'Vue':'Frontend'; kind = 'webapp'; }
    else if (has(deps, 'express', 'fastify', 'hono', 'koa', '@nestjs/core')) { framework = has(deps,'express')?'Express':has(deps,'fastify')?'Fastify':has(deps,'@nestjs/core')?'NestJS':'Hono'; kind = 'api'; }
  } else if (lang === 'Python') {
    if (has(deps, 'django') || existsSync(join(dir, 'manage.py'))) { framework = 'Django'; kind = 'webapp'; }
    else if (has(deps, 'fastapi')) { framework = 'FastAPI'; kind = 'api'; }
    else if (has(deps, 'flask')) { framework = 'Flask'; kind = 'api'; }
    else if (has(deps, 'starlette')) { framework = 'Starlette'; kind = 'api'; }
    else if (has(deps, 'click', 'typer')) { framework = has(deps,'typer')?'Typer':'Click'; kind = 'cli'; }
  } else if (lang === 'Rust') {
    if (has(deps, 'actix-web')) { framework = 'Actix Web'; kind = 'service'; }
    else if (has(deps, 'axum')) { framework = 'Axum'; kind = 'service'; }
    else if (has(deps, 'rocket')) { framework = 'Rocket'; kind = 'service'; }
    else if (has(deps, 'warp', 'tide')) { framework = has(deps,'warp')?'Warp':'Tide'; kind = 'service'; }
    else if (has(deps, 'clap', 'structopt')) { framework = 'Clap'; kind = 'cli'; }
    if (existsSync(join(dir, 'src/main.rs')) && kind === 'library') kind = 'cli';
    else if (existsSync(join(dir, 'src/lib.rs')) && !framework) kind = 'library';
  } else if (lang === 'Go') {
    if (has(deps, 'gin', 'gin-gonic/gin')) { framework = 'Gin'; kind = 'service'; }
    else if (has(deps, 'echo', 'labstack/echo')) { framework = 'Echo'; kind = 'service'; }
    else if (has(deps, 'chi', 'go-chi/chi')) { framework = 'Chi'; kind = 'service'; }
    else if (has(deps, 'fiber', 'gofiber/fiber')) { framework = 'Fiber'; kind = 'service'; }
    else if (existsSync(join(dir, 'main.go')) || existsSync(join(dir, 'cmd'))) kind = 'service';
  } else if (lang === 'Java' || lang === 'Kotlin') {
    if (has(deps, 'spring-boot-starter-web', 'spring-boot-starter', 'org.springframework.boot:spring-boot-starter-web')) { framework = 'Spring Boot'; kind = 'api'; }
  } else if (lang === 'Ruby') {
    if (has(deps, 'rails')) { framework = 'Rails'; kind = 'webapp'; }
    else if (has(deps, 'sinatra')) { framework = 'Sinatra'; kind = 'api'; }
  } else if (lang === 'PHP') {
    if (has(deps, 'laravel/framework')) { framework = 'Laravel'; kind = 'webapp'; }
    else if (has(deps, 'symfony/framework-bundle')) { framework = 'Symfony'; kind = 'webapp'; }
  } else if (lang === 'C#') {
    if (has(deps, 'Microsoft.AspNetCore.App') || /Sdk="Microsoft\.NET\.Sdk\.Web"/.test('')) { framework = 'ASP.NET Core'; kind = 'api'; }
  }

  return { framework, kind };
}

// ── Per-manifest ecosystem builder ───────────────────────────────────────────

function buildEcosystem(projectDir, m) {
  const path = join(m.absDir, m.file);
  const content = readSafe(path);
  let deps = {};
  let lang = m.lang;
  let kind = null;
  let entryPoints = [];

  if (m.file === 'package.json') {
    const pkg = readJson(path) || {};
    deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.typescript || existsSync(join(m.absDir, 'tsconfig.json'))) lang = 'TypeScript';
    if (pkg.bin) { kind = 'cli'; entryPoints = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin); }
    else if (pkg.main || pkg.module || pkg.exports) entryPoints = [pkg.main || pkg.module].filter(Boolean);
  } else if (m.file === 'pyproject.toml') {
    deps = pyprojectDeps(content);
  } else if (m.file === 'requirements.txt') {
    deps = requirementsDeps(content);
  } else if (m.file === 'Pipfile') {
    deps = tomlSectionDeps(content, ['packages']);
  } else if (m.file === 'setup.py') {
    for (const mm of content.matchAll(/['"]([A-Za-z0-9_.\-]+)(?:[><=~!]=?[\w.\-]+)?['"]/g)) deps[mm[1].toLowerCase()] = '*';
  } else if (m.file === 'Cargo.toml') {
    deps = tomlSectionDeps(content, ['dependencies']);
  } else if (m.file === 'go.mod') {
    deps = goModDeps(content);
  } else if (m.file === 'pom.xml') {
    deps = pomDeps(content);
  } else if (m.file === 'build.gradle' || m.file === 'build.gradle.kts') {
    deps = gradleDeps(content);
  } else if (m.file === 'Gemfile') {
    deps = gemfileDeps(content);
  } else if (m.file === 'composer.json') {
    const c = readJson(path) || {};
    deps = { ...(c.require || {}), ...(c['require-dev'] || {}) };
  } else if (m.file.endsWith('.csproj')) {
    deps = csprojDeps(content);
  }

  const cls = classify(lang, m.absDir, deps);
  return {
    language: lang,
    manifest: relative(resolve(projectDir), path) || m.file,
    dir: relative(resolve(projectDir), m.absDir) || '.',
    framework: cls.framework,
    kind: kind || cls.kind || 'library',
    deps,
    entryPoints,
  };
}

/**
 * Detect every ecosystem present in the repo (polyglot-aware).
 * Multiple manifests in the same dir+language merge into one ecosystem.
 * @returns {Array<{ language, manifest, dir, framework, kind, deps, entryPoints }>}
 */
export function detectEcosystems(projectDir, config = {}) {
  const manifests = findManifests(projectDir, 4, config);
  const byKey = new Map(); // `${dir}::${lang-family}` → ecosystem

  // Group Python manifests (pyproject/requirements/setup/Pipfile) in same dir.
  const langFamily = (lang) => (lang === 'TypeScript' ? 'JavaScript' : lang);

  for (const m of manifests) {
    const eco = buildEcosystem(projectDir, m);
    const key = `${eco.dir}::${langFamily(eco.language)}`;
    if (byKey.has(key)) {
      // Merge deps + prefer the richer framework/kind/manifest.
      const cur = byKey.get(key);
      cur.deps = { ...cur.deps, ...eco.deps };
      if (!cur.framework && eco.framework) cur.framework = eco.framework;
      if (cur.kind === 'library' && eco.kind !== 'library') cur.kind = eco.kind;
      if (eco.language === 'TypeScript') cur.language = 'TypeScript';
      // Re-classify with merged deps.
      const cls = classify(cur.language, join(resolve(projectDir), cur.dir === '.' ? '' : cur.dir), cur.deps);
      if (!cur.framework) cur.framework = cls.framework;
    } else {
      byKey.set(key, eco);
    }
  }

  return [...byKey.values()];
}

/**
 * Top-level project profile.
 * @returns {{ ecosystems, primary, polyglot, languages, frameworks, kind }}
 */
export function detectProjectProfile(projectDir, config = {}) {
  const ecosystems = detectEcosystems(projectDir, config);

  // Primary = the root-level ecosystem, else the one with the most deps.
  const rootEco = ecosystems.find(e => e.dir === '.');
  const primary = rootEco
    || [...ecosystems].sort((a, b) => Object.keys(b.deps).length - Object.keys(a.deps).length)[0]
    || null;

  const languages = [...new Set(ecosystems.map(e => e.language))];
  const frameworks = [...new Set(ecosystems.map(e => e.framework).filter(Boolean))];

  return {
    ecosystems,
    primary,
    polyglot: languages.length > 1,
    languages,
    frameworks,
    kind: primary?.kind || 'unknown',
  };
}
