import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { validateSecurity } from '../cli/validators/security.mjs';
import { validateTodoTracking } from '../cli/validators/todo-tracking.mjs';

// @req docguard.precision-evidence-loop#FR-003

function scan(t, source, validator, filename = 'sample.test.tsx') {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-field-context-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  safeWrite(join(dir, filename), source);
  safeWrite(join(dir, '.gitignore'), '.env\n');
  return validator(dir, {}).findings || [];
}

const skipCases = [
  ['accepts conditional reason', "test.skip(isUnavailable(), 'Service not available');", 0],
  ['accepts multiline nested condition', "test.skip(\n feature({ enabled: false }),\n 'Adapter unavailable'\n);", 0],
  ['accepts conditional fixme reason', "test.fixme(true, 'Waiting for adapter repair');", 0],
  ['retains unexplained skip', 'test.skip();', 1],
  ['retains unexplained fixme', 'test.fixme(true);', 1],
  ['retains declaration title', "test.skip('renders when offline', () => {});", 1],
  ['retains async declaration title', "test.skip('renders when offline', async () => {});", 1],
  ['retains empty reason', "test.skip(true, '   ');", 1],
  ['retains dynamic reason', 'test.skip(true, reason);', 1],
  ['accepts leading explanation', "// REASON: adapter unavailable\ntest.skip('offline', () => {});", 0],
  ['accepts block explanation', "/*\n * REASON: adapter unavailable\n */\ntest.skip('offline', () => {});", 0],
  ['accepts trailing explanation', "test.skip('offline', () => {}); // REASON: adapter unavailable", 0],
  ['retains empty comment reason', "// REASON:   \ntest.skip();", 1],
  ['does not borrow preceding test explanation', "test.skip(); // REASON: adapter unavailable\ntest.skip();", 1],
  ['does not borrow following test explanation', "test.skip();\n// REASON: adapter unavailable\ntest.skip();", 1],
  ['does not cross intervening code', "// REASON: adapter unavailable\nsetup();\ntest.skip();", 1],
  ['does not borrow callback comment', "test.skip('offline', () => {\n// REASON: explains a nested workaround\n});", 1],
  ['retains two calls on one line independently', "test.skip(true, 'Adapter unavailable'); test.skip();", 1],
  ['ignores quoted skip syntax', 'const sample = "test.skip()";', 0],
  ['ignores commented skip syntax', '// test.skip();', 0],
  ['retains parse-failure skip', 'test.skip();\nconst invalid = ;', 1],
];
for (const [name, source, count] of skipCases) {
  test(name, t => {
    assert.equal(scan(t, source, validateTodoTracking).filter(f => f.code === 'TDO001').length, count);
  });
}

for (const value of ['TestPassword42!', 'mock-password7', 'dummy_pwd99', 'fixturePasswd8']) {
  test('accepts explicit synthetic password in mock expectation: ' + value, t => {
    const source = 'expect(createAccount).toHaveBeenCalledWith({\n password: ' + JSON.stringify(value) + '\n});';
    assert.equal(scan(t, source, validateSecurity).filter(f => f.code === 'SEC001').length, 0);
  });
}

for (const value of ['actualsecret', 'Q7z!k3Lm9$Vb', 'SuperSecretPassword!', 'test-production-secret']) {
  test('retains unknown credential inside mock expectation: ' + value, t => {
    const source = 'expect(createAccount).toHaveBeenCalledWith({ password: ' + JSON.stringify(value) + ' });';
    const finding = scan(t, source, validateSecurity).find(f => f.code === 'SEC001');
    assert.equal(finding?.severity, 'error');
    assert.equal(finding?.confidence, 'high');
    assert.ok(!JSON.stringify(finding).includes(value));
  });
}

for (const [name, source, filename] of [
  ['production file', 'expect(createAccount).toHaveBeenCalledWith({ password: "TestPassword42!" });', 'src/account.ts'],
  ['test assignment', 'const password = "TestPassword42!";', 'sample.test.ts'],
  ['non-expect receiver', 'client.toHaveBeenCalledWith({ password: "TestPassword42!" });', 'sample.test.ts'],
  ['nested executing callback', 'expect(client).toHaveBeenCalledWith(() => { const password = "TestPassword42!"; });', 'sample.test.ts'],
  ['broken syntax', 'expect(client).toHaveBeenCalledWith({ password: "TestPassword42!" }); const broken = ;', 'sample.test.ts'],
]) {
  test('retains synthetic-looking credential outside proven fixture: ' + name, t => {
    assert.equal(scan(t, source, validateSecurity, filename).find(f => f.code === 'SEC001')?.severity, 'error');
  });
}

