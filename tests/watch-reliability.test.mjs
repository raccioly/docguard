/**
 * Watch reliability (specs/055-watch-deterministic).
 *
 * Every timing decision runs on a clock the test advances, and check completion
 * is observed by draining queued promise callbacks, so no assertion depends on
 * wall-clock sleeps or machine load. Watch output is captured so this file
 * writes nothing to the test runner's stdout channel.
 *
 * @req docguard.watch-deterministic#FR-001
 * @req docguard.watch-deterministic#FR-002
 * @req docguard.watch-deterministic#FR-003
 * @req docguard.watch-deterministic#SC-001
 * @req docguard.watch-deterministic#SC-002
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWatch } from '../cli/commands/watch.mjs';

const pass = { status: 'PASS', passed: 1, total: 1 };

// Runs once every queued promise callback has run. Nothing in the watcher's
// check path waits on I/O or timers once the guard has settled, so this is a
// complete "check finished" signal, independent of how busy the machine is.
const flush = () => new Promise(resolve => setImmediate(resolve));

// A clock the test advances by hand. Due timers fire in deadline order, each
// followed by a flush, as the event loop would run them.
function fakeClock() {
  let now = 0;
  const timers = new Map();
  return {
    setTimeout(fn, ms) { const handle = {}; timers.set(handle, { fn, at: now + ms }); return handle; },
    clearTimeout(handle) { timers.delete(handle); },
    get pending() { return timers.size; },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const [handle, timer] = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0] || [];
        if (!handle) break;
        timers.delete(handle);
        now = timer.at;
        timer.fn();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

describe('watch reliability', () => {
  let dir, controller, watchers, callbacks, oldExitCode, signals, logs, errors, clock;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'watch-reliability-'));
    watchers = new Map(); callbacks = new Map();
    oldExitCode = process.exitCode;
    signals = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
    logs = []; errors = [];
    mock.method(console, 'log', message => logs.push(String(message)));
    mock.method(console, 'error', message => errors.push(String(message)));
    clock = fakeClock();
  });
  afterEach(() => {
    controller?.close();
    controller = undefined;
    mock.restoreAll();
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
  function start(runtime) {
    controller = runWatch(dir, {}, {}, { watch, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, ...runtime });
    return controller;
  }

  it('reports asynchronous EMFILE and closes every watcher and pending timer', async () => {
    mkdirSync(join(dir, 'src'));
    let checks = 0;
    start({ guard: () => { checks++; return pass; } });
    callbacks.get(dir)('change', 'file.js');
    assert.equal(clock.pending, 1);
    watchers.get(join(dir, 'src')).emit('error', Object.assign(new Error('limit'), { code: 'EMFILE' }));
    assert.equal(process.exitCode, 1);
    assert.ok(logs.some(line => line.includes(`DocGuard Watch — ${dir.split('/').at(-1)}`)));
    assert.ok(logs.every(line => !line.includes('undefined')));
    assert.match(errors.join('\n'), /EMFILE.*Watch stopped/);
    assert.ok([...watchers.values()].every(watcher => watcher.closed));
    assert.equal(clock.pending, 0, 'the pending debounce timer is cleared');
    await clock.advance(60_000);
    assert.equal(checks, 1);
  });

  it('cleans up partially registered watchers after synchronous failure', () => {
    mkdirSync(join(dir, 'src'));
    start({ watch: (...args) => {
      if (args[0] !== dir) throw Object.assign(new Error('limit'), { code: 'EMFILE' });
      return watch(...args);
    }, guard: () => assert.fail('must not check after watch setup failed') });
    assert.equal(process.exitCode, 1);
    assert.ok(watchers.get(dir).closed);
    assert.equal(clock.pending, 0);
  });

  it('coalesces repeated saves and queues only one check while a guard is active', async () => {
    let checks = 0, clears = 0, finish;
    start({ clearCache: () => clears++, guard: () => {
      checks++;
      return checks === 1 ? new Promise(resolve => { finish = resolve; }) : pass;
    } });
    assert.equal(checks, 1, 'the initial check is running and has not settled');
    const change = callbacks.get(dir);
    change('change', 'file.rs');
    await clock.advance(300);
    change('change', 'file.rs');
    await clock.advance(499);
    assert.equal(clock.pending, 1, 'the second save restarted the 500 ms window');
    assert.equal(checks, 1);
    await clock.advance(1);
    assert.equal(clock.pending, 0, 'the window closed while the first guard was still running');
    assert.equal(checks, 1, 'the expired window queues a check instead of starting one');
    change('change', 'other.go');
    await clock.advance(500);
    assert.equal(checks, 1, 'a second expired window does not queue a second check');
    finish(pass);
    await flush();
    assert.equal(checks, 2, 'exactly one queued check runs when the guard finishes');
    assert.equal(clears, 2);
    assert.ok(logs.some(line => line.includes('Changed:') && line.includes('file.rs, other.go')),
      'the queued check reports every path saved while it waited');
    await clock.advance(60_000);
    assert.equal(checks, 2);
    for (const file of ['a.md', 'b.md', 'c.md']) change('change', file);
    await clock.advance(499);
    assert.equal(checks, 2);
    await clock.advance(1);
    assert.equal(checks, 3, 'a burst of saves while idle produces one check');
  });

  it('lets an open debounce window close before running the queued check', async () => {
    let checks = 0, finish;
    start({ clearCache: () => {}, guard: () => {
      checks++;
      return checks === 1 ? new Promise(resolve => { finish = resolve; }) : pass;
    } });
    const change = callbacks.get(dir);
    change('change', 'first.md');
    await clock.advance(500);
    change('change', 'second.md');
    await clock.advance(200);
    finish(pass);
    await flush();
    assert.equal(checks, 1, 'saves are still arriving, so the queued check waits');
    await clock.advance(299);
    assert.equal(checks, 1);
    await clock.advance(1);
    assert.equal(checks, 2);
    await clock.advance(60_000);
    assert.equal(checks, 2);
  });

  it('schedules the 500 ms debounce through the global timers when none are injected', async t => {
    const scheduled = [];
    const cleared = [];
    t.mock.method(globalThis, 'setTimeout', (fn, ms) => { const handle = { fn, ms }; scheduled.push(handle); return handle; });
    t.mock.method(globalThis, 'clearTimeout', handle => { cleared.push(handle); });
    let checks = 0;
    controller = runWatch(dir, {}, {}, { watch, guard: () => { checks++; return pass; } });
    await flush();
    const change = callbacks.get(dir);
    change('change', 'file.md');
    change('change', 'file.md');
    assert.deepEqual(scheduled.map(handle => handle.ms), [500, 500]);
    assert.ok(cleared.includes(scheduled[0]), 'the second save cancels the first window');
    scheduled[1].fn();
    await flush();
    assert.equal(checks, 2);
    controller.close();
    controller = undefined;
  });

  it('skips private, ignored, generated and symlinked directories and discovers new directories', async () => {
    for (const name of ['.local', 'ignored', 'dist', 'src']) mkdirSync(join(dir, name));
    symlinkSync(join(dir, '.local'), join(dir, 'alias'), 'dir');
    writeFileSync(join(dir, '.docguardignore'), 'ignored/\n');
    let checks = 0;
    start({ guard: () => { checks++; return pass; } });
    assert.deepEqual([...watchers.keys()].sort(), [dir, join(dir, 'src')].sort());
    callbacks.get(dir)('rename', '.local');
    callbacks.get(dir)('change', 'ignored/secret.js');
    assert.equal(clock.pending, 0, 'skipped paths never open a debounce window');
    await clock.advance(60_000);
    assert.equal(checks, 1);
    mkdirSync(join(dir, 'new-source'));
    callbacks.get(dir)('rename', 'new-source');
    await clock.advance(500);
    assert.ok(watchers.has(join(dir, 'new-source')));
    assert.equal(checks, 2);
  });
});
