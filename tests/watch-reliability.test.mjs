import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runWatch } from '../cli/commands/watch.mjs';

const pass = { status: 'PASS', passed: 1, total: 1 };
describe('watch reliability', () => {
  let dir, controller, watchers, callbacks, oldExitCode, signals;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'watch-reliability-'));
    watchers = new Map(); callbacks = new Map();
    oldExitCode = process.exitCode;
    signals = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
  });
  afterEach(() => {
    controller?.close();
    process.exitCode = oldExitCode;
    rmSync(dir, { recursive: true, force: true });
    assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), signals);
  });
  function watch(path, _options, callback) {
    const emitter = new EventEmitter();
    emitter.closed = false;
    emitter.close = () => { emitter.closed = true; };
    watchers.set(path, emitter); callbacks.set(path, callback);
    return emitter;
  }
  it('reports asynchronous EMFILE and closes every watcher and pending timer', async t => {
    const errors = [];
    t.mock.method(console, 'error', message => errors.push(message));
    mkdirSync(join(dir, 'src'));
    let checks = 0;
    controller = runWatch(dir, {}, {}, { watch, guard: () => { checks++; return pass; } });
    callbacks.get(dir)('change', 'file.js');
    watchers.get(join(dir, 'src')).emit('error', Object.assign(new Error('limit'), { code: 'EMFILE' }));
    assert.equal(process.exitCode, 1);
    assert.match(errors.join('\n'), /EMFILE.*Watch stopped/);
    assert.ok([...watchers.values()].every(watcher => watcher.closed));
    await delay(600);
    assert.equal(checks, 1);
  });
  it('cleans up partially registered watchers after synchronous failure', () => {
    mkdirSync(join(dir, 'src'));
    controller = runWatch(dir, {}, {}, { watch: (...args) => {
      if (args[0] !== dir) throw Object.assign(new Error('limit'), { code: 'EMFILE' });
      return watch(...args);
    }, guard: () => assert.fail('must not check after watch setup failed') });
    assert.equal(process.exitCode, 1);
    assert.ok(watchers.get(dir).closed);
  });
  it('coalesces repeated saves and queues only one check while a guard is active', async () => {
    let checks = 0, clears = 0, finish;
    controller = runWatch(dir, {}, {}, { watch, clearCache: () => clears++, guard: () => {
      checks++;
      return checks === 1 ? new Promise(resolve => { finish = resolve; }) : pass;
    } });
    const change = callbacks.get(dir);
    change('change', 'file.rs');
    await delay(300);
    change('change', 'file.rs');
    await delay(300);
    assert.equal(checks, 1);
    await delay(300);
    change('change', 'other.go');
    await delay(600);
    assert.equal(checks, 1);
    finish(pass);
    await delay(20);
    assert.equal(checks, 2);
    assert.equal(clears, 2);
    await delay(600);
    assert.equal(checks, 2);
  });
  it('skips private, ignored, generated and symlinked directories and discovers new directories', async () => {
    for (const name of ['.local', 'ignored', 'dist', 'src']) mkdirSync(join(dir, name));
    symlinkSync(join(dir, '.local'), join(dir, 'alias'), 'dir');
    writeFileSync(join(dir, '.docguardignore'), 'ignored/\n');
    let checks = 0;
    controller = runWatch(dir, {}, {}, { watch, guard: () => { checks++; return pass; } });
    assert.deepEqual([...watchers.keys()].sort(), [dir, join(dir, 'src')].sort());
    callbacks.get(dir)('rename', '.local');
    callbacks.get(dir)('change', 'ignored/secret.js');
    await delay(600);
    assert.equal(checks, 1);
    mkdirSync(join(dir, 'new-source'));
    callbacks.get(dir)('rename', 'new-source');
    await delay(600);
    assert.ok(watchers.has(join(dir, 'new-source')));
    assert.equal(checks, 2);
  });
});
