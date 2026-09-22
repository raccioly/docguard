import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { removedTokens } from '../cli/shared-diff.mjs';
import { validateDiffSuspicion } from '../cli/validators/diff-suspicion.mjs';
import { diffTechStack, validateDocsDiff } from '../cli/validators/docs-diff.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dg-field-diff-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const write = (dir, path, text) => safeWrite(join(dir, path), text);
function revisions(t, file, before, after, docs) {
  const dir = fixture(t);
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: dir, encoding: 'utf8', stdio: 'pipe',
  });
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  write(dir, file, before);
  for (const [path, text] of Object.entries(docs)) write(dir, path, text);
  git('add', '.'); git('commit', '-qm', 'before');
  write(dir, file, after);
  git('add', file); git('commit', '-qm', 'after');
  return dir;
}

it('subtracts reintroduced tokens across hunks while retaining removed API identifiers', () => {
  const file = { hunks: [
    { lines: [{ op: '-', text: 'export function legacySession() { return refreshCredential(); }' }] },
    { lines: [{ op: '+', text: 'export function activeSession() {\n return refreshCredential();\n}' }] },
  ] };
  const tokens = removedTokens(file);
  assert.ok(tokens.has('legacysession'));
  assert.ok(!tokens.has('refreshcredential'));
  assert.ok(!tokens.has('credential'));
});

it('quiets formatting-only JavaScript and still warns on a removed API', t => {
  const before = 'export function refreshCredential() { return checkSession(); }\n';
  const doc = { 'docs-canonical/API.md': 'src/session.js exposes refreshCredential and checkSession.' };
  const quiet = revisions(t, 'src/session.js', before,
    'export function refreshCredential() {\n  return checkSession();\n}\n', doc);
  assert.deepEqual(validateDiffSuspicion(quiet).findings, []);
  const defect = revisions(t, 'src/session.js', before, 'export function issueCredential() {}\n', doc);
  const findings = validateDiffSuspicion(defect).findings;
  assert.equal(findings.length, 1);
  assert.equal(findings[0].location, 'docs-canonical/API.md');
  assert.match(findings[0].message, /possible drift/);
  assert.equal(findings[0].confidence, 'low');
});

const python = spawnSync('python3', ['-I', '-S', '-c', 'import ast'], { encoding: 'utf8' }).status === 0;
it('quiets AST-equivalent Python literal formatting without executing project code', { skip: !python }, t => {
  const before = 'raise RuntimeError("must not execute")\nlabel = "legacy" "Session"\ndef refresh_credential():\n    return label\n';
  const doc = { 'docs-canonical/API.md': 'src/session.py uses legacy Session and refresh_credential.' };
  // Implicit literal concatenation changes lexical tokens but not Python's AST.
  const same = before.replace('"legacy" "Session"', '"legacySession"');
  const quiet = revisions(t, 'src/session.py', before, same, doc);
  write(quiet, 'ast.py', 'raise RuntimeError("must not import local modules")\n');
  assert.deepEqual(validateDiffSuspicion(quiet).findings, []);
  assert.ok(!existsSync(join(quiet, '__pycache__')));
  const defect = revisions(t, 'src/session.py', before,
    'raise RuntimeError("must not execute")\nlabel = "new"\ndef issue_credential():\n    return label\n', doc);
  assert.ok(validateDiffSuspicion(defect).findings.length > 0);
});

it('retains evidence when Python cannot parse either revision', t => {
  const dir = revisions(t, 'src/session.py', 'def refresh_credential(:\n pass\n',
    'def issue_credential(:\n pass\n',
    { 'docs-canonical/API.md': 'src/session.py exposes refresh_credential().' });
  assert.ok(validateDiffSuspicion(dir).findings.length > 0);
});

it('keeps nested documents with identical basenames separate', t => {
  const dir = revisions(t, 'src/session.js', 'export function refreshCredential() {}\n',
    'export function issueCredential() {}\n', {
      'docs-canonical/one/API.md': 'src/session.js exposes refreshCredential().',
      'docs-canonical/two/API.md': 'src/session.js exposes refreshCredential().',
    });
  const paths = validateDiffSuspicion(dir).findings.map(f => f.location).sort();
  assert.deepEqual(paths, ['docs-canonical/one/API.md', 'docs-canonical/two/API.md']);
});

