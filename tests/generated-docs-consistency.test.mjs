/**
 * DocGuard's generated documents pass DocGuard's own checks
 * (specs/044-generated-docs-consistency). One reproduction per bug: the writer
 * and the reader of each fact must agree.
 *
 * @req docguard.generated-docs-consistency#FR-001
 * @req docguard.generated-docs-consistency#FR-002
 * @req docguard.generated-docs-consistency#FR-003
 * @req docguard.generated-docs-consistency#FR-004
 * @req docguard.generated-docs-consistency#FR-005
 * @req docguard.generated-docs-consistency#FR-006
 * @req docguard.generated-docs-consistency#FR-007
 * @req docguard.generated-docs-consistency#FR-008
 * @req docguard.generated-docs-consistency#FR-009
 * @req docguard.generated-docs-consistency#FR-010
 * @req docguard.generated-docs-consistency#FR-011
 * @req docguard.generated-docs-consistency#FR-012
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { parseApiReferenceDoc, compareEndpoints } from '../cli/scanners/api-doc.mjs';
import { diffEntities, diffEnvVars, diffTechStack } from '../cli/commands/diff.mjs';
import { upsertSection } from '../cli/writers/sections.mjs';
import { buildMemoryPlan } from '../cli/scanners/memory-plan.mjs';
import { scanComponents } from '../cli/scanners/inventory.mjs';
import { scanSchemasDeep } from '../cli/scanners/schemas.mjs';
import { detectIntegrations } from '../cli/scanners/integrations.mjs';
import { renderAsBuiltSpec } from '../cli/scanners/as-built.mjs';
import { collectEnvVars } from '../cli/shared-source.mjs';
import { isDocguardOwnedDir } from '../cli/shared-ignore.mjs';
import { writeOwnedSections } from '../cli/writers/generate-io.mjs';
import { loadConfig } from '../cli/config.mjs';
import { validateDocSections } from '../cli/validators/structure.mjs';
import { validateEnvironment } from '../cli/validators/environment.mjs';
import { validateTraceability } from '../cli/validators/traceability.mjs';
import { validateDocsCoverage } from '../cli/validators/docs-coverage.mjs';
import { validateDocQuality } from '../cli/validators/doc-quality.mjs';
import { validateTestSpec } from '../cli/validators/test-spec.mjs';
import { validateSpecKitIntegration } from '../cli/scanners/speckit.mjs';
import { collectRequirementIdsFromContent } from '../cli/shared-requirements.mjs';
import { PROJECTS, materialize } from './fixtures/generated-docs-projects.mjs';

const CLI = resolve('cli/docguard.mjs');
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

function project(files, opts) {
  const dir = materialize(files, opts);
  temps.push(dir);
  return dir;
}
const fixture = (name) => project(PROJECTS[name].files, { prefix: `gdc-${name}-` });
const dg = (dir, args, env = process.env) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env, maxBuffer: 1 << 26 });
const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');
const codes = (result) => (result.findings || []).map(f => f.code);

describe('FR-001: the API reference parser reads what generate writes', () => {
  it('counts the root path and the ALL/ANY methods', () => {
    const md = [
      '| Method | Path |', '|---|---|',
      '| `GET` | `/` |',
      '| `ALL` | `/api/legacy-webhook` |',
      '| `ANY` | `/metrics` |',
      '#### ALL `/api/hook`',
    ].join('\n');
    assert.deepEqual(parseApiReferenceDoc(md).map(e => e.key).sort(),
      ['ALL /api/hook', 'ALL /api/legacy-webhook', 'ANY /metrics', 'GET /']);
  });

  it('keeps the path as written, so messages name the parameter', () => {
    const [e] = parseApiReferenceDoc('| `DELETE` | `/users/:id` |');
    assert.equal(e.path, '/users/:id');
    assert.equal(e.key, 'DELETE /users/{}');
    const cmp = compareEndpoints([e], [{ method: 'DELETE', path: '/users/{userId}' }]);
    assert.equal(cmp.matched.length, 1);
  });

  it('does not read a heading or prose cell that is not a method', () => {
    assert.deepEqual(parseApiReferenceDoc('## GET requests\n| Anything | `/x` |'), []);
  });

  it('the Go route scanner reads Gin\'s Any as ANY', () => {
    const dir = fixture('go-svc');
    assert.equal(dg(dir, ['generate']).status, 0);
    assert.match(read(dir, 'docs-canonical/API-REFERENCE.md'), /\| `ANY` \| `\/metrics` \| metrics \|/);
  });

  it('guard reports no API005 for the root and catch-all routes generate documented', () => {
    const dir = fixture('express-js');
    assert.equal(dg(dir, ['generate']).status, 0);
    const report = JSON.parse(dg(dir, ['guard', '--format', 'json']).stdout);
    assert.deepEqual(report.findings.filter(f => f.code === 'API005').map(f => f.message), []);
  });
});

describe('FR-002: diff reads entity tables', () => {
  it('an entity listed only in the plan\'s entity table is documented', () => {
    const dir = project({
      'go.mod': 'module x\n\ngo 1.22\n',
      'internal/store/todo.go': 'package store\n\ntype Todo struct {\n\tID int `json:"id"`\n\tTitle string `json:"title"`\n}\n',
      'docs-canonical/DATA-MODEL.md': '# Data Model\n\n## Entities\n\n| Entity | Fields | Source |\n| --- | --- | --- |\n| `Todo` | 2 | `internal/store/todo.go` |\n\n| Field | Type |\n| --- | --- |\n| `title` | string |\n',
    }, { git: false });
    temps.push(dir);
    const r = diffEntities(dir);
    assert.deepEqual(r.onlyInCode, []);
    assert.deepEqual(r.onlyInDocs, [], 'a Field table\'s rows are not entities');
  });
});

describe('FR-003: generated docs carry the required headings', () => {
  it('upsertSection writes a heading above a new section', () => {
    const out = upsertSection('# Env\n', 'env-vars', '| a |', { heading: 'Environment Variables' }).content;
    assert.match(out, /^## Environment Variables\n\n<!-- docguard:section id=env-vars source=code -->/m);
  });

  it('an existing heading hosts the section instead of a second heading', () => {
    const doc = '# Architecture\n\n## Tech Stack\n\n| Category | Technology |\n\n## Other\n';
    const out = upsertSection(doc, 'tech-stack', '| x |', { heading: 'Tech Stack' }).content;
    assert.equal(out.match(/^## Tech Stack$/gm).length, 1);
    assert.ok(out.indexOf('id=tech-stack') > out.indexOf('## Tech Stack'));
    assert.ok(out.indexOf('id=tech-stack') < out.indexOf('## Other'));
  });

  it('generate --plan --write leaves no STR003, ENV001 or ENV002', () => {
    const dir = fixture('express-js');
    assert.equal(dg(dir, ['generate', '--plan', '--write']).status, 0);
    const config = loadConfig(dir);
    assert.deepEqual(codes(validateDocSections(dir, config)), []);
    assert.deepEqual(codes(validateEnvironment(dir, config)).filter(c => /ENV00[12]/.test(c)), []);
    assert.ok(buildMemoryPlan(dir, config).docs.every(d => d.sections.every(s => 'heading' in s)));
  });

  it('plain generate uses headings the section validator recognises', () => {
    const dir = fixture('express-js');
    assert.equal(dg(dir, ['generate']).status, 0);
    assert.deepEqual(codes(validateDocSections(dir, loadConfig(dir))), []);
  });
});

describe('FR-004: DocGuard does not report its own output as foreign', () => {
  it('TRC003 skips a generated doc; TRC002 accepts a cited source file', () => {
    const dir = project({
      '.docguard.json': JSON.stringify({ projectName: 'x', requiredFiles: { canonical: ['docs-canonical/SECURITY.md'] } }),
      'svc/tokens.py': 'import jwt\n',
      'docs-canonical/SECURITY.md': '# Security\n\n## Authentication\n\nTokens are signed in `svc/tokens.py`.\n',
      'docs-canonical/API-REFERENCE.md': '# API Reference\n\n<!-- docguard:generated true -->\n',
    });
    const r = validateTraceability(dir, loadConfig(dir));
    assert.ok(!codes(r).includes('TRC003'), 'TRC003 on a generated doc');
    assert.ok(!codes(r).includes('TRC002'), 'TRC002 despite a cited source file');
  });

  it('a citation of a missing or Markdown file does not link a doc', () => {
    const dir = project({
      '.docguard.json': JSON.stringify({ projectName: 'x', requiredFiles: { canonical: ['docs-canonical/SECURITY.md'] } }),
      'README.md': '# x\n',
      'docs-canonical/SECURITY.md': '# Security\n\nSee `README.md` and `svc/gone.py`.\n',
      'docs-canonical/OTHER.md': '# Other\n',
    });
    assert.ok(codes(validateTraceability(dir, loadConfig(dir))).includes('TRC002'));
  });

  it('the as-built spec carries a success criterion ID and passes SPK003', () => {
    const facts = [{ kind: 'env', key: 'PORT', file: null, line: null }];
    const body = renderAsBuiltSpec({ title: 'As-built: src', specId: 'x.as-built-src', areaRel: 'src', facts, tests: ['tests/a.test.js'], dirName: '001-as-built-src', date: '2026-09-30' });
    assert.match(body, /\*\*SC-001\*\*/);
    assert.match(body, /\*\*SC-002\*\*/, 'tests exist, so they are a criterion');
    const dir = project({ '.specify/memory/constitution.md': '# C\n', 'specs/001-as-built-src/spec.md': body });
    const r = validateSpecKitIntegration(dir, loadConfig(dir));
    assert.deepEqual(r.findings.filter(f => f.code === 'SPK003').map(f => f.message), []);
    const noTests = renderAsBuiltSpec({ title: 'A', specId: 'x.a', areaRel: 'src', facts, tests: [], dirName: '001-a', date: '2026-09-30' });
    assert.doesNotMatch(noTests, /\*\*SC-002\*\*/);
  });
});

