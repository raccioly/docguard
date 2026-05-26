import { describe, it, afterEach, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runHooks } from '../cli/commands/hooks.mjs';

describe('runHooks function', () => {
    let tmpDir;
    let oldLog;
    let oldExit;
    let logs;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'sg-hooks-'));
        oldLog = console.log;
        oldExit = process.exit;
        logs = [];
        console.log = (...args) => { logs.push(args.join(' ')); };
    });

    afterEach(() => {
        console.log = oldLog;
        process.exit = oldExit;
        if (tmpDir && existsSync(tmpDir)) {
            rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('installs hooks', () => {
        mkdirSync(join(tmpDir, '.git'));
        runHooks(tmpDir, { projectName: 'Test' }, {});
        assert.ok(existsSync(join(tmpDir, '.git', 'hooks', 'pre-commit')));
        assert.ok(existsSync(join(tmpDir, '.git', 'hooks', 'pre-push')));
        assert.ok(existsSync(join(tmpDir, '.git', 'hooks', 'commit-msg')));
    });

    it('fails if not a git repository', () => {
        let exitCode = null;
        process.exit = (code) => { exitCode = code; throw new Error("process.exit"); };

        try {
            runHooks(tmpDir, { projectName: 'Test' }, {});
        } catch (e) {
            if (e.message !== "process.exit") throw e;
        }

        assert.strictEqual(exitCode, 1);
        assert.ok(logs.some(log => log.includes('Not a git repository')));
    });

    it('fails with unknown hook type', () => {
        mkdirSync(join(tmpDir, '.git'));
        let exitCode = null;
        process.exit = (code) => { exitCode = code; throw new Error("process.exit"); };

        try {
            runHooks(tmpDir, { projectName: 'Test' }, { type: 'unknown' });
        } catch (e) {
            if (e.message !== "process.exit") throw e;
        }

        assert.strictEqual(exitCode, 1);
        assert.ok(logs.some(log => log.includes('Unknown hook type')));
    });

    it('lists available hooks', () => {
        mkdirSync(join(tmpDir, '.git'));
        runHooks(tmpDir, { projectName: 'Test' }, { list: true });
        assert.ok(logs.some(log => log.includes('Available hooks')));
        assert.ok(logs.some(log => log.includes('pre-commit')));
    });

    it('removes hooks', () => {
        mkdirSync(join(tmpDir, '.git'));
        mkdirSync(join(tmpDir, '.git', 'hooks'));
        writeFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'DocGuard hook');
        runHooks(tmpDir, { projectName: 'Test' }, { remove: true });
        assert.ok(!existsSync(join(tmpDir, '.git', 'hooks', 'pre-commit')));
        assert.ok(logs.some(log => log.includes('Removed: pre-commit')));
    });

    it('skips non-DocGuard hooks when removing', () => {
        mkdirSync(join(tmpDir, '.git'));
        mkdirSync(join(tmpDir, '.git', 'hooks'));
        writeFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'other hook');
        runHooks(tmpDir, { projectName: 'Test' }, { remove: true });
        assert.ok(existsSync(join(tmpDir, '.git', 'hooks', 'pre-commit')));
        assert.ok(logs.some(log => log.includes('not a DocGuard hook')));
    });

    it('skips existing non-DocGuard hooks when installing without force', () => {
        mkdirSync(join(tmpDir, '.git'));
        mkdirSync(join(tmpDir, '.git', 'hooks'));
        writeFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'other hook');
        runHooks(tmpDir, { projectName: 'Test' }, { type: 'pre-commit' });
        assert.strictEqual(readFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'utf-8'), 'other hook');
        // v0.16-P3: new message phrasing — "an existing hook is present and has no DocGuard markers"
        assert.ok(logs.some(log => /existing hook|no DocGuard markers|Re-run with --force/i.test(log)),
          `expected refuse-to-overwrite warning; got logs: ${logs.join(' | ')}`);
    });

    it('overwrites existing hooks when installing with force', () => {
        mkdirSync(join(tmpDir, '.git'));
        mkdirSync(join(tmpDir, '.git', 'hooks'));
        writeFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'other hook');
        runHooks(tmpDir, { projectName: 'Test' }, { type: 'pre-commit', force: true });
        assert.ok(readFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'utf-8').includes('DocGuard'));
    });

    it('refuses to overwrite legacy DocGuard hooks (pre-v0.16, no markers) without --force', () => {
        // v0.16-P3: behavior change. Legacy hooks (have "DocGuard" but no
        // BEGIN/END markers) now ask the user to re-run with --force to
        // upgrade them to the managed-block format. The previous behavior
        // of silently skipping was misleading because the hook stayed
        // out-of-sync with the current DocGuard release.
        mkdirSync(join(tmpDir, '.git'));
        mkdirSync(join(tmpDir, '.git', 'hooks'));
        writeFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), '# legacy DocGuard hook\n');
        runHooks(tmpDir, { projectName: 'Test' }, { type: 'pre-commit' });
        // File unchanged
        assert.match(readFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'utf-8'), /legacy DocGuard hook/);
        // Logged a clear path forward
        assert.ok(logs.some(log => /legacy DocGuard|managed markers|Re-run with --force/i.test(log)),
          `expected legacy-hook warning; got logs: ${logs.join(' | ')}`);
    });

    it('splices managed-block content on re-install (preserves user content around it)', () => {
        mkdirSync(join(tmpDir, '.git'));
        mkdirSync(join(tmpDir, '.git', 'hooks'));
        // First install
        runHooks(tmpDir, { projectName: 'Test' }, { type: 'pre-commit' });
        const afterFirst = readFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'utf-8');
        assert.match(afterFirst, /BEGIN DOCGUARD MANAGED/);

        // User adds their own command BEFORE and AFTER the managed block
        const userExtended =
          afterFirst.replace(
            /(# BEGIN DOCGUARD MANAGED)/,
            'echo "user prelude: running data-file check"\n$1'
          ) + '\necho "user postlude: cleanup"\n';
        writeFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), userExtended);

        // Re-install — should splice ONLY the managed block, preserve user content
        runHooks(tmpDir, { projectName: 'Test' }, { type: 'pre-commit' });
        const afterReinstall = readFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'utf-8');
        assert.match(afterReinstall, /user prelude/, 'prelude must be preserved');
        assert.match(afterReinstall, /user postlude/, 'postlude must be preserved');
        assert.match(afterReinstall, /BEGIN DOCGUARD MANAGED/);
        assert.match(afterReinstall, /END DOCGUARD MANAGED/);
        assert.ok(logs.some(log => /updated DocGuard managed block|preserved user content/i.test(log)),
          `expected managed-block update message; got: ${logs.join(' | ')}`);
    });
});