for (const text of [
  'Terraform is not used. Docker is used.',
  'We use Docker, not Terraform.',
  'No Terraform is required; Docker runs the service.',
  'We previously used Terraform, but now use Docker.',
  'Terraform was previously used; Docker is used.',
  '| Terraform | Not used |\n| Docker | Deployment |',
  'We use Docker without Terraform.',
  'We do not use Terraform and use Docker.',
]) {
  it('scopes negative or historical technology evidence: ' + text, t => {
    const dir = fixture(t);
    write(dir, 'package.json', '{}');
    write(dir, 'Dockerfile', 'FROM scratch\n');
    write(dir, 'docs-canonical/ARCHITECTURE.md', text);
    assert.deepEqual(diffTechStack(dir), { title: 'Tech Stack', onlyInDocs: [], onlyInCode: [] });
    // Neighboring real defect: an affirmative missing technology still warns.
    write(dir, 'docs-canonical/ARCHITECTURE.md', text + '\nTerraform provisions production.');
    assert.deepEqual(diffTechStack(dir).onlyInDocs, ['Terraform']);
  });
}

it('does not let a negative mention document technology actually present', t => {
  const dir = fixture(t);
  write(dir, 'package.json', '{}');
  write(dir, 'infra/main.tf', 'resource "example" "instance" {}\n');
  write(dir, 'docs-canonical/ARCHITECTURE.md', 'Terraform is not used.');
  assert.deepEqual(diffTechStack(dir).onlyInCode, ['Terraform']);
});

it('does not match technology substrings as current claims', t => {
  const dir = fixture(t);
  write(dir, 'package.json', '{}');
  write(dir, 'docs-canonical/ARCHITECTURE.md', 'Reactive patterns improve expressiveness.');
  assert.equal(diffTechStack(dir), null);
  write(dir, 'docs-canonical/ARCHITECTURE.md', 'React is used.');
  assert.deepEqual(diffTechStack(dir).onlyInDocs, ['React']);
});

it('uses configured architecture/test roles for reads and finding locations', t => {
  const dir = fixture(t);
  write(dir, 'package.json', '{}');
  write(dir, 'handbook/design.md', 'Redis is used.');
  write(dir, 'handbook/testing.md', 'Run \x60missing.test.js\x60.');
  const config = { docs: { roles: {
    architecture: 'handbook/design.md', testSpec: 'handbook/testing.md',
  } } };
  const findings = validateDocsDiff(dir, config).findings;
  assert.deepEqual(findings.map(f => [f.code, f.location]), [
    ['DDF001', 'handbook/design.md'], ['DDF002', 'handbook/testing.md'],
  ]);
  write(dir, 'handbook/design.md', 'Redis is not used.');
  write(dir, 'handbook/testing.md', 'No test inventory.');
  assert.deepEqual(validateDocsDiff(dir, config).findings, []);
});

it('retains deleted declarations when a reformatted call still names the API', t => {
  const before = 'export function refreshCredential() { return 1; }\nrefreshCredential();\n';
  const docs = { 'docs-canonical/API.md': 'src/session.js exposes refreshCredential().' };
  const dir = revisions(t, 'src/session.js', before, 'refreshCredential(\n);\n', docs);
  assert.ok(validateDiffSuspicion(dir).findings.some(f => f.code === 'DSP001'));
  const quiet = revisions(t, 'src/session.js', before,
    'export function\nrefreshCredential() {\n return 1;\n}\nrefreshCredential(\n);\n', docs);
  assert.deepEqual(validateDiffSuspicion(quiet).findings, []);
});

