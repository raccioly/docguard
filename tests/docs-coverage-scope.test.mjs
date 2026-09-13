import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { validateDocsCoverage } from '../cli/validators/docs-coverage.mjs';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-coverage-scope-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  safeWrite(join(dir, 'README.md'), '# Fixture\n## Installation\n## Usage\n## License\n');
  safeWrite(join(dir, 'src/index.js'), "readFileSync('.customrc');");
  return dir;
}
function warns(dir, config) {
  return (validateDocsCoverage(dir, config).findings || []).some(f => f.code === 'DCV004' && f.location === '.customrc');
}

for (const mention of [true, false]) {
  test('explicit nested documentation home, config mention: ' + mention, t => {
    const dir = fixture(t);
    safeWrite(join(dir, 'reference/tutorials/start/layout.md'), mention ? 'Configure .customrc here.' : 'Project layout.');
    assert.equal(warns(dir, { docs: { dirs: ['reference/tutorials'] } }), !mention);
  });
}
test('raw role mapping includes only the mapped document', t => {
  const dir = fixture(t);
  safeWrite(join(dir, 'reference/runtime.md'), 'Configure .customrc here.');
  const config = { docs: { roles: { environment: 'reference/runtime.md' } } };
  assert.equal(warns(dir, config), false);
  safeWrite(join(dir, 'reference/runtime.md'), 'Runtime setup.');
  safeWrite(join(dir, 'reference/unmapped.md'), 'Configure .customrc here.');
  assert.equal(warns(dir, config), true);
});
for (const doc of ['README.md', 'docs-canonical/nested/config.md', 'docs/config.md', 'extensions/tool/config.yml', 'reference/tutorials/config.md', 'reference/runtime.md']) {
  for (const mode of ['file', 'config']) {
    test('ignored documentation cannot supply evidence: ' + mode + ' ' + doc, t => {
      const dir = fixture(t);
      safeWrite(join(dir, 'AGENTS.md'), 'Project instructions.');
      safeWrite(join(dir, doc), 'Configure .customrc here.');
      const config = { docs: { dirs: ['reference/tutorials'], roles: { environment: 'reference/runtime.md' } } };
      if (mode === 'file') safeWrite(join(dir, '.docguardignore'), doc + '\n');
      else config.ignore = [doc];
      assert.equal(warns(dir, config), true);
    });
  }
}
for (const doc of ['README.md', 'docs-canonical/nested/config.md', 'docs/config.md', 'docs-implementation/config.md', 'extensions/tool/config.yml', 'extensions/tool/config.yaml']) {
  test('omitted config preserves conventional documentation: ' + doc, t => {
    const dir = fixture(t);
    safeWrite(join(dir, doc), 'Configure .customrc here.');
    assert.equal(warns(dir), false);
  });
}
test('arbitrary Markdown outside documentation homes is not evidence', t => {
  const dir = fixture(t);
  safeWrite(join(dir, 'src/notes.md'), 'Configure .customrc here.');
  assert.equal(warns(dir, {}), true);
});
for (const path of ['.local/docs', 'reference/.LOCAL/docs', '.GIT/docs', '../outside', '.']) {
  test('unsafe configured documentation home is excluded: ' + path, t => {
    const dir = fixture(t);
    if (!path.includes('..') && path !== '.') safeWrite(join(dir, path, 'config.md'), 'Configure .customrc here.');
    safeWrite(join(dir, 'src/notes.md'), 'Configure .customrc here.');
    assert.equal(warns(dir, { docs: { dirs: [path] } }), true);
  });
}
test('symlinked files, homes, ancestors and cycles are not followed', t => {
  const dir = fixture(t);
  safeWrite(join(dir, 'reference/config.md'), 'Configure .customrc here.');
  safeWrite(join(dir, 'docs/intro.md'), 'Introduction.');
  symlinkSync(join(dir, 'reference/config.md'), join(dir, 'docs/linked.md'));
  symlinkSync(join(dir, 'reference'), join(dir, 'linked'));
  symlinkSync(join(dir, 'docs'), join(dir, 'docs/cycle'));
  assert.equal(warns(dir, { docs: { dirs: ['linked', 'linked/nested'] } }), true);
});
for (const path of ['../outside.md', '.local/config.md', 'reference/linked.md']) {
  test('raw mapped role retains path validation: ' + path, t => {
    const dir = fixture(t);
    safeWrite(join(dir, 'reference/config.md'), 'Configure .customrc here.');
    symlinkSync(join(dir, 'reference/config.md'), join(dir, 'reference/linked.md'));
    assert.throws(() => warns(dir, { docs: { roles: { environment: path } } }), /within the project|symlink/);
  });
}
