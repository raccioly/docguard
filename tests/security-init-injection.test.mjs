/**
 * v0.21.1 — Issue #190 regression tests.
 *
 * Pre-v0.21.1, `docguard init` was vulnerable to command injection via the
 * `ai` field in `.specify/init-options.json`:
 *
 *   const detectedAgent = detectAIAgent(projectDir); // reads opts.ai
 *   const aiFlag = `--ai ${detectedAgent}`;
 *   execSync(`specify init ... ${aiFlag} ...`);
 *
 * An attacker who could write `.specify/init-options.json` could set
 * `"ai": "claude; touch /tmp/pwned;"` and arbitrary commands would run on
 * the victim's next `docguard init`.
 *
 * v0.21.1 fixes this with TWO layers:
 *   1. getDetectedAgent now allowlist-validates the `ai` field
 *      ([a-zA-Z0-9_-]{1,32}) — malicious values return null
 *   2. The exec call switched from execSync to execFileSync via
 *      safeSpawnSpecify, which passes args as an array — no shell
 *      interpolation possible even if the allowlist were bypassed
 *
 * These tests pin BOTH layers so a future regression on either gets caught.
 *
 * @req SC-SEC-INJ-001 — getDetectedAgent rejects shell metacharacters in ai
 * @req SC-SEC-INJ-002 — getDetectedAgent rejects oversize values
 * @req SC-SEC-INJ-003 — getDetectedAgent rejects non-string values
 * @req SC-SEC-INJ-004 — getDetectedAgent accepts the allowlisted patterns
 * @req SC-SEC-INJ-005 — safeSpawnSpecify rejects non-array args (API contract)
 */
import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDetectedAgent, safeSpawnSpecify } from '../cli/ensure-skills.mjs';

function mkFixture(aiValue) {
  const dir = mkdtempSync(join(tmpdir(), 'security-inj-'));
  mkdirSync(join(dir, '.specify'));
  const opts = aiValue === undefined ? {} : { ai: aiValue };
  writeFileSync(join(dir, '.specify/init-options.json'), JSON.stringify(opts));
  return dir;
}

describe('issue #190 — command injection via .specify/init-options.json `ai`', () => {
  let dir;
  afterEach(() => { if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; } });

  describe('Layer 1: getDetectedAgent allowlist (cli/ensure-skills.mjs)', () => {
    it('rejects shell metacharacter injection (semicolon)', () => {
      dir = mkFixture('claude; touch /tmp/pwned;');
      assert.equal(getDetectedAgent(dir), null,
        'malicious ai value with `;` must be rejected');
    });

    it('rejects backtick injection', () => {
      dir = mkFixture('claude`whoami`');
      assert.equal(getDetectedAgent(dir), null);
    });

    it('rejects $() command substitution', () => {
      dir = mkFixture('claude$(touch /tmp/pwned)');
      assert.equal(getDetectedAgent(dir), null);
    });

    it('rejects pipe injection', () => {
      dir = mkFixture('claude | rm -rf ~');
      assert.equal(getDetectedAgent(dir), null);
    });

    it('rejects ampersand injection', () => {
      dir = mkFixture('claude && malicious-cmd');
      assert.equal(getDetectedAgent(dir), null);
    });

    it('rejects newline-injected payloads', () => {
      dir = mkFixture('claude\nrm -rf ~');
      assert.equal(getDetectedAgent(dir), null);
    });

    it('rejects values longer than 32 chars (DoS / log noise guard)', () => {
      dir = mkFixture('a'.repeat(33));
      assert.equal(getDetectedAgent(dir), null);
    });

    it('rejects non-string ai values (defensive)', () => {
      dir = mkFixture({ malicious: 'object' });
      assert.equal(getDetectedAgent(dir), null);
      rmSync(dir, { recursive: true, force: true }); dir = null;
      dir = mkFixture(42);
      assert.equal(getDetectedAgent(dir), null);
      rmSync(dir, { recursive: true, force: true }); dir = null;
      dir = mkFixture(['claude']);
      assert.equal(getDetectedAgent(dir), null);
    });

    it('accepts the documented spec-kit agent names', () => {
      // From cli/ensure-skills.mjs agentSignals map — these are the legitimate values
      const validAgents = ['claude', 'cursor-agent', 'gemini', 'agy', 'copilot', 'windsurf', 'codex', 'roo', 'amp', 'kiro-cli', 'tabnine'];
      for (const agent of validAgents) {
        dir = mkFixture(agent);
        assert.equal(getDetectedAgent(dir), agent,
          `legitimate agent "${agent}" must be accepted by the allowlist`);
        rmSync(dir, { recursive: true, force: true }); dir = null;
      }
    });

    it('accepts underscored agent names (future-proofing)', () => {
      dir = mkFixture('my_agent_v2');
      assert.equal(getDetectedAgent(dir), 'my_agent_v2');
    });

    it('handles missing .specify/init-options.json (no exception)', () => {
      dir = mkdtempSync(join(tmpdir(), 'security-inj-noopts-'));
      assert.equal(getDetectedAgent(dir), null);
    });

    it('handles malformed JSON gracefully (no exception)', () => {
      dir = mkdtempSync(join(tmpdir(), 'security-inj-badjson-'));
      mkdirSync(join(dir, '.specify'));
      writeFileSync(join(dir, '.specify/init-options.json'), '{ this is not valid json');
      assert.equal(getDetectedAgent(dir), null);
    });
  });

  describe('Layer 2: safeSpawnSpecify API (cli/ensure-skills.mjs)', () => {
    it('rejects non-array args (defensive — prevents future caller bugs)', () => {
      assert.throws(
        () => safeSpawnSpecify('init --here', {}),
        /args must be an array/,
        'string args must be rejected — only array form is safe',
      );
    });

    it('rejects undefined args', () => {
      assert.throws(() => safeSpawnSpecify(undefined, {}), /args must be an array/);
    });

    // Note: we can't unit-test that execFileSync was actually called (rather
    // than execSync) without mocking; the regression risk is covered by:
    //   1. The allowlist tests above (primary defense)
    //   2. The grep audit in CHANGELOG/CI: `grep -rn execSync cli/commands/init.mjs` should
    //      now return 0 matches for the `specify init` call site
  });
});