test('retains later real password after safe mock fixture', t => {
  const findings = scan(t, 'expect(client).toHaveBeenCalledWith({ password: "TestPassword42!" });\nconst password = "actualsecret";', validateSecurity);
  assert.equal(findings.find(f => f.code === 'SEC001')?.location, 'sample.test.tsx:2');
});

test('retains later real password after prose warning', t => {
  const findings = scan(t, 'const password = "This is validation copy";\nconst pwd = "actualsecret";', validateSecurity);
  assert.equal(findings.filter(f => f.code === 'SEC001').length, 2);
  assert.equal(findings.find(f => f.severity === 'error')?.location, 'sample.test.tsx:2');
});

test('retains later real password after scoped suppression', t => {
  const findings = scan(t, 'const password = "actualsecret"; // docguard:ignore SEC001 — synthetic control\n\nconst pwd = "actualsecret";', validateSecurity);
  assert.equal(findings.find(f => f.code === 'SEC001')?.location, 'sample.test.tsx:3');
});

test('retains recognizable provider keys in mock expectations', t => {
  const aws = 'AKIA' + 'A1B2C3D4E5F6G7H8';
  const api = 'sk_live_' + 'a1b2c3d4e5f6g7h8i9j0';
  const source = 'expect(client).toHaveBeenCalledWith({ password: "TestPassword42!", access: ' + JSON.stringify(aws) + ', key: ' + JSON.stringify(api) + ' });';
  const findings = scan(t, source, validateSecurity);
  assert.ok(findings.some(f => f.code === 'SEC005' && f.severity === 'error'));
  assert.ok(findings.some(f => f.code === 'SEC006' && f.severity === 'error'));
});

for (const [name, source, count] of [
  ['nested suite skip remains visible', "test.describe.skip('unexplained suite', () => {});", 1],
  ['nested suite skip accepts scoped comment', "// REASON: adapter unavailable\ntest.describe.skip('suite', () => {});", 0],
  ['static template reason is explicit', 'test.skip(true, `Adapter unavailable`);', 0],
  ['empty template is not a reason', 'test.skip(true, `   `);', 1],
  ['interpolated template remains uncertain', 'test.skip(true, `Reason: ${detail}`);', 1],
  ['template title is not a reason', 'test.skip(`Offline test`, () => {});', 1],
]) {
  test(name, t => assert.equal(scan(t, source, validateTodoTracking).filter(f => f.code === 'TDO001').length, count));
}

for (const note of ['example', 'password123', 'placeholder="hint"']) {
  test('unrelated placeholder field cannot suppress password: ' + note, t => {
    const source = 'expect(client).toHaveBeenCalledWith({ password: "Arbitrary9!", note: ' + JSON.stringify(note) + ' });';
    assert.equal(scan(t, source, validateSecurity).find(f => f.code === 'SEC001')?.severity, 'error');
  });
  test('unrelated placeholder field cannot suppress provider keys: ' + note, t => {
    const source = 'const credentials = { password: "Arbitrary9!", aws: "AKIA' + 'A1B2C3D4E5F6G7H8", key: "sk_live_' + 'a1b2c3d4e5f6g7h8i9j0", note: ' + JSON.stringify(note) + ' };';
    const findings = scan(t, source, validateSecurity);
    for (const code of ['SEC001', 'SEC005', 'SEC006']) assert.equal(findings.find(f => f.code === code)?.severity, 'error', code);
  });
}

test('matched password placeholder does not conceal second password on same line', t => {
  const source = 'const fixture = { password: "password123", pwd: "actualsecret" };';
  assert.equal(scan(t, source, validateSecurity).find(f => f.code === 'SEC001')?.severity, 'error');
});

test('retains matched placeholder exemption independently of unrelated fields', t => {
  const source = 'const fixture = { password: "password123", note: "arbitrary" };';
  assert.equal(scan(t, source, validateSecurity).filter(f => f.code === 'SEC001').length, 0);
});

test('trailing example comment does not excuse a credential', t => {
  assert.equal(scan(t, 'const password = "actualsecret"; // example usage', validateSecurity).find(f => f.code === 'SEC001')?.severity, 'error');
});

test('TypeScript type annotations cannot hide hardcoded credentials', t => {
  const source = [
    'const password: string = "actualsecret";',
    'class Config { apiKey?: string = "real-looking-api-key-value"; }',
    'const config: { secretKey: string } = { secretKey: "real-looking-secret-key-value" };',
  ].join('\n');
  const findings = scan(t, source, validateSecurity, 'sample.ts');
  for (const code of ['SEC001', 'SEC002', 'SEC003']) {
    assert.ok(findings.some(finding => finding.code === code), code);
  }
});
