import { describe, it, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';

import { detectEcosystems, detectProjectProfile, detectProjectName } from '../cli/scanners/project-type.mjs';

function make(files) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-pt-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

describe('project-type detection', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('detects a Python FastAPI api from pyproject.toml', () => {
    dir = make({ 'pyproject.toml': '[project]\nname="svc"\ndependencies = ["fastapi>=0.110", "uvicorn"]\n' });
    const e = detectEcosystems(dir)[0];
    assert.equal(e.language, 'Python');
    assert.equal(e.framework, 'FastAPI');
    assert.equal(e.kind, 'api');
    assert.ok('fastapi' in e.deps);
  });

  it('detects Django from requirements.txt + manage.py', () => {
    dir = make({ 'requirements.txt': 'Django==5.0\npsycopg2==2.9\n', 'manage.py': '# django' });
    const e = detectEcosystems(dir)[0];
    assert.equal(e.language, 'Python');
    assert.equal(e.framework, 'Django');
    assert.equal(e.kind, 'webapp');
  });

  it('detects a Rust web service from Cargo.toml', () => {
    dir = make({ 'Cargo.toml': '[package]\nname = "api"\n\n[dependencies]\naxum = "0.7"\ntokio = { version = "1" }\n', 'src/main.rs': 'fn main(){}' });
    const e = detectEcosystems(dir)[0];
    assert.equal(e.language, 'Rust');
    assert.equal(e.framework, 'Axum');
    assert.equal(e.kind, 'service');
    assert.ok('axum' in e.deps);
  });

  it('detects a Rust library (src/lib.rs, no web framework)', () => {
    dir = make({ 'Cargo.toml': '[package]\nname = "util"\n\n[dependencies]\nserde = "1"\n', 'src/lib.rs': 'pub fn x(){}' });
    const e = detectEcosystems(dir)[0];
    assert.equal(e.kind, 'library');
  });

  it('detects a Go service from go.mod', () => {
    dir = make({ 'go.mod': 'module example.com/app\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.1\n)\n', 'main.go': 'package main\nfunc main(){}' });
    const e = detectEcosystems(dir)[0];
    assert.equal(e.language, 'Go');
    assert.equal(e.framework, 'Gin');
    assert.equal(e.kind, 'service');
  });

  it('detects a Java Spring Boot project from build.gradle', () => {
    dir = make({ 'build.gradle': "dependencies {\n  implementation 'org.springframework.boot:spring-boot-starter-web:3.2.0'\n}\n" });
    const e = detectEcosystems(dir)[0];
    assert.equal(e.language, 'Java');
    assert.equal(e.framework, 'Spring Boot');
  });

  it('detects a Ruby Rails app from Gemfile', () => {
    dir = make({ 'Gemfile': "source 'https://rubygems.org'\ngem 'rails', '~> 7.1'\n" });
    const e = detectEcosystems(dir)[0];
    assert.equal(e.language, 'Ruby');
    assert.equal(e.framework, 'Rails');
  });

  it('detects a PHP Laravel app from composer.json', () => {
    dir = make({ 'composer.json': JSON.stringify({ require: { 'laravel/framework': '^11.0' } }) });
    const e = detectEcosystems(dir)[0];
    assert.equal(e.language, 'PHP');
    assert.equal(e.framework, 'Laravel');
  });

  it('detects a TypeScript CLI from package.json bin', () => {
    dir = make({ 'package.json': JSON.stringify({ name: 'tool', bin: { tool: './cli.js' }, devDependencies: { typescript: '^5' } }) });
    const e = detectEcosystems(dir)[0];
    assert.equal(e.language, 'TypeScript');
    assert.equal(e.kind, 'cli');
  });

  it('handles a POLYGLOT repo: Python backend + React frontend', () => {
    dir = make({
      'package.json': JSON.stringify({ dependencies: { react: '^19', 'react-router-dom': '^6' } }),
      'backend/pyproject.toml': '[project]\nname="api"\ndependencies = ["fastapi"]\n',
    });
    const p = detectProjectProfile(dir);
    assert.equal(p.polyglot, true);
    assert.ok(p.languages.includes('Python'));
    assert.ok(p.languages.includes('JavaScript') || p.languages.includes('TypeScript'));
    const py = p.ecosystems.find(e => e.language === 'Python');
    assert.equal(py.framework, 'FastAPI');
    assert.equal(py.dir, 'backend');
  });

  it('excludes non-product fixture manifests from the stack BY DEFAULT (Bug #1)', () => {
    // Field report: a Click CLI was reported as "Express, Flask" because the
    // manifest walk ingested tests/fixtures/*/package.json + requirements.txt.
    // v0.26: non-product dirs are excluded from detection by DEFAULT — the
    // realistic first run has no .docguardignore, so honoring config.ignore
    // alone (v0.25) wasn't enough.
    dir = make({
      'pyproject.toml': '[project]\nname="tool"\ndependencies = ["click>=8"]\n', // root = a CLI
      'tests/fixtures/node_app/package.json': JSON.stringify({ dependencies: { express: '^4' } }),
      'tests/fixtures/py_app/requirements.txt': 'flask==3.0\n',
    });

    // Default first run (NO config at all): fixtures must NOT leak into the stack.
    const clean = detectProjectProfile(dir).frameworks;
    assert.ok(!clean.includes('Express'), 'fixture Express must be excluded by default');
    assert.ok(!clean.includes('Flask'), 'fixture Flask must be excluded by default');
    assert.ok(clean.includes('Click'), 'the real root framework must survive');

    // Opt-out escape hatch (anti-false-green): a user whose `fixtures` dir is
    // actually product can re-include everything.
    const leaky = detectProjectProfile(dir, { detection: { includeNonProduct: true } }).frameworks;
    assert.ok(leaky.includes('Express'), 'detection.includeNonProduct must re-include fixture manifests');

    // Explicit config.ignore / .docguardignore still works (backward compat).
    const ignored = detectProjectProfile(dir, { ignore: ['tests/'] }).frameworks;
    assert.ok(!ignored.includes('Express'), 'tests/ ignore must drop the fixture Express');
  });
});

