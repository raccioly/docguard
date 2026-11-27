/**
 * Spec 106: the seven field-report issues (711 to 717), each on the tree the issue gives.
 * The literal values are made up. Every tree runs the real CLI in a temporary directory.
 *
 * @req docguard.field-report-fixes#FR-001
 * @req docguard.field-report-fixes#FR-002
 * @req docguard.field-report-fixes#FR-004
 * @req docguard.field-report-fixes#FR-005
 * @req docguard.field-report-fixes#FR-006
 * @req docguard.field-report-fixes#FR-007
 * @req docguard.field-report-fixes#FR-008
 * @req docguard.field-report-fixes#FR-009
 * @req docguard.field-report-fixes#FR-010
 * @req docguard.field-report-fixes#FR-003
 * @req docguard.field-report-fixes#FR-011
 * @req docguard.field-report-fixes#FR-012
 * @req docguard.field-report-fixes#FR-013
 * @req docguard.field-report-fixes#FR-014
 * @req docguard.field-report-fixes#FR-015
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'cli', 'docguard.mjs');
const ENV = { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' };

function tree(t, files) {
  const dir = makeTempDir('dg-106-', t);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
const run = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: ENV, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
function init(dir) {
  const r = run(dir, ['init', '--skip-prompts', '--no-spec-kit']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
}
function setConfig(dir, edit) {
  const file = join(dir, '.docguard.json');
  const config = JSON.parse(readFileSync(file, 'utf8'));
  edit(config);
  writeFileSync(file, JSON.stringify(config, null, 2));
}
function guard(dir, extra = []) {
  const r = run(dir, ['guard', '--format', 'json', ...extra]);
  return { status: r.status, data: JSON.parse(r.stdout) };
}
const codes = (data, wanted) => data.findings.filter(f => wanted.includes(f.code));

const SFDX = '{"packageDirectories":[{"path":"force-app","default":true}],"sourceApiVersion":"62.0"}\n';
const JAVA_SECRET = 'package demo;\npublic class LegacyClient {\n    private static final String password = "Hx7#kQ2!vLp9zR";\n    private static final String accessToken = "q8Wd3LmZx2Rt7KpVb5Nc";\n}\n';
const APEX_SECRET = "public with sharing class LegacyClient {\n    private static final String password = 'Hx7#kQ2!vLp9zR';\n    private static final String accessToken = 'q8Wd3LmZx2Rt7KpVb5Nc';\n}\n";
const REQ = '\n## Functional Requirements\n\n- **FR-001**: The order total is the sum of the items.\n';

describe('issue 711: strict keeps the errors of a validator the project turned on', () => {
  it('a product secret fails strict as it fails standard when security is true', (t) => {
    const dir = tree(t, { 'package.json': '{"name":"demo","version":"1.0.0"}\n', 'src/main/java/demo/LegacyClient.java': JAVA_SECRET });
    init(dir);
    setConfig(dir, c => { c.validators.security = true; delete c.enforcement; });
    const strict = guard(dir);
    assert.equal(strict.status, 1, 'strict exits 1 for a product secret when security is on');
    for (const f of codes(strict.data, ['SEC001', 'SEC004'])) {
      assert.equal(f.effectiveSeverity, 'error', `${f.code} stays an error`);
      assert.equal(f.enforcement.source, 'intrinsic');
    }
    assert.equal(codes(strict.data, ['SEC001', 'SEC004']).length, 2);
    setConfig(dir, c => { c.enforcement = 'standard'; });
    assert.equal(guard(dir).status, 1);
  });

  it('a secret in a test path stays a warning under strict even when security is on', (t) => {
    const dir = tree(t, { 'package.json': '{"name":"demo","version":"1.0.0"}\n', 'src/test/java/demo/LegacyClientTest.java': JAVA_SECRET.replace('LegacyClient', 'LegacyClientTest') });
    init(dir);
    setConfig(dir, c => { c.validators.security = true; delete c.enforcement; });
    const found = codes(guard(dir).data, ['SEC001', 'SEC004']);
    assert.equal(found.length, 2);
    for (const f of found) {
      assert.equal(f.context, 'test-path');
      assert.equal(f.effectiveSeverity, 'warn');
      assert.equal(f.enforcement.source, 'strict-test-path');
    }
  });

  it('without the key the errors are warnings, and the text output says so', (t) => {
    const dir = tree(t, { 'package.json': '{"name":"demo","version":"1.0.0"}\n', 'src/main/java/demo/LegacyClient.java': JAVA_SECRET });
    init(dir);
    setConfig(dir, c => { delete c.validators.security; delete c.enforcement; });
    const { data } = guard(dir);
    assert.equal(codes(data, ['SEC001', 'SEC004']).every(f => f.effectiveSeverity === 'warn'), true);
    assert.equal(data.strict.demotedProductSecrets, 2);
    const text = run(dir, ['guard']).stdout;
    assert.match(text, /2 possible secrets in product code are warnings under strict/);
  });
});

describe('issue 711: strict is never weaker than standard for the same switches', () => {
  it('no finding resolves lower under strict than under standard when every validator is on', async () => {
    const { resolveFindingEnforcement } = await import('../cli/shared.mjs');
    const { strictFindingContext } = await import('../cli/enforcement.mjs');
    const { STRICT_ADDITIONS } = await import('../cli/strict-additions.mjs');
    const { CODES } = await import('../cli/findings.mjs');
    const keys = Object.values(STRICT_ADDITIONS).flatMap(a => a.validators);
    const config = { validators: Object.fromEntries(keys.map(k => [k, true])) };
    const context = strictFindingContext({ gating: ['SEC001', 'DRF001'], config });
    const rank = { info: 0, warn: 1, error: 2 };
    let compared = 0;
    for (const key of keys) for (const code of Object.keys(CODES).slice(0, 400)) for (const severity of ['error', 'warn', 'info']) for (const where of ['product', 'test-path', undefined]) {
      const finding = { code, severity, ...(where ? { context: where } : {}) };
      const strict = resolveFindingEnforcement(config, finding, key, context);
      const standard = resolveFindingEnforcement(config, finding, key, null).level;
      // The one documented exception: a test-path finding never fails a strict build (spec 097).
      if (where === 'test-path' && strict.source === 'strict-test-path') continue;
      assert.ok(rank[strict.level] >= rank[standard], `${key} ${code} ${severity} ${where}: strict ${strict.level} < standard ${standard}`);
      compared++;
    }
    assert.ok(compared > 1000);
  });
});

describe('issue 712: the secret scan reads Apex', () => {
  it('a password in a .cls file is SEC001, as in .java', (t) => {
    const dir = tree(t, { 'sfdx-project.json': SFDX, 'force-app/main/default/classes/LegacyClient.cls': APEX_SECRET });
    init(dir);
    setConfig(dir, c => { c.validators.security = true; c.enforcement = 'standard'; });
    const { status, data } = guard(dir);
    assert.equal(status, 1);
    assert.deepEqual(codes(data, ['SEC001', 'SEC004']).map(f => f.location).sort(),
      ['force-app/main/default/classes/LegacyClient.cls:2', 'force-app/main/default/classes/LegacyClient.cls:3']);
    assert.equal(codes(data, ['SEC011']).length, 0);
  });

  it('SEC011 names the source files it does not scan, by language', (t) => {
    const dir = tree(t, { 'build.sbt': 'name := "demo"\n', 'app/Main.scala': 'object Main { val password = "Hx7#kQ2!vLp9zR" }\n' });
    init(dir);
    setConfig(dir, c => { c.validators.security = true; c.enforcement = 'standard'; });
    const [f] = codes(guard(dir).data, ['SEC011']);
    assert.ok(f, 'SEC011 fires');
    assert.match(f.message, /1 Scala file/);
    assert.doesNotMatch(f.message, /sourceRoot/);
  });
});

describe('issue 713: tests in Maven modules and Apex test classes are tests', () => {
  it('a Maven multi-module test is found by Test-Spec', (t) => {
    const dir = tree(t, {
      'pom.xml': '<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>parent</artifactId><version>1.0</version><packaging>pom</packaging><modules><module>services/orders</module></modules></project>\n',
      'services/orders/pom.xml': '<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>orders</artifactId><version>1.0</version></project>\n',
      'services/orders/src/main/java/demo/OrderService.java': 'package demo; public class OrderService { public int total(int a, int b) { return a + b; } }\n',
      'services/orders/src/test/java/demo/OrderServiceTest.java': 'package demo;\nimport org.junit.jupiter.api.Test;\n// @req FR-001\nclass OrderServiceTest {\n    @Test void totalAddsBothValues() { }\n}\n',
    });
    init(dir);
    const { data } = guard(dir);
    assert.equal(codes(data, ['TSP007']).length, 0, 'no TSP007');
  });

  it('an Apex test class is a test, and its @req is read', (t) => {
    const dir = tree(t, {
      'sfdx-project.json': SFDX,
      'force-app/main/default/classes/OrderTotal.cls': 'public with sharing class OrderTotal {\n    public static Integer total(Integer a, Integer b) { return a + b; }\n}\n',
      'force-app/main/default/classes/OrderTotalTest.cls': "// @req FR-001\n@isTest\nprivate class OrderTotalTest {\n    @isTest static void totalAddsBothValues() { System.assertEquals(3, OrderTotal.total(1, 2), 'sum'); }\n}\n",
    });
    init(dir);
    writeFileSync(join(dir, 'docs-canonical/REQUIREMENTS.md'), readFileSync(join(dir, 'docs-canonical/REQUIREMENTS.md'), 'utf8') + REQ);
    const { data } = guard(dir);
    assert.equal(codes(data, ['TSP007']).length, 0, 'no TSP007');
    assert.equal(codes(data, ['TRC004']).filter(f => f.message.includes('FR-001')).length, 0, 'FR-001 is covered');
  });

  it('sfdx-project.json is the Salesforce DX ecosystem; Lightning UI makes it a webapp', async (t) => {
    const { detectProjectProfile } = await import('../cli/scanners/project-type.mjs');
    const { autoDetectProjectType } = await import('../cli/config.mjs');
    const bare = tree(t, { 'sfdx-project.json': SFDX, 'force-app/main/default/classes/A.cls': 'public class A {}\n' });
    const profile = detectProjectProfile(bare);
    assert.ok(profile.ecosystems.some(e => e.language === 'Apex' && e.framework === 'Salesforce DX'), JSON.stringify(profile.ecosystems));
    assert.equal(autoDetectProjectType(bare), 'unknown');
    const ui = tree(t, { 'sfdx-project.json': SFDX, 'force-app/main/default/lwc/widget/widget.js': 'export default class Widget {}\n' });
    assert.equal(autoDetectProjectType(ui), 'webapp');
  });
});

describe('the Apex language entry', () => {
  it('names Apex files, test classes and metadata the same way for every consumer', async () => {
    const lang = await import('../cli/shared-languages.mjs');
    assert.deepEqual([...lang.APEX.extensions], ['.cls', '.trigger', '.apex']);
    assert.equal(lang.APEX.id, 'apex');
    for (const p of ['classes/OrderTotalTest.cls', 'classes/OrderTotalTests.cls', 'classes/OrderTotal_Test.cls', 'classes/Test_OrderTotal.cls']) assert.equal(lang.isApexTestName(p), true, p);
    for (const p of ['classes/OrderTotal.cls', 'classes/Contest.cls', 'thesis/report.cls']) assert.equal(lang.isApexTestName(p), false, p);
    assert.equal(lang.declaresApexTest('@IsTest\nprivate class A {}'), true);
    assert.equal(lang.metadataApiName('objects/Widget__c/Widget__c.object-meta.xml'), 'Widget__c');
    assert.equal(lang.metadataApiName('classes/WidgetService.cls-meta.xml'), 'WidgetService');
    assert.equal(lang.metadataApiName('pom.xml'), null);
    const { languageOf } = await import('../cli/shared-source.mjs');
    assert.equal(languageOf('force-app/main/default/triggers/Order.trigger'), 'Apex');
  });
});

describe('issue 714: SPK008 sees Salesforce deliverables', () => {
  const files = {
    'sfdx-project.json': SFDX,
    'force-app/main/default/objects/Widget__c/Widget__c.object-meta.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"><label>Widget</label></CustomObject>\n',
    'force-app/main/default/objects/Widget__c/fields/Weight__c.field-meta.xml': '<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Weight__c</fullName></CustomField>\n',
    'specs/001-widgets/spec.md': '# Feature Specification: Widgets\n\n**Spec ID**: widgets\n\n## User Scenarios & Testing\n\nA user stores widgets.\n\n## Requirements\n\n- **FR-001**: The system stores a widget with a weight.\n\n## Success Criteria\n\n- **SC-001**: A widget can be saved.\n',
    'specs/001-widgets/plan.md': '# Plan: Widgets\n\nMetadata lives under `SF/` (short for `force-app/main/default/`).\n',
    'specs/001-widgets/tasks.md': '# Tasks: Widgets\n\n- [x] T001 Create custom object `Widget__c` in `SF/objects/Widget__c/` (FR-001)\n- [x] T002 Create field `Weight__c` in `SF/objects/Widget__c/fields/` (FR-001)\n',
  };

  it('metadata names, directories and Apex symbols are evidence', (t) => {
    const dir = tree(t, { ...files, 'force-app/main/default/classes/WidgetService.cls': 'public with sharing class WidgetService {\n    public static List<Widget__c> heavy() { return [SELECT Id, Weight__c FROM Widget__c WHERE Weight__c > 10]; }\n}\n' });
    init(dir);
    assert.equal(codes(guard(dir).data, ['SPK008']).length, 0);
  });

  it('a Widget__c symbol in Apex alone rescues T001', async (t) => {
    const { detectPhantomCompletions } = await import('../cli/scanners/speckit.mjs');
    const dir = tree(t, {
      'specs/001-a/tasks.md': '# Tasks\n\n- [x] T001 Query `Gadget__c` in `SF/classes/Gadgets.cls`\n',
      'force-app/main/default/classes/GadgetService.cls': 'public class GadgetService { List<Gadget__c> all() { return [SELECT Id FROM Gadget__c]; } }\n',
    });
    const [entry] = detectPhantomCompletions(dir, [{ hasTasks: true, tasksPath: join(dir, 'specs/001-a/tasks.md') }]);
    assert.deepEqual(entry.phantoms, []);
  });

  it('a file that quotes the task text is not evidence', async (t) => {
    const { detectPhantomCompletions } = await import('../cli/scanners/speckit.mjs');
    const task = 'Build `FrobnicateWidget` in `src/frob/frobnicate.js`';
    const dir = tree(t, {
      'specs/001-a/tasks.md': `# Tasks\n\n- [x] T001 ${task}\n`,
      'guard.json': JSON.stringify({ findings: [{ code: 'SPK008', message: `T001 marked [x] with no implementation evidence — "${task}"` }] }, null, 2),
      'notes.sh': `# ${task}\necho FrobnicateWidget\n`,
    });
    const [entry] = detectPhantomCompletions(dir, [{ hasTasks: true, tasksPath: join(dir, 'specs/001-a/tasks.md') }]);
    assert.equal(entry.phantoms.length, 1);
  });
});

describe('issue 715: values that cannot be credentials', () => {
  const shapes = {
    'package.json': '{"name":"shop","version":"1.0.0","type":"module"}\n',
    'src/routes.ts': "export const ROUTES = {\n  home: '/',\n  forgotPassword: '/forgot-password',\n};\n",
    'src/cookies.ts': "export const COOKIE_ACCESS_TOKEN = 'idp_access_token';\n",
    'src/metrics.ts': "export const METRIC = {\n  refreshAccessToken: 'auth.refreshAccessToken',\n};\n",
    'src/payment.ts': "export const PROVIDER_URLS = {\n  sandbox: {\n    accessToken: 'https://auth.sandbox.payments.test/oauth2/token',\n  },\n};\n",
    'src/test-utils/auth.ts': "export const SESSION = { access_token: 'fixture_access_token_1' };\n",
    'src/components/form.stories.tsx': "export default { title: 'Form' };\nexport const Filled = { args: { password: 'Sup3rSecret!x' } };\n",
    // Each of these must stay an error.
    'src/real/jwt.ts': "export const accessToken = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';\n",
    'src/real/slash.ts': "export const password = '/aB3$xY9kQ7mP2';\n",
    'src/real/userinfo.ts': "export const accessToken = 'https://deploy:Zp2Wm7x41k8Jd93@git.internal.test/repo.git';\n",
    'src/real/query.ts': "export const accessToken = 'https://api.internal.test/v1?access_token=Zp2Wm7x41k8Jd93Qa';\n",
    'src/real/suffix.ts': "export const ACCESS_TOKEN = 'access_token_Zp2Wm7x41k8';\n",
  };

  it('route, URL, name and label are low-confidence warnings that name the shape', (t) => {
    const dir = tree(t, shapes);
    init(dir);
    setConfig(dir, c => { c.validators.security = true; c.enforcement = 'standard'; });
    const { data } = guard(dir);
    const at = file => codes(data, ['SEC001', 'SEC004']).filter(f => f.location?.startsWith(file));
    for (const [file, word] of [['src/routes.ts', /route/], ['src/payment.ts', /URL/], ['src/cookies.ts', /name/], ['src/metrics.ts', /label/]]) {
      const [f] = at(file);
      assert.ok(f, `${file} is still reported`);
      assert.equal(f.severity, 'warn', `${file} is a warning`);
      assert.equal(f.confidence, 'low');
      assert.match(f.message, word);
      assert.doesNotMatch(f.message, /natural-language/);
    }
    for (const file of ['src/real/jwt.ts', 'src/real/slash.ts', 'src/real/userinfo.ts', 'src/real/query.ts', 'src/real/suffix.ts']) {
      assert.equal(at(file)[0]?.severity, 'error', `${file} stays an error`);
    }
    assert.equal(at('src/test-utils/auth.ts')[0]?.context, 'test-path');
    assert.equal(at('src/components/form.stories.tsx')[0]?.context, 'test-path');
  });

  it('a story is not test coverage', async () => {
    const { isTestSource } = await import('../cli/scanners/requirement-evidence.mjs');
    assert.equal(isTestSource('src/components/form.stories.tsx'), false);
  });
});

describe('issue 716: JSON says what the exit code says', () => {
  it('exitCode equals the process exit code for 1, 2, 3 and 4, in full and compact form', (t) => {
    const failing = tree(t, { 'package.json': '{"name":"demo","version":"1.0.0"}\n', 'src/main/java/demo/LegacyClient.java': JAVA_SECRET });
    init(failing);
    setConfig(failing, c => { c.validators.security = true; c.enforcement = 'standard'; });
    const unexamined = tree(t, { 'package.json': '{"name":"shop","version":"1.0.0","type":"module"}\n', 'src/routes.ts': "export const a = 1;\n" });
    init(unexamined);
    const warnings = tree(t, { 'package.json': '{"name":"shop","version":"1.0.0","type":"module"}\n', 'src/routes.ts': "export const a = 1;\n" });
    init(warnings);
    setConfig(warnings, c => { c.enforcement = 'standard'; });
    const uninitialized = tree(t, { 'README.md': '# x\n' });
    const seen = new Set();
    for (const [dir, outcome] of [[failing, 'errors'], [unexamined, 'unexamined'], [warnings, 'warnings'], [uninitialized, null]]) {
      for (const extra of [[], ['--compact']]) {
        const { status, data } = guard(dir, extra);
        assert.equal(data.exitCode, status, `exitCode matches for ${outcome} ${extra}`);
        if (outcome) assert.equal(data.outcome, outcome);
        seen.add(status);
      }
    }
    assert.deepEqual([...seen].sort(), [1, 2, 3, 4]);
  });

  it('ci --format json carries exitCode and outcome', (t) => {
    const dir = tree(t, { 'package.json': '{"name":"shop","version":"1.0.0","type":"module"}\n', 'src/routes.ts': "export const a = 1;\n" });
    init(dir);
    const r = run(dir, ['ci', '--format', 'json', '--no-history']);
    const data = JSON.parse(r.stdout);
    assert.equal(data.exitCode, r.status);
    assert.ok(['pass', 'warnings', 'blocked'].includes(data.outcome));
  });

  it('real guard and ci output satisfy their schemas', (t) => {
    const check = (schema, value, at) => {
      if (schema.enum) assert.ok(schema.enum.includes(value), `${at}: ${JSON.stringify(value)} not in ${schema.enum}`);
      if (schema.type === 'integer') assert.ok(Number.isInteger(value), `${at} is an integer`);
      if (schema.type === 'number') assert.equal(typeof value, 'number', at);
      if (schema.type === 'string') assert.equal(typeof value, 'string', at);
      if (schema.type === 'array') { assert.ok(Array.isArray(value), at); for (const [i, v] of value.entries()) if (schema.items) check(schema.items, v, `${at}[${i}]`); }
      if (schema.type === 'object') {
        assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${at} is an object`);
        for (const key of schema.required || []) assert.ok(Object.hasOwn(value, key), `${at}.${key} is present`);
        for (const [key, sub] of Object.entries(schema.properties || {})) if (Object.hasOwn(value, key)) check(sub, value[key], `${at}.${key}`);
      }
    };
    const schema = name => JSON.parse(readFileSync(join(ROOT, 'schemas', `docguard-${name}-result.schema.json`), 'utf8'));
    const dir = tree(t, { 'package.json': '{"name":"demo","version":"1.0.0"}\n', 'src/main/java/demo/LegacyClient.java': JAVA_SECRET });
    init(dir);
    check(schema('guard'), guard(dir).data, 'guard');
    check(schema('guard'), guard(dir, ['--compact']).data, 'guard --compact');
    check(schema('ci'), JSON.parse(run(dir, ['ci', '--format', 'json', '--no-history']).stdout), 'ci');
  });

  it('the ci summary agrees in number', async () => {
    const { buildReadinessAssessment } = await import('../cli/assessment.mjs');
    const guardData = { status: 'WARN', effectiveErrors: 0, effectiveWarnings: 1, findings: [], strict: { blocking: ['apiSurface'] }, validators: [] };
    const one = buildReadinessAssessment(guardData, { score: 50, grade: 'C' }, { threshold: 0, thresholdMet: true });
    assert.match(one.summary, /1 validator applies here/);
    const two = buildReadinessAssessment({ ...guardData, strict: { blocking: ['a', 'b'] } }, { score: 50, grade: 'C' }, { threshold: 0, thresholdMet: true });
    assert.match(two.summary, /2 validators apply here/);
  });
});

describe('issue 717: documentation folders are not source directories', () => {
  it('DCV003 skips docs/, keeps contracts/ and tools/; TRC002 skips unedited scaffolds', (t) => {
    const dir = tree(t, {
      'contracts/orders/api.raml': '#%RAML 1.0\ntitle: Orders\n/orders:\n  get:\n',
      'docs/adr/0001-runtime.md': '# ADR-001 Runtime\n\n**Status:** Accepted\n',
      'docs/GLOSSARY.md': '# Glossary\n',
      'notes/README.md': '# Notes\n',
      'tools/check.sh': '#!/bin/sh\necho ok\n',
      'README.md': '# Orders contracts\n',
    });
    init(dir);
    const { data } = guard(dir);
    const dirs = codes(data, ['DCV003']).map(f => f.location).sort();
    assert.deepEqual(dirs, ['contracts', 'tools']);
    const scaffolds = new Set(codes(data, ['STR006']).map(f => f.location));
    assert.ok(scaffolds.size > 0, 'STR006 reports the fresh scaffolds');
    for (const f of codes(data, ['TRC002'])) assert.equal(scaffolds.has(f.location), false, `${f.location} is reported once`);
  });
});
