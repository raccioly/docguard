/**
 * `docguard init` and the enforcement mode (specs/097-strict-by-default FR-017, T024): no key by default,
 * `--enforcement` writes it, the wizard writes it only for a non-default answer, the closing text states
 * the mode, and init writes no configuration that switches a validator off.
 *
 * @req docguard.strict-by-default#FR-017
 */
import { makeTempDir } from './helpers/temp-dir.mjs';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { spawnSync } from 'node:child_process';
import { DEFAULT_MODE } from '../cli/enforcement.mjs';
import { freshProjectLines, enforcementClosingLines, enforcementToWrite, parseEnforcementFlag, parseWizardAnswer, WIZARD_QUESTION } from '../cli/init-enforcement.mjs';

const CLI = resolve('cli/docguard.mjs');
const OTHER = DEFAULT_MODE === 'strict' ? 'standard' : 'strict';

function init(t, args = []) {
  const dir = makeTempDir('docguard-init-enf-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'svc', version: '1.0.0' }));
  const r = spawnSync(process.execPath, [CLI, 'init', '--profile', 'standard', '--skip-prompts', '--no-spec-kit', ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
  return { dir, r, config: () => JSON.parse(readFileSync(join(dir, '.docguard.json'), 'utf8')) };
}

describe('init writes the enforcement key only on request', () => {
  it('writes no enforcement key by default, and the closing text states the mode', t => {
    const { r, config } = init(t);
    assert.equal(r.status, 0, r.stderr);
    assert.equal('enforcement' in config(), false);
    assert.match(r.stdout, /Enforcement: (strict|standard) \(the default, no "enforcement" key written\)/);
  });

  for (const mode of ['standard', 'strict']) {
    it(`--enforcement ${mode} writes the key and the closing text names it`, t => {
      const { r, config } = init(t, ['--enforcement', mode]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(config().enforcement, mode);
      assert.match(r.stdout, new RegExp(`Enforcement: ${mode} \\(set by "enforcement" in .docguard.json\\)`));
    });
  }

  it('--enforcement standard says what the lower mode does not check', t => {
    const { r } = init(t, ['--enforcement', 'standard']);
    assert.match(r.stdout, /does not fail the run/);
  });

  it('a fresh strict project is told the next guard lists what is empty, what to do first, and what the hooks do', t => {
    const { r } = init(t, ['--enforcement', 'strict']);
    assert.match(r.stdout, /the next `docguard guard` lists what is still empty and exits 4/);
    assert.match(r.stdout, /fill the generated documents, or run `docguard generate`/);
    assert.match(r.stdout, /pre-commit hook `docguard hooks` installs runs the full guard, so it blocks a commit/);
    assert.match(r.stdout, /`guard --changed-only`.*does not\s+evaluate this rule/s);
  });

  it('a fresh standard project is not told to expect exit 4', t => {
    const { r } = init(t, ['--enforcement', 'standard']);
    assert.doesNotMatch(r.stdout, /exits 4\./);
  });

  it('the hook statements are true of the code: the generated pre-commit hook runs the full guard, the pre-push hook runs score, the manager lines are changed-only and ci', () => {
    const hooks = readFileSync(resolve('cli/commands/hooks.mjs'), 'utf8');
    assert.match(hooks, /"\$DOCGUARD" guard\n/);
    assert.match(hooks, /"\$DOCGUARD" score --format json/);
    assert.match(hooks, /'pre-commit': 'npx docguard-cli guard --changed-only'/);
    assert.match(hooks, /'pre-push': 'npx docguard-cli ci'/);
    assert.equal(freshProjectLines().length > 3, true);
  });

  it('an invalid --enforcement value exits 1 and writes nothing', t => {
    const { r, dir } = init(t, ['--enforcement', 'lenient']);
    assert.equal(r.status, 1);
    assert.match(r.stderr + r.stdout, /--enforcement must be "strict" or "standard"/);
    assert.throws(() => readFileSync(join(dir, '.docguard.json')));
  });

  it('the setup wizard (init --wizard) writes the key for an explicit flag and states the mode', t => {
    const { r, config } = init(t, ['--wizard', '--enforcement', 'standard']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(config().enforcement, 'standard');
    assert.match(r.stdout, /Enforcement: standard \(set by "enforcement" in .docguard.json\)/);
  });

  it('on a project that already has a configuration, --enforcement sets the key there', t => {
    const { dir, r } = init(t);
    assert.equal(r.status, 0, r.stderr);
    const again = spawnSync(process.execPath, [CLI, 'init', '--profile', 'standard', '--skip-prompts', '--no-spec-kit', '--enforcement', 'standard'], { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(readFileSync(join(dir, '.docguard.json'), 'utf8')).enforcement, 'standard');
  });

  it('the configuration init writes switches no validator off', t => {
    const { config } = init(t);
    const off = Object.entries(config().validators || {}).filter(([, v]) => v === false).map(([k]) => k);
    assert.deepEqual(off, [], 'init writes no `false` entry: the person never chose one (FR-003)');
  });
});

describe('the wizard question and its answers', () => {
  it('asks in plain words what strict adds and that it is the default', () => {
    const text = WIZARD_QUESTION.join('\n');
    assert.match(text, /strict \(the default\)/);
    assert.match(text, /examined nothing/);
    assert.match(text, /standard: reports such a check/);
  });

  it('reads Enter, y and strict as strict; n and standard as standard; anything else as unanswered', () => {
    for (const a of ['', 'y', 'Yes', 'strict']) assert.equal(parseWizardAnswer(a), 'strict');
    for (const a of ['n', 'No', 'standard']) assert.equal(parseWizardAnswer(a), 'standard');
    assert.equal(parseWizardAnswer('maybe'), null);
  });

  it('writes the key for a wizard answer only when it is not the default; a flag is always written', () => {
    assert.equal(enforcementToWrite({ wizardMode: DEFAULT_MODE }), null);
    assert.equal(enforcementToWrite({ wizardMode: OTHER }), OTHER);
    assert.equal(enforcementToWrite({ flagMode: DEFAULT_MODE }), DEFAULT_MODE);
    assert.equal(enforcementToWrite({ flagMode: 'standard', wizardMode: 'strict' }), 'standard');
    assert.equal(enforcementToWrite({}), null);
  });

  it('parseEnforcementFlag accepts the two modes and rejects the rest', () => {
    assert.equal(parseEnforcementFlag('strict'), 'strict');
    assert.throws(() => parseEnforcementFlag('off'), /must be "strict" or "standard"/);
  });

  it('closing lines name the mode and how to change it', () => {
    assert.match(enforcementClosingLines('strict', { written: false }).join('\n'), /exits 4/);
    assert.match(enforcementClosingLines('standard', { written: true }).join('\n'), /remove the key, or set "enforcement": "strict"/);
  });
});
