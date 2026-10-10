/**
 * Fixes from dogfooding, round 2 (specs/061-dogfood-round-2): #525, #526, #527.
 *
 * @req docguard.dogfood-round-2#FR-001
 * @req docguard.dogfood-round-2#FR-002
 * @req docguard.dogfood-round-2#FR-003
 * @req docguard.dogfood-round-2#FR-004
 * @req docguard.dogfood-round-2#FR-005
 * @req docguard.dogfood-round-2#FR-006
 * @req docguard.dogfood-round-2#SC-001
 * @req docguard.dogfood-round-2#SC-002
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateDocsDiff, diffTechStack } from '../cli/validators/docs-diff.mjs';
import { detectCodeTechnologies } from '../cli/shared-source.mjs';
import { validateSecurity } from '../cli/validators/security.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'docguard.mjs');
const run = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], {
  cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
});
const write = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };

let dir;
const fresh = prefix => (dir = mkdtempSync(join(tmpdir(), `docguard-061-${prefix}-`)));
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; });

const finding = (result, code) => result.findings.find(f => f.code === code);
const diffJson = (projectDir, title) => {
  const r = run(['diff', '--dir', projectDir, '--format', 'json'], projectDir);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).find(x => x.title === title);
};

// ── #525: DDF002 reads documented tests with the configured test pattern ──

function testPatternProject(prefix, docTests) {
  fresh(prefix);
  write(dir, 'package.json', '{"name":"bot"}');
  write(dir, 'test_bot.mjs', "import 'node:test';\n");
  write(dir, 'test_web.mjs', "import 'node:test';\n");
  write(dir, 'docs-canonical/TEST-SPEC.md', '# Test Spec\n\n' + docTests.map(t => '- `' + t + '`').join('\n') + '\n');
  return dir;
}

describe('DDF002 reads documented tests with testPattern (FR-001, #525)', () => {
  it('matches documented test_*.mjs files under the legacy testPattern and testPatterns', () => {
    testPatternProject('pattern', ['test_bot.mjs', 'test_web.mjs']);
    assert.equal(finding(validateDocsDiff(dir, { testPattern: 'test_*.mjs' }), 'DDF002'), undefined);
    assert.equal(finding(validateDocsDiff(dir, { testPatterns: ['test_*.mjs'] }), 'DDF002'), undefined);
  });

  it('still reports a documented pattern file that does not exist', () => {
    testPatternProject('stale', ['test_bot.mjs', 'test_web.mjs', 'test_gone.mjs']);
    const f = finding(validateDocsDiff(dir, { testPattern: 'test_*.mjs' }), 'DDF002');
    assert.equal(f?.message, 'Test Files drift: 1 documented but not found in code: `test_gone.mjs`');
  });

  it('matches a bare file name against the last segment of a directory pattern', () => {
    fresh('dirpattern');
    write(dir, 'package.json', '{}');
    write(dir, 'tests/unit/test_api.py', 'def test_x(): pass\n');
    write(dir, 'docs-canonical/TEST-SPEC.md', '# Test Spec\n\n- `test_api.py`\n- `tests/unit/test_api.py`\n- `tests/**/test_*.py`\n');
    assert.equal(finding(validateDocsDiff(dir, { testPatterns: ['tests/**/test_*.py'] }), 'DDF002'), undefined);
  });

  it('diff uses the same definition', () => {
    testPatternProject('diff', ['test_bot.mjs', 'test_web.mjs']);
    write(dir, '.docguard.json', JSON.stringify({ projectName: 'bot', testPattern: 'test_*.mjs' }));
    const tests = diffJson(dir, 'Test Files');
    assert.deepEqual(tests.onlyInDocs, []);
    assert.deepEqual(tests.onlyInCode, []);
    assert.deepEqual(tests.matched.sort(), ['test_bot.mjs', 'test_web.mjs']);
  });

  it('without a pattern, documented non-.test names are still not tests', () => {
    testPatternProject('nopattern', ['test_bot.mjs']);
    write(dir, 'tests/a.test.mjs', '');
    const f = finding(validateDocsDiff(dir, {}), 'DDF002');
    assert.equal(f?.message, 'Test Files drift: 1 in code but not documented: `tests/a.test.mjs`');
  });
});

// ── #526: DDF001 finds DynamoDB and Docker without a manifest entry ──

function rawDynamoProject(prefix, arch) {
  fresh(prefix);
  write(dir, 'package.json', '{"name":"zero-dep","type":"module"}');
  write(dir, 'lib/db.mjs', [
    "const endpoint = process.env.DDB_ENDPOINT || 'http://localhost:8000';",
    'export async function put(item) {',
    "  return fetch(endpoint, { method: 'POST', headers: { 'X-Amz-Target': 'DynamoDB_20120810.PutItem' }, body: JSON.stringify(item) });",
    '}',
    '',
  ].join('\n'));
  write(dir, 'start.sh', '#!/bin/sh\ndocker run -d -p 8000:8000 amazon/dynamodb-local\nnode server.mjs\n');
  write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n\n## Tech Stack\n\n' + arch + '\n');
  return dir;
}

describe('DDF001 reads DynamoDB and Docker from source text (FR-002, FR-003, FR-004, #526)', () => {
  it('documented DynamoDB and Docker are found in code', () => {
    rawDynamoProject('found', 'DynamoDB stores sessions. Docker runs DynamoDB Local for development.');
    assert.deepEqual(diffTechStack(dir), { title: 'Tech Stack', onlyInDocs: [], onlyInCode: [] });
    assert.equal(finding(validateDocsDiff(dir, {}), 'DDF001'), undefined);
  });

  it('undocumented text-detected technologies name the file they came from', () => {
    rawDynamoProject('evidence', 'A plain Node.js server.');
    const f = finding(validateDocsDiff(dir, {}), 'DDF001');
    assert.match(f.message, /`DynamoDB` \(lib\/db\.mjs: [^)]+\)/);
    assert.match(f.message, /`Docker` \(start\.sh: docker run\)/);
    const tech = diffJson(dir, 'Tech Stack');
    assert.deepEqual(tech.onlyInCode, ['DynamoDB', 'Docker']);
    assert.equal(tech.evidence.DynamoDB.file, 'lib/db.mjs');
    assert.equal(tech.evidence.Docker.file, 'start.sh');
    const text = run(['diff', '--dir', dir], dir).stdout;
    assert.match(text, /\+ DynamoDB\s+\(lib\/db\.mjs/);
    assert.match(text, /\+ Docker\s+\(start\.sh: docker run\)/);
  });

  it('manifest-detected technology messages are byte-identical', () => {
    fresh('manifest');
    write(dir, 'package.json', JSON.stringify({ dependencies: { react: '18.3.1' } }));
    write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n\nA server.\n');
    assert.equal(finding(validateDocsDiff(dir, {}), 'DDF001').message, 'Tech Stack drift: 1 in code but not documented: `React`');
    write(dir, 'package.json', JSON.stringify({ dependencies: { '@aws-sdk/lib-dynamodb': '3.600.0' } }));
    assert.deepEqual(detectCodeTechnologies(dir), ['DynamoDB']);
    assert.equal(diffJson(dir, 'Tech Stack').evidence.DynamoDB.file, 'package.json');
  });

  for (const [name, rel, text] of [
    ['an SDK v2 client', 'src/store.js', "const AWS = require('aws-sdk');\nconst db = new AWS.DynamoDB.DocumentClient();\n"],
    ['a boto3 resource', 'app/store.py', "import boto3\ntable = boto3.resource('dynamodb').Table('t')\n"],
    ['a regional endpoint', 'src/store.ts', "export const url = 'https://dynamodb.us-east-1.amazonaws.com';\n"],
    ['a DYNAMODB_ENDPOINT read', 'src/cfg.ts', 'export const e = process.env.DYNAMODB_ENDPOINT;\n'],
  ]) {
    it('recognises DynamoDB from ' + name, () => {
      fresh('ddb');
      write(dir, 'package.json', '{}');
      write(dir, rel, text);
      assert.deepEqual(detectCodeTechnologies(dir), ['DynamoDB']);
    });
  }

  for (const [name, rel, text] of [
    ['a compose file', 'deploy/compose.yaml', 'services:\n  db:\n    image: postgres\n'],
    ['a CI workflow', '.github/workflows/ci.yml', 'jobs:\n  b:\n    steps:\n      - run: docker build -t app .\n'],
    ['a Makefile', 'Makefile', 'up:\n\tdocker compose up -d\n'],
    ['docker-compose in a script', 'scripts/dev.bash', 'docker-compose up\n'],
  ]) {
    it('recognises Docker from ' + name, () => {
      fresh('docker');
      write(dir, 'package.json', '{}');
      write(dir, rel, text);
      assert.deepEqual(detectCodeTechnologies(dir), ['Docker']);
      write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n\nA server.\n');
      assert.ok(finding(validateDocsDiff(dir, {}), 'DDF001').message.includes('(' + rel + ':'), rel);
    });
  }

  it('tests, fixtures, comments, ignored paths and ambiguous words are not evidence', () => {
    fresh('negative');
    write(dir, 'package.json', '{}');
    write(dir, 'tests/db.test.mjs', "const t = 'DynamoDB_20120810.PutItem';\n");
    write(dir, 'src/db.test.mjs', "const t = 'DynamoDB_20120810.PutItem';\n");
    write(dir, 'fixtures/ddb.mjs', "const t = 'DynamoDB_20120810.PutItem';\n");
    write(dir, 'src/notes.mjs', "// 'X-Amz-Target': 'DynamoDB_20120810.PutItem'\nconst label = 'Uses dynamodb and redis';\n");
    write(dir, 'scripts/dev.sh', '#!/bin/sh\n# docker run amazon/dynamodb-local\necho docker\n');
    write(dir, 'legacy/ddb.mjs', "const t = 'DynamoDB_20120810.PutItem';\n");
    assert.deepEqual(detectCodeTechnologies(dir, { ignore: ['legacy/**'] }), []);
  });
});

// ── TypeORM and Sequelize are named technologies (FR-006) ──

describe('DDF001 names TypeORM and Sequelize (FR-006)', () => {
  for (const [tech, dep] of [['TypeORM', 'typeorm'], ['Sequelize', 'sequelize']]) {
    it(tech + ' present but undocumented, documented but absent, and matched', () => {
      fresh(dep);
      write(dir, 'package.json', JSON.stringify({ dependencies: { [dep]: '1.0.0', pg: '8.0.0' } }));
      write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n\nPostgreSQL stores orders.\n');
      assert.deepEqual(diffTechStack(dir).onlyInCode, [tech]);
      assert.equal(finding(validateDocsDiff(dir, {}), 'DDF001').message, 'Tech Stack drift: 1 in code but not documented: `' + tech + '`');
      write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n\nPostgreSQL stores orders through ' + tech + '.\n');
      assert.deepEqual(diffTechStack(dir), { title: 'Tech Stack', onlyInDocs: [], onlyInCode: [] });
      write(dir, 'package.json', JSON.stringify({ dependencies: { pg: '8.0.0' } }));
      assert.deepEqual(diffTechStack(dir).onlyInDocs, [tech]);
    });
  }

  it('Mongoose stays MongoDB and is not a technology of its own', () => {
    fresh('mongoose');
    write(dir, 'package.json', JSON.stringify({ dependencies: { mongoose: '8.0.0' } }));
    write(dir, 'docs-canonical/ARCHITECTURE.md', '# Architecture\n\nMongoDB, through Mongoose, stores profiles.\n');
    assert.deepEqual(detectCodeTechnologies(dir), ['MongoDB']);
    assert.deepEqual(diffTechStack(dir), { title: 'Tech Stack', onlyInDocs: [], onlyInCode: [] });
  });
});

// ── #527: SEC001 skips password labels ──

function scanLine(prefix, line) {
  fresh(prefix);
  write(dir, '.gitignore', '.env\n');
  write(dir, 'lib/webText.mjs', line + '\n');
  return validateSecurity(dir, {}).findings.filter(f => f.code === 'SEC001');
}

describe('SEC001 skips password labels (FR-005, #527)', () => {
  for (const line of [
    "export const t = { f_password: 'Password' };",
    "export const de = { password: 'Passwort' };",
    "export const es = { f_password: 'Contraseña' };",
    "export const fr = { f_password: 'Mot de passe' };",
    "export const nl = { password: 'Wachtwoord' };",
    "export const sv = { password: 'Lösenord' };",
    "export const pt = { password: 'Palavra-passe' };",
    "export const en = { confirmPassword: 'Confirm Password' };",
    "labels.password = 'Enter password';",
    "export const en2 = { password: 'Password:' };",
    "export const es2 = { newPassword: 'Nueva contraseña' };",
    "export const k = { user_passwd: 'User Passwd' };",
    "export const l = { passwordLabel: 'Enter password' };",
  ]) {
    it('does not report ' + line, () => {
      assert.deepEqual(scanLine('label', line).map(f => f.message), []);
    });
  }

  it('does not report a whole catalog', () => {
    const catalog = ['Password', 'Senha', 'Contraseña', 'Mot de passe', 'Passwort', 'Wachtwoord', 'Parola',
      'Пароль', 'パスワード', '密码', '비밀번호'].map((w, i) => `  l${i}: { f_password: '${w}' },`);
    assert.deepEqual(scanLine('catalog', 'export const webText = {\n' + catalog.join('\n') + '\n};').map(f => f.message), []);
  });

  for (const line of [
    "const config = { password: 'hunter2xyz!' };",
    "const DB_PASSWORD = 's3cr3tP4ssw0rd';",
    "const DB_PASSWORD = 'Password';",
    "const config = { password: 'password' };",
    "const config = { password: 'Password123' };",
    "const config = { password: 'Correct1 Password' };",
  ]) {
    it('still reports ' + line, () => {
      const found = scanLine('secret', line);
      assert.equal(found.length, 1, line);
      assert.equal(found[0].severity, 'error');
    });
  }
});

describe('the reported project guards clean (SC-002)', () => {
  it('guard reports no DDF001, DDF002 or SEC001 for the three reproductions together', () => {
    rawDynamoProject('guard', 'DynamoDB stores sessions. Docker runs DynamoDB Local for development.');
    write(dir, '.docguard.json', JSON.stringify({ projectName: 'zero-dep', testPattern: 'test_*.mjs', validators: { security: true } }));
    write(dir, '.gitignore', '.env\n');
    write(dir, 'test_bot.mjs', "import 'node:test';\n");
    write(dir, 'docs-canonical/TEST-SPEC.md', '# Test Spec\n\n- `test_bot.mjs`\n');
    write(dir, 'lib/webText.mjs', "export const webText = { en: { f_password: 'Password' }, es: { f_password: 'Contraseña' } };\n");
    const reported = () => JSON.parse(run(['guard', '--dir', dir, '--format', 'json'], dir).stdout)
      .findings.filter(f => ['DDF001', 'DDF002', 'SEC001'].includes(f.code)).map(f => f.code);
    assert.deepEqual(reported(), []);
    // Control: the same run still reports a real credential and a missing test.
    write(dir, 'lib/webText.mjs', "export const config = { password: 'hunter2xyz!' };\n");
    write(dir, 'docs-canonical/TEST-SPEC.md', '# Test Spec\n\n- `test_bot.mjs`\n- `test_gone.mjs`\n');
    assert.deepEqual(reported().sort(), ['DDF002', 'SEC001']);
  });
});
