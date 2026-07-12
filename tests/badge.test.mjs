import test from 'node:test';
import assert from 'node:assert';
import { runBadge } from '../cli/commands/badge.mjs';
import { loadConfig } from '../cli/config.mjs';

let config;
try { config = loadConfig(process.cwd()); } catch(e) { config = { projectName: "mock", projectType: "cli" }; }

test('runBadge - stdout output', async (t) => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    await runBadge(process.cwd(), config, {});
  } finally {
    console.log = originalLog;
  }

  assert.ok(logs.some(log => log.includes('img.shields.io/badge/CDD_Score')));
  assert.ok(logs.some(log => log.includes('![Type](https://img.shields.io/badge/type-cli-blue)')));
});

test('runBadge - json output', async (t) => {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    await runBadge(process.cwd(), config, { format: 'json' });
  } finally {
    console.log = originalLog;
  }

  const jsonLog = logs.find(log => log.includes('"score":') || log.includes('"grade":'));
  assert.ok(jsonLog, 'JSON output not found');
  const result = JSON.parse(jsonLog);
  assert.ok('score' in result);
  assert.ok('grade' in result);
  assert.ok('color' in result);
  assert.strictEqual(result.projectType, 'cli');
});