it('preserves declaration names in shared diff tokens despite retained calls', () => {
  const lines = [
    { op: '-', text: 'function refreshCredential() {}' },
    { op: '-', text: 'refreshCredential();' },
    { op: '+', text: 'refreshCredential(' },
    { op: '+', text: ');' },
  ];
  assert.ok(removedTokens({ hunks: [{ lines }] }).has('refreshcredential'));
  lines.push({ op: '+', text: 'function refreshCredential() {' }, { op: '+', text: '}' });
  assert.deepEqual([...removedTokens({ hunks: [{ lines }] })], []);
});

it('matches affirmative Next.js literally and retains missing-dependency drift', t => {
  const dir = fixture(t);
  write(dir, 'package.json', '{}');
  write(dir, 'docs-canonical/ARCHITECTURE.md', 'Next.js renders the application.');
  assert.deepEqual(diffTechStack(dir).onlyInDocs, ['Next.js']);
  write(dir, 'package.json', '{"dependencies":{"next":"15.0.0"}}');
  assert.deepEqual(diffTechStack(dir), { title: 'Tech Stack', onlyInDocs: [], onlyInCode: [] });
  write(dir, 'docs-canonical/ARCHITECTURE.md', 'NextXjs renders the application.');
  assert.deepEqual(diffTechStack(dir).onlyInCode, ['Next.js']);
});

for (const predicate of ['is used in production', 'it is used in production']) {
  it('retains optional technology with affirmative subject continuation: ' + predicate, t => {
    const dir = fixture(t);
    write(dir, 'package.json', '{}');
    write(dir, 'docs-canonical/ARCHITECTURE.md',
      'Docker is not required, but ' + predicate + '. Terraform is not used.');
    assert.deepEqual(diffTechStack(dir).onlyInDocs, ['Docker']);
    write(dir, 'Dockerfile', 'FROM scratch\n');
    assert.deepEqual(diffTechStack(dir), { title: 'Tech Stack', onlyInDocs: [], onlyInCode: [] });
  });
}

it('does not infer use from optionality or carry subjects across sentences', t => {
  const dir = fixture(t);
  write(dir, 'package.json', '{}');
  write(dir, 'docs-canonical/ARCHITECTURE.md', 'Docker is not required. Terraform is not used.');
  assert.equal(diffTechStack(dir), null);
  write(dir, 'docs-canonical/ARCHITECTURE.md', 'Docker is not required, but Terraform is used.');
  assert.deepEqual(diffTechStack(dir).onlyInDocs, ['Terraform']);
});

it('suppresses only AST-equivalent JS revisions when removed prose overlaps docs', t => {
  const docs = { 'docs-canonical/API.md': 'src/session.js exposes refreshCredential() for rotating sessions.' };
  const before = '// rotating sessions\nexport function refreshCredential() { return 1; }\n';
  const same = revisions(t, 'src/session.js', before,
    'export function refreshCredential() {\n return 1;\n}\n', docs);
  assert.deepEqual(validateDiffSuspicion(same).findings, []);
  const changed = revisions(t, 'src/session.js', before,
    'export function refreshCredential() { return 2; }\n', docs);
  assert.ok(validateDiffSuspicion(changed).findings.some(f => f.code === 'DSP001'));
});

it('negates all items in an explicit unused list without hiding later assertions', t => {
  const dir = fixture(t);
  write(dir, 'package.json', '{}');
  write(dir, 'docs-canonical/ARCHITECTURE.md', 'No Builder, Terraform, or Provisioner is used.');
  assert.equal(diffTechStack(dir), null);
  write(dir, 'docs-canonical/ARCHITECTURE.md',
    'No Builder, Terraform, or Provisioner is used, but Docker is used.');
  assert.deepEqual(diffTechStack(dir).onlyInDocs, ['Docker']);
  write(dir, 'docs-canonical/ARCHITECTURE.md',
    'No Builder, Terraform, or Provisioner is used. Terraform provisions production.');
  assert.deepEqual(diffTechStack(dir).onlyInDocs, ['Terraform']);
  write(dir, 'docs-canonical/ARCHITECTURE.md',
    'No Terraform is required, Docker is used.');
  assert.deepEqual(diffTechStack(dir).onlyInDocs, ['Docker']);
});