describe('detectProjectName — manifest name over dir slug (Bug #4)', () => {
  let dir;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('reads [project].name from pyproject.toml', () => {
    dir = make({ 'pyproject.toml': '[project]\nname = "websec-validator"\ndependencies = ["click"]\n' });
    assert.equal(detectProjectName(dir), 'websec-validator');
  });

  it('reads name from package.json', () => {
    dir = make({ 'package.json': JSON.stringify({ name: 'my-pkg', version: '1.0.0' }) });
    assert.equal(detectProjectName(dir), 'my-pkg');
  });

  it('reads [tool.poetry].name when [project] is absent', () => {
    dir = make({ 'pyproject.toml': '[tool.poetry]\nname = "poetry-pkg"\n' });
    assert.equal(detectProjectName(dir), 'poetry-pkg');
  });

  it('reads [package].name from Cargo.toml', () => {
    dir = make({ 'Cargo.toml': '[package]\nname = "rust-crate"\nversion = "0.1.0"\n' });
    assert.equal(detectProjectName(dir), 'rust-crate');
  });

  it('derives the name from the go.mod module path basename', () => {
    dir = make({ 'go.mod': 'module github.com/acme/widget\n\ngo 1.22\n' });
    assert.equal(detectProjectName(dir), 'widget');
  });

  it('takes the segment after the slash for a composer vendor/name', () => {
    dir = make({ 'composer.json': JSON.stringify({ name: 'acme/blog' }) });
    assert.equal(detectProjectName(dir), 'blog');
  });

  it('falls back to the directory basename when no manifest declares a name', () => {
    dir = make({ 'README.md': '# hi\n' });
    assert.equal(detectProjectName(dir), basename(dir));
  });

  it('the manifest name beats the dir slug (the git-worktree scenario)', () => {
    dir = make({ 'package.json': JSON.stringify({ name: 'real-name' }) });
    assert.notEqual(detectProjectName(dir), basename(dir));
    assert.equal(detectProjectName(dir), 'real-name');
  });
});
