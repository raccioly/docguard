import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { validateDocsCoverage } from '../cli/validators/docs-coverage.mjs';
import { astTierAvailable } from '../cli/scanners/js-ast.mjs';

function scan(t, source, docs = '') {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-reference-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  safeWrite(join(dir, 'README.md'), '# Fixture\n## Installation\n## Usage\n## License\n' + docs);
  safeWrite(join(dir, 'src/config.ts'), source);
  return (validateDocsCoverage(dir, {}).findings || []).filter(f => f.code === 'DCV004');
}
const parsed = { skip: !astTierAvailable() };

for (const method of ['join', 'resolve', 'existsSync', 'accessSync']) {
  test(method + ' retains ambiguous directory/path evidence as review only', parsed, t => {
    const args = ['join', 'resolve'].includes(method) ? "homedir, '.config'" : "'.config'";
    const results = scan(t, method + '(' + args + ');');
    assert.equal(results.length, 1);
    const [result] = results;
    assert.equal(result.confidence, 'low');
    assert.equal(result.suggestion.kind, 'review');
    assert.equal(result.reportable, true);
    assert.equal(result.location, '.config');
    assert.match(result.message, /src\/config\.ts:1/);
    assert.doesNotMatch(result.message, /config file/i);
    assert.match(result.message, /unverified/);
  });
}
for (const method of ['readFileSync', 'writeFileSync']) {
  test(method + ' identifies the path argument rather than encoding/data', parsed, t => {
    const results = scan(t, "import fs from 'node:fs';\nfs." + method + "('.custom-settings', 'utf8');");
    assert.equal(results.length, 1);
    assert.equal(results[0].confidence, 'high');
    assert.equal(results[0].location, '.custom-settings');
    assert.equal(results[0].suggestion.kind, 'fix');
    assert.match(results[0].message, /src\/config\.ts:2/);
    assert.match(results[0].message, /scanned supported Markdown/);
  });
}
test('a real .config file read is not blanket-suppressed', parsed, t => {
  assert.equal(scan(t, "readFileSync('.config');")[0].confidence, 'high');
});
test('documented file read is quiet', t => {
  assert.deepEqual(scan(t, "readFileSync('.custom-settings');", 'The .custom-settings file stores options.'), []);
});
test('unrelated source with no config is quiet', t => {
  assert.deepEqual(scan(t, "const answer = 42; readFileSync('data.txt');"), []);
});
for (const source of [
  "// readFileSync('.custom-settings');",
  "/* writeFileSync('.custom-settings', data); */",
  'const example = "readFileSync(\'.custom-settings\')";',
  'const example = ' + String.fromCharCode(96) + "readFileSync('.custom-settings')" + String.fromCharCode(96) + ';',
  "const candidates = ['.custom-settings'];",
  "writeFileSync('output.txt', '.custom-settings');",
]) {
  test('comment/string/non-path control stays quiet: ' + source, parsed, t => {
    assert.deepEqual(scan(t, source), []);
  });
}
test('a later real read is retained after an example string', parsed, t => {
  const results = scan(t, 'const example = "readFileSync(\'.example-settings\')";\nreadFileSync(\'.custom-settings\');');
  assert.deepEqual(results.map(f => f.location), ['.custom-settings']);
  assert.equal(results[0].confidence, 'high');
});
test('direct IO takes precedence over an earlier ambiguous reference', parsed, t => {
  const results = scan(t, "join(root, '.custom-settings');\nreadFileSync('.custom-settings');");
  assert.equal(results.length, 1);
  assert.equal(results[0].confidence, 'high');
  assert.match(results[0].message, /src\/config\.ts:2/);
});
test('parse failure never promotes text matches to verified IO', t => {
  const results = scan(t, "readFileSync('.custom-settings');\nconst broken = ;");
  assert.equal(results.length, 1);
  assert.equal(results[0].confidence, 'low');
  assert.equal(results[0].suggestion.kind, 'review');
  assert.match(results[0].message, /unparsed source text/);
  assert.doesNotMatch(results[0].message, /config file/i);
});

test('escaped config names still reach the parser', parsed, t => {
  const source = String.raw`readFileSync('\x2ecustom-settings');`;
  assert.equal(scan(t, source)[0].location, '.custom-settings');
});