describe('FR-005: DocGuard\'s own directories and files are not project code', () => {
  it('owned dirs are recognised; a specs/ dir without spec.md is code', () => {
    const dir = project({
      'docs-canonical/A.md': '#', 'docs-implementation/B.md': '#', 'specs/001-x/spec.md': '#',
      'rspec/specs/user_spec.rb': 'x', 'main.go': 'package main\n',
    }, { git: false });
    assert.equal(isDocguardOwnedDir(dir, 'docs-canonical'), true);
    assert.equal(isDocguardOwnedDir(dir, 'docs-implementation'), true);
    assert.equal(isDocguardOwnedDir(dir, 'specs'), true);
    assert.equal(isDocguardOwnedDir(dir, 'rspec/specs'), false);
    assert.equal(isDocguardOwnedDir(dir, 'main.go'), false);
  });

  it('the component map and DCV003 skip owned dirs; DCV003 names root dirs plainly', () => {
    const dir = fixture('go-svc');
    assert.equal(dg(dir, ['generate', '--plan', '--write']).status, 0);
    const config = loadConfig(dir);
    const modules = scanComponents(dir, config).map(m => m.path);
    assert.ok(modules.includes('internal'));
    assert.ok(!modules.some(m => /^docs-|^specs/.test(m)), modules.join(','));
    writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# Architecture\n');
    const dcv = validateDocsCoverage(dir, config).findings.filter(f => f.code === 'DCV003').map(f => f.message);
    assert.deepEqual(dcv, ['Source directory "internal/" is not referenced in ARCHITECTURE.md']);
  });

  it('guard straight after generate --plan --write reports no GST002, and DCV001 skips the spec registry', () => {
    const dir = fixture('go-svc');
    assert.equal(dg(dir, ['init', '--skip-prompts']).status, 0);
    assert.equal(dg(dir, ['generate', '--plan', '--write']).status, 0);
    writeFileSync(join(dir, '.docguard-specs.json'), '{}\n');
    const report = JSON.parse(dg(dir, ['guard', '--format', 'json']).stdout);
    assert.deepEqual(report.findings.filter(f => f.code === 'GST002' || (f.code === 'DCV001' && /docguard-specs/.test(f.message))).map(f => f.message), []);
  });
});

