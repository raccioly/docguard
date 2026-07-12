import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { runAgents } from '../cli/commands/agents.mjs';

const mockConfig = {
  projectName: 'Mock Project',
  projectType: 'service'
};

test('runAgents - basic execution', async (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docguard-test-agents-'));
  fs.writeFileSync(path.join(fixtureDir, 'AGENTS.md'), 'Mock agents content');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    await runAgents(fixtureDir, mockConfig, {});

    // verify some files are created
    assert.ok(fs.existsSync(path.join(fixtureDir, '.cursor/rules/cdd.mdc')));
    assert.ok(fs.existsSync(path.join(fixtureDir, '.github/copilot-instructions.md')));
    assert.ok(fs.existsSync(path.join(fixtureDir, '.clinerules')));
    assert.ok(fs.existsSync(path.join(fixtureDir, '.windsurfrules')));
    assert.ok(fs.existsSync(path.join(fixtureDir, 'CLAUDE.md')));
    assert.ok(fs.existsSync(path.join(fixtureDir, '.gemini/settings.json')));
  } finally {
    console.log = originalLog;
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }

  assert.ok(logs.some(log => log.includes('Created: 6')));
  assert.ok(logs.some(log => log.includes('Skipped: 0')));
});

test('runAgents - with --check flag in sync', async (t) => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docguard-test-agents-'));
  fs.writeFileSync(path.join(fixtureDir, 'AGENTS.md'), 'Mock agents content');

  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.join(' '));
  };

  try {
    // First sync to create them
    await runAgents(fixtureDir, mockConfig, { sync: true });

    // Then check them
    await runAgents(fixtureDir, mockConfig, { check: true });
  } finally {
    console.log = originalLog;
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }

  assert.ok(logs.some(log => log.includes('Agent-file family in sync')));
});
