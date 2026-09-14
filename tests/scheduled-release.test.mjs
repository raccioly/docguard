import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/scheduled-release.yml', import.meta.url), 'utf8');

describe('scheduled release workflow', () => {
  it('grants exactly the write scopes required by its release PR flow', () => {
    assert.match(workflow, /permissions:\n  contents: write\n  pull-requests: write\n  actions: write\n/);
    assert.match(workflow, /gh pr create/);
    assert.match(workflow, /gh workflow run ci\.yml/);
  });

  it('pins third-party actions to reviewed commit SHAs', () => {
    const uses = [...workflow.matchAll(/uses:\s*([^@\s]+)@([^\s]+)/g)];
    assert.deepEqual(uses.map(([, action]) => action), ['actions/checkout', 'actions/setup-node']);
    for (const [, , revision] of uses) assert.match(revision, /^[a-f0-9]{40}$/);
    assert.equal(uses[0][2], '3d3c42e5aac5ba805825da76410c181273ba90b1');
    assert.equal(uses[1][2], '820762786026740c76f36085b0efc47a31fe5020');
  });
});