describe('FR-006: template placeholders are not claims', () => {
  it('a fresh init ARCHITECTURE claims no technology and REQUIREMENTS defines no ID', () => {
    const dir = fixture('express-js');
    assert.equal(dg(dir, ['init', '--skip-prompts']).status, 0);
    const tech = diffTechStack(dir, loadConfig(dir));
    assert.deepEqual(tech.onlyInDocs, []);
    const reqs = read(dir, 'docs-canonical/REQUIREMENTS.md');
    assert.equal(collectRequirementIdsFromContent(reqs, 'docs-canonical/REQUIREMENTS.md').size, 0);
    assert.doesNotMatch(read(dir, 'docs-canonical/ARCHITECTURE.md').replace(/<!--[\s\S]*?-->/g, ''), /^### (AWS CDK|Terraform)/m);
  });

  it('ENV004 ignores .env.example named only in a comment', () => {
    const dir = project({
      '.docguard.json': JSON.stringify({ projectName: 'x', projectTypeConfig: { needsEnvExample: true } }),
      'docs-canonical/ENVIRONMENT.md': '# Environment\n\n## Setup Steps\n\n2. <!-- e.g. Copy `.env.example` to `.env.local` -->\n\n## Environment Variables\n',
    });
    assert.ok(!codes(validateEnvironment(dir, loadConfig(dir))).includes('ENV004'));
    writeFileSync(join(dir, 'docs-canonical/ENVIRONMENT.md'), '# Environment\n\n## Setup Steps\n\nCopy `.env.example`.\n\n## Environment Variables\n');
    assert.ok(codes(validateEnvironment(dir, loadConfig(dir))).includes('ENV004'), 'a real reference still counts');
  });

  it('diff and guard read the tech stack the same way', () => {
    const dir = project({
      'package.json': JSON.stringify({ dependencies: { express: '4' } }),
      'docs-canonical/ARCHITECTURE.md': '# A\n\nWe use Express, not Terraform.\n<!-- e.g. DynamoDB lock table -->\n',
    }, { git: false });
    const r = diffTechStack(dir, loadConfig(dir));
    assert.deepEqual(r.onlyInDocs, []);
    assert.deepEqual(r.matched, ['Express']);
  });
});

describe('FR-007: plain generate writes correct facts', () => {
  it('handler names, Required with defaults, and the auth library', () => {
    const dir = fixture('express-js');
    assert.equal(dg(dir, ['generate']).status, 0);
    const architecture = read(dir, 'docs-canonical/ARCHITECTURE.md');
    assert.doesNotMatch(architecture, /\\`|\\n/, 'no escaped code fences or literal \\n');
    assert.match(architecture, /^```mermaid$/m);
    const api = read(dir, 'docs-canonical/API-REFERENCE.md');
    const handlers = [...api.matchAll(/^\| `[A-Z]+` \| `[^`]+` \| ([^|]+) \|/gm)].map(m => m[1].trim());
    assert.ok(handlers.length >= 7);
    assert.ok(!handlers.some(h => /^(res|req|async|await|function)$/.test(h)), handlers.join(','));
    assert.ok(handlers.includes('listUsers') && handlers.includes('inline'));
    const env = read(dir, 'docs-canonical/ENVIRONMENT.md');
    assert.match(env, /^\| `PORT` \|[^\n]*\| No \|[^\n]*3000/m);
    assert.match(env, /^\| `JWT_SECRET` \|[^\n]*\| Yes \|/m);
    const security = read(dir, 'docs-canonical/SECURITY.md');
    assert.match(security, /jsonwebtoken/);
    assert.ok(detectIntegrations(dir).some(i => i.category === 'Auth' && i.evidence.includes('jsonwebtoken')));
  });

  it('Python defaults: os.getenv with a default is optional, os.environ[...] is required', () => {
    const vars = new Map(collectEnvVars(fixture('fastapi-py')).map(v => [v.name, v]));
    assert.equal(vars.get('DEBUG').required, false);
    assert.equal(vars.get('DEBUG').default, 'false');
    assert.equal(vars.get('JWT_SECRET').required, true);
  });
});

describe('FR-008: one set of environment variables', () => {
  it('generate, the plan and diff agree, including .env.example and Go reads', () => {
    for (const name of ['express-js', 'go-svc']) {
      const dir = fixture(name);
      const config = loadConfig(dir);
      const expected = collectEnvVars(dir, config).map(v => v.name).sort();
      assert.ok(expected.length > 0, name);
      assert.deepEqual([...buildMemoryPlan(dir, config).surface.envVars].sort(), expected, `${name}: plan`);
      assert.equal(dg(dir, ['generate']).status, 0);
      const env = read(dir, 'docs-canonical/ENVIRONMENT.md');
      const listed = [...env.matchAll(/^\| `([A-Z][A-Z0-9_]*)` \|/gm)].map(m => m[1]).sort();
      assert.deepEqual(listed, expected, `${name}: generate`);
      const d = diffEnvVars(dir, config);
      assert.deepEqual(d.onlyInCode, [], `${name}: diff`);
      if (!existsSync(join(dir, '.env.example'))) assert.doesNotMatch(env, /\.env\.example/);
    }
  });
});

describe('FR-009: re-running the plan keeps what people wrote', () => {
  it('human prose and pinned code sections survive, and no .bak is left', () => {
    const dir = fixture('express-js');
    assert.equal(dg(dir, ['init', '--skip-prompts']).status, 0);
    assert.equal(dg(dir, ['generate', '--plan', '--write']).status, 0);
    const path = join(dir, 'docs-canonical/ARCHITECTURE.md');
    let doc = readFileSync(path, 'utf8');
    doc = doc.replace(/(<!-- docguard:section id=overview source=human -->\n)[\s\S]*?(\n<!-- \/docguard:section -->)/, '$1This service manages users.$2');
    doc = doc.replace('<!-- docguard:section id=tech-stack source=code -->', '<!-- docguard:section id=tech-stack source=code pinned="hand-kept" -->');
    doc = doc.replace(/(id=tech-stack source=code pinned="hand-kept" -->\n)[\s\S]*?(\n<!-- \/docguard:section -->)/, '$1| Hand | Kept |$2');
    writeFileSync(path, doc);
    assert.equal(dg(dir, ['generate', '--plan', '--write']).status, 0);
    const after = readFileSync(path, 'utf8');
    assert.match(after, /This service manages users\./);
    assert.match(after, /\| Hand \| Kept \|/);
    assert.deepEqual(readdirSync(join(dir, 'docs-canonical')).filter(n => n.endsWith('.bak')), []);
  });

  it('writeOwnedSections skips the backup only for DocGuard\'s own document and an owned-only change', () => {
    const dir = project({}, { git: false });
    const body = '\nHuman text.\n\n<!-- docguard:section id=a source=code -->\nold\n<!-- /docguard:section -->\n';
    const added = '\n## B\n\n<!-- docguard:section id=b source=code -->\nx\n<!-- /docguard:section -->\n';

    const generated = join(dir, 'generated.md');
    const before = `# T\n\n<!-- docguard:generated true -->\n${body}`;
    writeFileSync(generated, before);
    writeOwnedSections(generated, before, before.replace('old', 'new') + added);
    assert.equal(existsSync(`${generated}.bak`), false, 'owned-only change to a generated doc needs no backup');
    const current = readFileSync(generated, 'utf8');
    writeOwnedSections(generated, current, current.replace('Human text.', 'Rewritten.'));
    assert.equal(existsSync(`${generated}.bak`), true, 'a lossy write keeps its backup');

    const human = join(dir, 'human.md');
    const humanBefore = `# Human\n${body}`;
    writeFileSync(human, humanBefore);
    writeOwnedSections(human, humanBefore, humanBefore.replace('old', 'new'));
    assert.equal(readFileSync(`${human}.bak`, 'utf8'), humanBefore, 'a person\'s document keeps its backup');
  });
});

describe('FR-010: plain generate reads the facts guard checks', () => {
  it('Django models are entities, with and without python3', () => {
    const dir = fixture('django-py');
    const names = scanSchemasDeep(dir, {}, {}, {}).entities.map(e => e.name).sort();
    assert.deepEqual(names, ['Order', 'Product']);
    const bin = mkdtempSync(join(tmpdir(), 'gdc-nopy-'));
    temps.push(bin);
    for (const tool of ['node', 'git']) {
      const which = spawnSync('command', ['-v', tool], { shell: true, encoding: 'utf8' }).stdout.trim();
      if (which) symlinkSync(which, join(bin, tool));
    }
    const script = `import { scanSchemasDeep } from ${JSON.stringify(resolve('cli/scanners/schemas.mjs'))};
console.log(JSON.stringify(scanSchemasDeep(${JSON.stringify(dir)}, {}, {}, {}).entities.map(e => e.name).sort()));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, PATH: bin } });
    assert.deepEqual(JSON.parse(r.stdout), ['Order', 'Product'], r.stderr);
  });

  it('entity files are project-relative; Django and Go test files are tests, not components', () => {
    const django = fixture('django-py');
    assert.deepEqual([...new Set(scanSchemasDeep(django, {}, {}, {}).entities.map(e => e.file))], ['shop/models.py']);
    const config = loadConfig(django);
    assert.ok(!codes(validateTestSpec(django, config)).includes('TSP007'));
    const go = fixture('go-svc');
    assert.ok(!scanComponents(go, loadConfig(go)).some(m => m.path === 'main_test.go'));
    assert.ok(!codes(validateTestSpec(go, loadConfig(go))).includes('TSP007'));
  });

  it('tech, tests, modules and routes match what guard reads', () => {
    const next = fixture('next-ts');
    assert.equal(dg(next, ['generate']).status, 0);
    const arch = read(next, 'docs-canonical/ARCHITECTURE.md');
    for (const tech of ['React', 'Next.js', 'Prisma', 'TypeScript']) assert.match(arch, new RegExp(tech.replace('.', '\\.')));
    assert.match(read(next, 'docs-canonical/TEST-SPEC.md'), /`src\/lib\/auth\.test\.ts`/);

    const go = fixture('go-svc');
    assert.equal(dg(go, ['generate']).status, 0);
    assert.match(read(go, 'docs-canonical/ARCHITECTURE.md'), /`internal`/);
    assert.match(read(go, 'docs-canonical/API-REFERENCE.md'), /\| `GET` \| `\/todos` \|/);
    assert.match(read(go, 'docs-canonical/TEST-SPEC.md'), /`main_test\.go`/);
  });
});

describe('FR-011: generated prose passes DocGuard\'s prose checks', () => {
  it('no DQ001 or DQ007 on generated documents', () => {
    for (const [name, args] of [['express-js', ['generate']], ['go-svc', ['generate', '--plan', '--write']], ['express-js', ['generate', '--plan', '--write']]]) {
      const dir = fixture(name);
      assert.equal(dg(dir, args).status, 0);
      const dq = validateDocQuality(dir, loadConfig(dir)).findings.filter(f => f.code === 'DQ001' || f.code === 'DQ007');
      assert.deepEqual(dq.map(f => f.message), [], `${name} ${args.join(' ')}`);
    }
  });
});

describe('FR-012: the docs describe the change', () => {
  it('commands.md, ARCHITECTURE.md and the CHANGELOG', () => {
    const commands = readFileSync('docs/commands.md', 'utf8');
    const generate = commands.slice(commands.indexOf('### `docguard generate`'), commands.indexOf('### `docguard audit`'));
    for (const word of [/heading/i, /\.bak/, /\.env\.example/, /cite/i]) assert.match(generate, word);
    const arch = readFileSync('docs-canonical/ARCHITECTURE.md', 'utf8');
    assert.match(arch, /writeOwnedSections/);
    assert.match(arch, /collectEnvVars/);
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    const unreleased = changelog.slice(changelog.indexOf('## [Unreleased]'), changelog.indexOf('\n## [', changelog.indexOf('## [Unreleased]') + 5));
    assert.match(unreleased, /### Fixed[\s\S]*generate/);
  });
});
