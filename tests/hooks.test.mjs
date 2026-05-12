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
        assert.ok(logs.some(log => log.includes('existing hook found')));
    });

    it('overwrites existing hooks when installing with force', () => {
        mkdirSync(join(tmpDir, '.git'));
        mkdirSync(join(tmpDir, '.git', 'hooks'));
        writeFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'other hook');
        runHooks(tmpDir, { projectName: 'Test' }, { type: 'pre-commit', force: true });
        assert.ok(readFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'utf-8').includes('DocGuard'));
    });

    it('skips existing DocGuard hooks when installing without force', () => {
        mkdirSync(join(tmpDir, '.git'));
        mkdirSync(join(tmpDir, '.git', 'hooks'));
        writeFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'DocGuard hook');
        runHooks(tmpDir, { projectName: 'Test' }, { type: 'pre-commit' });
        assert.strictEqual(readFileSync(join(tmpDir, '.git', 'hooks', 'pre-commit'), 'utf-8'), 'DocGuard hook');
        assert.ok(logs.some(log => log.includes('DocGuard hook already installed')));
    });
});
