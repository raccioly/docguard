import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

function workflowFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...workflowFiles(full));
    else if (/\.ya?ml$/i.test(entry)) files.push(full);
  }
  return files;
}

describe('GitHub action supply-chain pins', () => {
  it('pins executable third-party actions and reusable workflows to full commit SHAs', () => {
    const files = [
      join(root, 'action.yml'),
      ...workflowFiles(join(root, '.github/workflows')),
      ...workflowFiles(join(root, 'extensions/spec-kit-docguard/templates/github-workflows')),
    ];
    const unpinned = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(/uses:\s*["']?([^@\s"']+)@([^\s"'#]+)/g)) {
        const [, action, revision] = match;
        if (action.startsWith('./')) continue;
        // The extension's own installation example follows the released
        // DocGuard version and is synchronized by sync-release-version.mjs.
        if (action === 'raccioly/docguard' && /^v\d+\.\d+\.\d+$/.test(revision)) continue;
        if (!/^[a-f0-9]{40}$/.test(revision)) {
          unpinned.push(`${relative(root, file)}: ${action}@${revision}`);
        }
      }
    }
    assert.deepEqual(unpinned, []);
  });

  it('keeps the extension auto-fix action on the package release version', () => {
    const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
    const template = readFileSync(
      join(root, 'extensions/spec-kit-docguard/templates/github-workflows/docguard-autofix.yml'),
      'utf8',
    );
    assert.match(template, new RegExp(`uses: raccioly/docguard@v${version.replaceAll('.', '\\.')}(?:\\s|$)`));
  });

  it('keeps the installable Flask example on the reviewed security-fix release', () => {
    const requirements = readFileSync(
      join(root, 'examples/02-python-flask/requirements.txt'),
      'utf8',
    ).trim();
    assert.equal(requirements, 'flask==3.1.3');
  });
});
