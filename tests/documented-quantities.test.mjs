/**
 * Spec 109: quantities in instruction documents (issue 629, the last part of issue 628).
 *
 * @req docguard.documented-quantities#FR-001
 * @req docguard.documented-quantities#FR-002
 * @req docguard.documented-quantities#FR-003
 * @req docguard.documented-quantities#FR-004
 * @req docguard.documented-quantities#FR-005
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractSemanticClaims } from '../cli/scanners/semantic-claims.mjs';
import { validateMetricsConsistency } from '../cli/validators/metrics-consistency.mjs';

function tree(t, files) {
  const dir = makeTempDir('dg-109-', t);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}
const FENCE = '```';
const durations = dir => extractSemanticClaims(dir, {}).filter(c => c.subkind === 'duration').map(c => `${c.doc}:${c.line} ${c.value}${c.unit}`);
const met = (dir, code) => validateMetricsConsistency(dir, {}, []).findings.filter(f => f.code === code);

describe('issue 629: the claim extractor reads instruction quantities', () => {
  it('a trailing # comment in a shell fence and a bare s unit are claims; years and "10s of" are not', (t) => {
    const dir = tree(t, {
      'AGENTS.md': [
        '# Agents', '', `${FENCE}bash`, 'npm test               # unit + fixture acceptance (~15s)', 'echo "sleep 30s"', FENCE, '',
        'The lint step takes (~20s) on a laptop.', 'Built in the 1990s, with 10s of plugins.', 'A full run takes about 90 seconds.', '',
        `${FENCE}js`, 'const timeoutMs = 5000; // 5s', FENCE, '',
      ].join('\n'),
    });
    assert.deepEqual(durations(dir), ['AGENTS.md:4 15s', 'AGENTS.md:8 20s', 'AGENTS.md:10 90seconds']);
  });
});

describe('issue 629: documented quantities against their source of truth', () => {
  it('MET005: a documented minimum Node version that disagrees with engines.node', (t) => {
    const dir = tree(t, {
      'package.json': '{"name":"x","version":"1.0.0","engines":{"node":">=18"}}\n',
      'README.md': '# X\n\nRequires Node.js 20+ and npm.\n',
      'CONTRIBUTING.md': '# Contributing\n\nUse Node 18 or later.\n',
    });
    const found = met(dir, 'MET005');
    assert.deepEqual(found.map(f => f.location), ['README.md:3']);
    assert.match(found[0].message, /Node\.js 20\+.*engines\.node.*>=18/);
    assert.equal(found[0].severity, 'warn');
  });

  it('MET006 and MET007: a documented duration against the CI budget of the same command', (t) => {
    const dir = tree(t, {
      'package.json': '{"name":"x","version":"1.0.0","scripts":{"test":"node --test","lint":"eslint ."}}\n',
      '.github/workflows/ci.yml': [
        'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - name: Run tests', '        env:', '          TEST_BUDGET_MS: 300000', '        run: npm test',
        '  lint:', '    runs-on: ubuntu-latest', '    timeout-minutes: 5', '    steps:', '      - run: npm run lint', '',
      ].join('\n'),
      'AGENTS.md': [
        '# Agents', '', `${FENCE}bash`, 'npm test               # unit + fixture acceptance (~15s)', 'npm run lint           # about 10 minutes on a cold cache', FENCE, '',
      ].join('\n'),
    });
    const ceiling = met(dir, 'MET006');
    assert.deepEqual(ceiling.map(f => f.location), ['AGENTS.md:5']);
    assert.match(ceiling[0].message, /npm run lint.*about 10 minutes.*timeout-minutes: 5/);
    const slack = met(dir, 'MET007');
    assert.deepEqual(slack.map(f => f.location), ['AGENTS.md:4']);
    assert.match(slack[0].message, /npm test.*~15s.*TEST_BUDGET_MS: 300000 \(300 s\).*20x/);
  });

  it('a duration on a line that names no CI command, and a command CI does not run, are not compared', (t) => {
    const dir = tree(t, {
      'package.json': '{"name":"x","version":"1.0.0","scripts":{"test":"node --test","docs":"x"}}\n',
      '.github/workflows/ci.yml': 'jobs:\n  t:\n    timeout-minutes: 1\n    steps:\n      - run: npm test\n',
      'AGENTS.md': '# Agents\n\nA review takes about 30 minutes.\n\n`npm run docs` takes about 10 minutes.\n',
    });
    assert.deepEqual([...met(dir, 'MET006'), ...met(dir, 'MET007')], []);
  });
});
