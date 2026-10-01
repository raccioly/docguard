/**
 * Doc dependency lock (specs/030-doc-dependency-lock): a doc section declares
 * the code it describes, a review records that code's fingerprint, and guard
 * reports the section when the code changes — not when it is reformatted.
 *
 * @req docguard.doc-dependency-lock#FR-001
 * @req docguard.doc-dependency-lock#FR-002
 * @req docguard.doc-dependency-lock#FR-003
 * @req docguard.doc-dependency-lock#FR-004
 * @req docguard.doc-dependency-lock#FR-005
 * @req docguard.doc-dependency-lock#FR-006
 * @req docguard.doc-dependency-lock#FR-007
 * @req docguard.doc-dependency-lock#SC-001
 * @req docguard.doc-dependency-lock#SC-002
 * @req docguard.doc-dependency-lock#SC-004
 * @req docguard.doc-dependency-lock#FR-008
 * @req docguard.doc-dependency-lock#FR-009
 * @req docguard.doc-dependency-lock#FR-010
 * @req docguard.doc-dependency-lock#SC-003
 * @req docguard.output-ux#FR-013
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateDocDependency } from '../cli/validators/doc-dependency.mjs';
import { coveredSections, createContext, docLockStatus, fingerprint, readLock } from '../cli/scanners/doc-deps.mjs';
import { pyAstAvailable } from '../cli/scanners/py-ast.mjs';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const PRICING = `// Pricing rules.
export function discount(total) {
  if (total > 100) return total * 0.9;
  return total;
}

export function tax(total) {
  return total * 0.2;
}
`;

const DOC = covers => `# Architecture

<!-- docguard:section id=pricing source=human covers="${covers}" -->
Orders over 100 get a 10% discount.
<!-- /docguard:section -->

\`\`\`markdown
<!-- docguard:section id=example source=human covers="src/nope.mjs" -->
An example inside a fence is never a real section.
<!-- /docguard:section -->
\`\`\`
`;

function project({ covers = 'src/pricing.mjs#discount', files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-doclock-'));
  dirs.push(dir);
  const all = {
    '.docguard.json': JSON.stringify({ projectName: 'lock', profile: 'starter' }),
    'src/pricing.mjs': PRICING,
    'docs-canonical/ARCHITECTURE.md': DOC(covers),
    ...files,
  };
  for (const [rel, content] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  return { dir, git, write: (rel, c) => writeFileSync(join(dir, rel), c) };
}

const cli = (dir, args) => spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
const accept = (dir, target = 'docs-canonical/ARCHITECTURE.md#pricing') => cli(dir, ['review', '--accept', target, '--reason', 'Checked the discount rule against the code']);
const codes = dir => validateDocDependency(dir, {}).findings.map(f => f.code);

describe('a covered section is reported when its code changes semantically (SC-001)', () => {
  it('one DLK001 for a semantic edit, naming the section, dependency and the diff command', () => {
    const p = project();
    assert.equal(accept(p.dir).status, 0);
    p.write('src/pricing.mjs', PRICING.replace('total * 0.9', 'total * 0.8'));
    const found = validateDocDependency(p.dir, {}).findings;
    assert.deepEqual(found.map(f => f.code), ['DLK001']);
    assert.match(found[0].message, /docs-canonical\/ARCHITECTURE\.md#pricing describes src\/pricing\.mjs#discount, which changed/);
    assert.match(found[0].suggestion.command, /^git diff [0-9a-f]{12} -- src\/pricing\.mjs$/);
    assert.equal(found[0].location, 'docs-canonical/ARCHITECTURE.md:3');
    assert.equal(found[0].parserTier, 'js-ast');
  });

  it('whitespace, comments, reformatting, a line move and an unrelated symbol report nothing', () => {
    const edits = [
      PRICING.replace('if (total > 100)', 'if (total  >  100)'),
      PRICING.replace('if (total > 100)', '// Big orders.\n  if (total > 100)'),
      PRICING.replace('export function discount(total) {\n  if (total > 100) return total * 0.9;\n  return total;\n}', 'export function discount(total) { if (total > 100) return total * 0.9; return total; }'),
      `\n\n\n${PRICING}`,
      PRICING.replace('total * 0.2', 'total * 0.25'),
    ];
    for (const [i, edit] of edits.entries()) {
      const p = project();
      accept(p.dir);
      p.write('src/pricing.mjs', edit);
      assert.deepEqual(codes(p.dir), [], `edit ${i}`);
    }
  });
});

describe('same-size edits: line counts and file size cannot see them, the lock does (SC-004)', () => {
  it('flags `0.9`→`0.8` and `>`→`<` although lines and bytes are unchanged', () => {
    for (const edit of [PRICING.replace('0.9', '0.8'), PRICING.replace('total > 100', 'total < 100')]) {
      const p = project();
      accept(p.dir);
      p.write('src/pricing.mjs', edit);
      assert.equal(edit.split('\n').length, PRICING.split('\n').length);
      assert.equal(Buffer.byteLength(edit), Buffer.byteLength(PRICING));
      assert.deepEqual(codes(p.dir), ['DLK001']);
    }
  });
});

describe('every other state is named (FR-004)', () => {
  it('DLK003 before the first review, and when covers= changes after it', () => {
    const p = project();
    assert.deepEqual(codes(p.dir), ['DLK003']);
    accept(p.dir);
    p.write('docs-canonical/ARCHITECTURE.md', DOC('src/pricing.mjs#discount, src/pricing.mjs#tax'));
    const [f] = validateDocDependency(p.dir, {}).findings;
    assert.equal(f.code, 'DLK003');
    assert.match(f.message, /changed its covers= since the review \(\+src\/pricing\.mjs#tax\)/);
  });

  it('DLK002 when the covered symbol is renamed away', () => {
    const p = project();
    accept(p.dir);
    p.write('src/pricing.mjs', PRICING.replace('function discount', 'function rebate'));
    const [f] = validateDocDependency(p.dir, {}).findings;
    assert.equal(f.code, 'DLK002');
    assert.match(f.message, /has no top-level symbol discount/);
  });

  it('DLK004 for a lock entry whose section is gone, cleared by review --prune', () => {
    const p = project();
    accept(p.dir);
    p.write('docs-canonical/ARCHITECTURE.md', '# Architecture\n\nNo covered sections now.\n');
    assert.deepEqual(codes(p.dir), ['DLK004']);
    assert.equal(cli(p.dir, ['review', '--prune']).status, 0);
    assert.deepEqual(Object.keys(readLock(p.dir).lock.sections), []);
  });

  it('DLK005, an error, when the lock is unreadable — never "all current"', () => {
    const p = project();
    accept(p.dir);
    p.write('.docguard-doc-lock.json', '{ not json');
    const r = validateDocDependency(p.dir, {});
    assert.deepEqual(r.findings.map(f => [f.code, f.severity]), [['DLK005', 'error']]);
  });

  it('a marker inside a code fence is documentation, not a section', () => {
    assert.deepEqual(coveredSections(DOC('a.mjs')).map(s => s.id), ['pricing']);
  });
});

describe('review is the only writer, and it needs a reason (FR-005, FR-006)', () => {
  it('refuses --accept without a reason and writes nothing', () => {
    const p = project();
    const r = cli(p.dir, ['review', '--accept', 'docs-canonical/ARCHITECTURE.md#pricing']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /requires --reason/);
    assert.equal(existsSync(join(p.dir, '.docguard-doc-lock.json')), false);
  });

  it('records sorted, deterministic JSON with the tier, HEAD and reason', () => {
    const p = project({ covers: 'src/pricing.mjs#tax, src/pricing.mjs#discount' });
    accept(p.dir);
    const raw = readFileSync(join(p.dir, '.docguard-doc-lock.json'), 'utf8');
    const lock = JSON.parse(raw);
    const entry = lock.sections['docs-canonical/ARCHITECTURE.md#pricing'];
    assert.deepEqual(Object.keys(entry.dependencies), ['src/pricing.mjs#discount', 'src/pricing.mjs#tax']);
    assert.equal(entry.dependencies['src/pricing.mjs#tax'].tier, 'ast');
    assert.equal(entry.reviewedRevision, p.git('rev-parse', 'HEAD'));
    assert.ok(raw.endsWith('\n'));
    accept(p.dir);
    assert.equal(readFileSync(join(p.dir, '.docguard-doc-lock.json'), 'utf8').replace(/"reviewedAt": "[^"]+"/, ''), raw.replace(/"reviewedAt": "[^"]+"/, ''));
  });

  it('sync --write and fix --write never create or change the lock', () => {
    const p = project();
    cli(p.dir, ['sync', '--write']);
    cli(p.dir, ['fix', '--write']);
    assert.equal(existsSync(join(p.dir, '.docguard-doc-lock.json')), false);
  });

  it('--suggest proposes mentioned paths, marked low-confidence, and writes nothing', () => {
    const p = project({ files: { 'docs-canonical/DATA-MODEL.md': '# Data\n\n## Orders\n\nPrices come from `src/pricing.mjs` and `src/missing.mjs`.\n' } });
    const r = JSON.parse(cli(p.dir, ['review', '--suggest', 'docs-canonical/DATA-MODEL.md', '--format', 'json']).stdout);
    assert.deepEqual(r.suggestions, [{ heading: 'Orders', covers: ['src/pricing.mjs'], confidence: 'low' }]);
    assert.equal(existsSync(join(p.dir, '.docguard-doc-lock.json')), false);
  });

  it('guard runs Doc-Dependency by default', () => {
    const p = project();
    const j = JSON.parse(cli(p.dir, ['guard', '--format', 'json']).stdout);
    assert.ok(j.findings.some(f => f.code === 'DLK003'), 'an unaccepted covered section is reported by plain guard');
  });

  it('review exits 2 while a section needs review and 0 once current', () => {
    const p = project();
    assert.equal(cli(p.dir, ['review']).status, 2);
    accept(p.dir);
    assert.equal(cli(p.dir, ['review']).status, 0);
  });
});

describe('fingerprints are safe and tiered (FR-002)', () => {
  it('refuses paths outside the project and symbolic links', t => {
    const p = project();
    symlinkSync(join(p.dir, 'src/pricing.mjs'), join(p.dir, 'src/link.mjs'));
    const ctx = createContext(p.dir);
    assert.match(fingerprint(ctx, '../outside.mjs').reason, /relative path inside the project/);
    assert.match(fingerprint(ctx, 'src/link.mjs').reason, /symbolic link/);
  });

  it('a glob fingerprints the tracked set, so adding a file changes it once it is tracked', () => {
    const p = project();
    const before = fingerprint(createContext(p.dir), 'src/**').fingerprint;
    p.write('src/extra.mjs', 'export const x = 1;\n');
    // docguard.output-ux#FR-013: an untracked scratch file is not part of the set.
    assert.equal(fingerprint(createContext(p.dir), 'src/**').fingerprint, before);
    p.git('add', 'src/extra.mjs');
    assert.notEqual(fingerprint(createContext(p.dir), 'src/**').fingerprint, before);
  });

  it('a Python symbol uses the python-ast tier', { skip: !pyAstAvailable() && 'python3 unavailable' }, () => {
    const p = project({ files: { 'app/rules.py': 'def discount(total):\n    return total * 0.9\n\n\ndef tax(total):\n    return total * 0.2\n' } });
    const ctx = createContext(p.dir);
    const fp = fingerprint(ctx, 'app/rules.py#discount');
    assert.equal(fp.tier, 'python-ast');
    p.write('app/rules.py', '# comment\ndef discount(total):\n    return total * 0.9\n\n\ndef tax(total):\n    return total * 0.25\n');
    assert.equal(fingerprint(createContext(p.dir), 'app/rules.py#discount').fingerprint, fp.fingerprint);
  });
});

describe('opt-in: a project without covers= is unchanged (FR-007, SC-002)', () => {
  it('the validator is not applicable and guard reports the same findings with it on or off', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-doclock-off-'));
    dirs.push(dir);
    writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'off', profile: 'starter' }));
    mkdirSync(join(dir, 'docs-canonical'));
    writeFileSync(join(dir, 'docs-canonical/ARCHITECTURE.md'), '# Architecture\n\nNo covered sections.\n');
    assert.equal(validateDocDependency(dir, {}).applicable, false);
    const run = extra => {
      writeFileSync(join(dir, '.docguard.json'), JSON.stringify({ projectName: 'off', profile: 'starter', ...extra }));
      const j = JSON.parse(cli(dir, ['guard', '--format', 'json']).stdout);
      return { status: j.status, findings: j.findings.map(f => `${f.code}:${f.message}`).sort() };
    };
    assert.deepEqual(run({}), run({ validators: { docDependency: false } }));
    assert.equal(existsSync(join(dir, '.docguard-doc-lock.json')), false);
  });
});

describe('cost stays bounded: only declared dependencies, each file parsed once (FR-008, SC-003)', () => {
  it('never walks the repository without a glob, and parses a file once for several symbols', () => {
    const p = project({ covers: 'src/pricing.mjs#discount, src/pricing.mjs#tax' });
    const ctx = createContext(p.dir);
    docLockStatus(p.dir, {}, ctx);
    assert.equal(ctx.files, null, 'no repository walk without a glob');
    assert.equal(ctx.jsAsts.size, 1, 'two symbols, one parse');
  });
  // The wall-time budget itself (≤5% of guard) is measured base-vs-head by the
  // CI budget job (specs/031-non-regression-budgets) and recorded in the PR.
});

describe('this repository uses it (FR-009) and documents it (FR-010)', () => {
  it('ARCHITECTURE and DATA-MODEL declare covered sections, each with a lock entry', () => {
    const status = docLockStatus(process.cwd());
    const keys = status.sections.map(s => s.key);
    for (const key of ['docs-canonical/ARCHITECTURE.md#requirement-identity', 'docs-canonical/DATA-MODEL.md#finding-channels', 'docs-canonical/DATA-MODEL.md#spec-registry']) {
      assert.ok(keys.includes(key), key);
      assert.ok(readLock(process.cwd()).lock.sections[key], `${key} has been accepted`);
    }
  });

  it('README, commands, configuration, ARCHITECTURE and DATA-MODEL explain the lock', () => {
    const read = p => readFileSync(p, 'utf8');
    assert.match(read('README.md'), /\*\*Doc-Dependency\*\*/);
    assert.match(read('docs/commands.md'), /### `docguard review`[\s\S]*review --accept/);
    assert.match(read('docs/configuration.md'), /covers=[\s\S]*validators": \{ "docDependency": false \}/);
    assert.match(read('docs-canonical/ARCHITECTURE.md'), /\*\*Doc dependency lock\*\*/);
    assert.match(read('docs-canonical/DATA-MODEL.md'), /## Doc Dependency Lock: `\.docguard-doc-lock\.json`/);
  });
});
