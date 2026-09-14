#!/usr/bin/env node
/**
 * Frozen R7 task-context evaluation harness.
 *
 * @implements docguard.task-specific-agent-context#FR-011
 * @implements docguard.task-specific-agent-context#FR-012
 * @implements docguard.task-specific-agent-context#FR-013
 * @implements docguard.task-specific-agent-context#FR-014
 * @implements docguard.task-specific-agent-context#FR-015
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../cli/config.mjs';
import { buildTaskContextPacket } from '../../cli/scanners/task-context.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const MANIFEST_PATH = join(HERE, 'manifest.json');
const RESULT_SCHEMA = 'https://raccioly.github.io/docguard/schemas/docguard-agent-context-result.schema.json';
const DEFAULT_RESULT = join(HERE, 'results/observed-v1.json');
const DOCGUARD = join(REPO_ROOT, 'cli/docguard.mjs');
const TASK_SELECTOR = join(REPO_ROOT, 'cli/scanners/task-context.mjs');
const FIXED_GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'DocGuard Benchmark',
  GIT_AUTHOR_EMAIL: 'benchmark@docguard.invalid',
  GIT_COMMITTER_NAME: 'DocGuard Benchmark',
  GIT_COMMITTER_EMAIL: 'benchmark@docguard.invalid',
  GIT_AUTHOR_DATE: '2026-09-14T12:00:00Z',
  GIT_COMMITTER_DATE: '2026-09-14T12:00:00Z',
};

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid benchmark manifest: ${message}`);
}

export function loadManifest(path = MANIFEST_PATH) {
  const manifest = readJson(path);
  assert(manifest?.$schema === 'https://raccioly.github.io/docguard/schemas/docguard-agent-context-benchmark.schema.json', 'unexpected schema');
  assert(manifest.schemaVersion === 1, 'schemaVersion must be 1');
  assert(manifest.protocol?.id === 'docguard-agent-context-v1', 'protocol id is frozen');
  assert(manifest.protocol.repetitions >= 3, 'at least three repetitions are required');
  assert(manifest.protocol.timeoutMs === 300000, 'v1 timeout must remain 300000ms');
  assert(stableJson(manifest.conditions) === stableJson(['task-only', 'context-pack', 'targeted-packet']), 'the three conditions are frozen');
  assert(manifest.tasks?.length === 3, 'v1 requires exactly three tasks');
  assert(new Set(manifest.tasks.map(task => task.id)).size === manifest.tasks.length, 'task ids must be unique');
  assert(manifest.promotion?.nonInferiorityFailures === 1, 'non-inferiority margin is frozen');
  assert(manifest.promotion?.minimumMedianReductionPercent === 15, 'cost threshold is frozen');
  for (const task of manifest.tasks) {
    assert(typeof task.prompt === 'string' && task.prompt.length <= 2000, `${task.id} prompt is invalid`);
    assert(Array.isArray(task.allowedChanges) && task.allowedChanges.length, `${task.id} needs an allowlist`);
    for (const key of ['fixture', 'hiddenEvaluator', 'reference']) {
      const pathValue = task[key];
      assert(typeof pathValue === 'string' && !pathValue.startsWith('/') && !pathValue.split('/').includes('..'), `${task.id}.${key} must be relative`);
      assert(existsSync(join(HERE, pathValue)), `${task.id}.${key} is missing`);
    }
    assert(!resolve(join(HERE, task.hiddenEvaluator)).startsWith(`${resolve(join(HERE, task.fixture))}${sep}`), `${task.id} hidden evaluator leaked into fixture`);
  }
  return manifest;
}

function walkFiles(root, prefix = '') {
  const files = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git' || entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(root, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported fixture entry: ${path}`);
  }
  return files;
}

export function digestTree(root) {
  const hash = createHash('sha256');
  for (const path of walkFiles(root)) {
    hash.update(path).update('\0').update(readFileSync(join(root, path))).update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function runFile(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeout ?? 30000,
    env: options.env ?? { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
}

function parseEvaluation(result, taskId) {
  const lines = String(result.stdout || '').trim().split('\n').filter(Boolean);
  let parsed;
  try { parsed = JSON.parse(lines.at(-1)); } catch { throw new Error(`${taskId} evaluator did not emit JSON: ${result.stderr || result.stdout}`); }
  assert(Number.isInteger(parsed.total) && parsed.total > 0, `${taskId} evaluator total is invalid`);
  assert(Number.isInteger(parsed.passed) && parsed.passed >= 0 && parsed.passed <= parsed.total, `${taskId} evaluator passed is invalid`);
  assert(Array.isArray(parsed.failures) && parsed.failures.length === parsed.total - parsed.passed, `${taskId} evaluator failures are invalid`);
  return parsed;
}

function evaluateHidden(task, projectDir) {
  const evaluator = join(HERE, task.hiddenEvaluator);
  const command = extname(evaluator) === '.py' ? 'python3' : process.execPath;
  return parseEvaluation(runFile(command, [evaluator, projectDir], { cwd: HERE }), task.id);
}

function runVisible(task, projectDir) {
  const [command, ...args] = task.visibleTest;
  const expanded = args.flatMap(arg => {
    if (!arg.includes('*')) return [arg];
    const directory = dirname(arg);
    const pattern = basename(arg).replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
    const root = resolve(projectDir, directory);
    if (!existsSync(root)) return [arg];
    const matches = readdirSync(root).filter(name => new RegExp(`^${pattern}$`).test(name)).sort();
    return matches.length ? matches.map(name => join(directory, name)) : [arg];
  });
  return runFile(command, expanded, { cwd: projectDir, timeout: 60000 });
}

function materialize(task, label = 'trial') {
  const root = mkdtempSync(join(tmpdir(), `docguard-r7-${task.id}-${label}-`));
  cpSync(join(HERE, task.fixture), root, { recursive: true });
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'frozen fixture']]) {
    const result = runFile('git', args, { cwd: root, env: FIXED_GIT_ENV });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  }
  return root;
}

export function verifyFixtures(manifest = loadManifest()) {
  const summaries = [];
  for (const task of manifest.tasks) {
    const fixtureRoot = join(HERE, task.fixture);
    const visible = runVisible(task, fixtureRoot);
    assert(visible.status === 0, `${task.id} visible pass-to-pass test fails before editing: ${visible.stderr || visible.stdout}`);
    const initial = evaluateHidden(task, fixtureRoot);
    assert(initial.passed === task.expectedInitial.passed, `${task.id} initial passed count changed (${initial.passed})`);
    assert(initial.failures.length === task.expectedInitial.failed, `${task.id} initial failed count changed (${initial.failures.length})`);

    const referenceRoot = materialize(task, 'reference');
    try {
      assert(task.allowedChanges.length === 1, `${task.id} v1 reference expects one allowed source path`);
      cpSync(join(HERE, task.reference), join(referenceRoot, task.allowedChanges[0]));
      const referenceVisible = runVisible(task, referenceRoot);
      const referenceHidden = evaluateHidden(task, referenceRoot);
      assert(referenceVisible.status === 0, `${task.id} reference regressed visible behavior`);
      assert(referenceHidden.passed === referenceHidden.total, `${task.id} reference does not pass hidden checks`);
    } finally {
      rmSync(referenceRoot, { recursive: true, force: true });
    }
    summaries.push({ id: task.id, fixtureDigest: digestTree(fixtureRoot), initial });
  }
  return summaries;
}

function trialIdentity(task, condition, repetition) {
  return `${task.id}:${condition}:${repetition}`;
}

export function orderedTrials(manifest = loadManifest()) {
  const trials = [];
  for (const task of manifest.tasks) {
    for (const condition of manifest.conditions) {
      for (let repetition = 1; repetition <= manifest.protocol.repetitions; repetition++) {
        trials.push({ id: trialIdentity(task, condition, repetition), task, condition, repetition });
      }
    }
  }
  return trials.sort((a, b) => {
    const ah = sha256(`${manifest.protocol.seed}:${a.id}`);
    const bh = sha256(`${manifest.protocol.seed}:${b.id}`);
    return ah.localeCompare(bh) || a.id.localeCompare(b.id);
  });
}

function normalizePack(text) {
  return text.replace(/Generated by `docguard memory --pack` [^—]+—/, 'Generated by `docguard memory --pack` <generated-at> —').trim();
}

function contextFor(task, condition, projectDir) {
  if (condition === 'task-only') return '';
  if (condition === 'context-pack') {
    const result = runFile(process.execPath, [DOCGUARD, 'memory', '--pack', '--stdout', '--dir', projectDir], { cwd: REPO_ROOT, timeout: 60000 });
    if (result.status !== 0) throw new Error(`context pack failed: ${result.stderr || result.stdout}`);
    return normalizePack(result.stdout);
  }
  const packet = buildTaskContextPacket(projectDir, loadConfig(projectDir), task.prompt);
  if (packet.selection.status !== 'targeted') throw new Error(`${task.id} targeted selector abstained`);
  return JSON.stringify(packet, null, 2);
}

export function buildTrialPrompt(task, condition, projectDir) {
  const context = contextFor(task, condition, projectDir);
  return [
    task.prompt,
    '',
    'Work only inside this repository. Do not use the network. Inspect repository evidence before editing. Do not change documentation or tests. Finish the implementation and verification in this one turn.',
    ...(context ? ['', `BEGIN ${condition.toUpperCase()} CONTEXT`, context, `END ${condition.toUpperCase()} CONTEXT`] : []),
  ].join('\n');
}

function killTree(child) {
  if (!child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* already exited */ } }
  setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }, 2000).unref();
}

function runCodex(executable, args, options) {
  return new Promise(resolveRun => {
    const started = Date.now();
    const child = spawn(executable, args, { cwd: options.cwd, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, options.timeoutMs);
    child.on('error', error => { clearTimeout(timer); resolveRun({ status: null, signal: null, stdout, stderr: `${stderr}\n${error.message}`, timedOut, latencyMs: Date.now() - started }); });
    child.on('close', (status, signal) => { clearTimeout(timer); resolveRun({ status, signal, stdout, stderr, timedOut, latencyMs: Date.now() - started }); });
  });
}

function parseJsonl(stdout) {
  const events = [];
  for (const line of stdout.split('\n').filter(Boolean)) {
    try { events.push(JSON.parse(line)); } catch { /* CLI warnings are retained in stderr, malformed stdout is ignored and reflected by missing usage */ }
  }
  return events;
}

function usageFrom(events) {
  const completed = [...events].reverse().find(event => event.type === 'turn.completed');
  const usage = completed?.usage || completed?.turn?.usage || {};
  const inputTokens = usage.input_tokens ?? usage.inputTokens ?? null;
  const cachedInputTokens = usage.cached_input_tokens ?? usage.cachedInputTokens ?? null;
  return {
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens: inputTokens == null || cachedInputTokens == null ? null : Math.max(0, inputTokens - cachedInputTokens),
    outputTokens: usage.output_tokens ?? usage.outputTokens ?? null,
    reasoningTokens: usage.reasoning_tokens ?? usage.reasoningTokens ?? null,
  };
}

function boundedFailure(run) {
  const lines = String(run.stderr || run.signal || 'agent failed').split('\n')
    .filter(line => line.trim() && !line.includes('state db discrepancy during find_thread_path'));
  return lines.slice(-12).join('\n').slice(-2000) || 'agent failed without diagnostic output';
}

function changedFiles(projectDir) {
  const result = runFile('git', ['status', '--porcelain=v1', '-z'], { cwd: projectDir });
  if (result.status !== 0) throw new Error(`git status failed: ${result.stderr}`);
  return result.stdout.split('\0').filter(Boolean).map(record => record.slice(3)).map(path => path.includes(' -> ') ? path.split(' -> ').at(-1) : path).sort();
}

function patchDigest(projectDir) {
  const tracked = runFile('git', ['diff', '--binary', 'HEAD'], { cwd: projectDir });
  const untracked = changedFiles(projectDir).filter(path => !existsSync(join(projectDir, path)) || runFile('git', ['ls-files', '--error-unmatch', path], { cwd: projectDir }).status !== 0);
  const hashInput = `${tracked.stdout}\n${untracked.map(path => `${path}\0${existsSync(join(projectDir, path)) && statSync(join(projectDir, path)).isFile() ? readFileSync(join(projectDir, path)) : ''}`).join('\n')}`;
  return hashInput.trim() ? sha256(hashInput) : null;
}

async function runTrial(manifest, trial, executable) {
  const projectDir = materialize(trial.task, `r${trial.repetition}`);
  try {
    const prompt = buildTrialPrompt(trial.task, trial.condition, projectDir);
    const args = [
      'exec', '--ephemeral', '--json', '--ignore-user-config', '--ignore-rules',
      // In this CLI version --approve-for-me already selects workspace-write
      // and is mutually exclusive with --sandbox. The manifest still freezes
      // the effective sandbox so a future harness cannot silently broaden it.
      '--approve-for-me',
      '-m', manifest.protocol.model.id,
      '-c', `model_reasoning_effort=${manifest.protocol.model.reasoningEffort}`,
      '-C', projectDir, prompt,
    ];
    const run = await runCodex(executable, args, { cwd: projectDir, timeoutMs: manifest.protocol.timeoutMs });
    const events = parseJsonl(run.stdout);
    const hidden = evaluateHidden(trial.task, projectDir);
    const visible = runVisible(trial.task, projectDir);
    const files = changedFiles(projectDir);
    const unnecessary = files.filter(path => !trial.task.allowedChanges.includes(path));
    const substantiveEvents = events.some(event => event.type === 'item.started' || event.type === 'item.completed');
    const status = run.timedOut ? 'timed-out'
      : run.status === 0 ? 'completed'
        : substantiveEvents ? 'agent-failed' : 'infrastructure-failed';
    const success = status === 'completed' && hidden.passed === hidden.total && visible.status === 0 && unnecessary.length === 0;
    const completedItems = events.filter(event => event.type === 'item.completed');
    const steps = completedItems.filter(event => ['command_execution', 'file_change', 'mcp_tool_call', 'tool_call'].includes(event.item?.type)).length;
    return {
      id: trial.id,
      task: trial.task.id,
      condition: trial.condition,
      repetition: trial.repetition,
      status,
      success,
      requirementsPassed: hidden.passed,
      requirementsTotal: hidden.total,
      requirementViolations: hidden.total - hidden.passed + (visible.status === 0 ? 0 : 1),
      unnecessaryEdits: unnecessary.length,
      changedFiles: files,
      steps,
      usage: usageFrom(events),
      latencyMs: run.latencyMs,
      humanIntervention: success ? 0 : 1,
      patchDigest: patchDigest(projectDir),
      failure: status === 'completed' ? (success ? null : `verification failed: ${hidden.failures.join('; ')}${visible.status === 0 ? '' : '; visible tests failed'}${unnecessary.length ? `; unnecessary edits: ${unnecessary.join(', ')}` : ''}`) : boundedFailure(run),
    };
  } catch (error) {
    return {
      id: trial.id, task: trial.task.id, condition: trial.condition, repetition: trial.repetition,
      status: 'infrastructure-failed', success: false, requirementsPassed: 0, requirementsTotal: 1,
      requirementViolations: 1, unnecessaryEdits: 0, changedFiles: [], steps: 0,
      usage: { inputTokens: null, cachedInputTokens: null, uncachedInputTokens: null, outputTokens: null, reasoningTokens: null },
      latencyMs: 0, humanIntervention: 1, patchDigest: null, failure: error.message,
    };
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
}

function median(values) {
  const usable = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!usable.length) return null;
  const middle = Math.floor(usable.length / 2);
  return usable.length % 2 ? usable[middle] : (usable[middle - 1] + usable[middle]) / 2;
}

export function aggregateTrials(manifest, trials) {
  const aggregate = {};
  for (const condition of manifest.conditions) {
    const group = trials.filter(trial => trial.condition === condition);
    aggregate[condition] = {
      runs: group.length,
      completedRuns: group.filter(trial => trial.status === 'completed').length,
      infrastructureFailures: group.filter(trial => trial.status === 'infrastructure-failed').length,
      timedOut: group.filter(trial => trial.status === 'timed-out').length,
      agentFailures: group.filter(trial => trial.status === 'agent-failed').length,
      successes: group.filter(trial => trial.success).length,
      failures: group.filter(trial => !trial.success).length,
      requirementViolations: group.reduce((sum, trial) => sum + trial.requirementViolations, 0),
      unnecessaryEdits: group.reduce((sum, trial) => sum + trial.unnecessaryEdits, 0),
      medianSteps: median(group.map(trial => trial.steps)),
      medianUncachedInputTokens: median(group.map(trial => trial.usage.uncachedInputTokens)),
      medianLatencyMs: median(group.map(trial => trial.latencyMs)),
    };
  }
  return aggregate;
}

function reduction(targeted, baseline) {
  if (!Number.isFinite(targeted) || !Number.isFinite(baseline) || baseline <= 0) return null;
  return ((baseline - targeted) / baseline) * 100;
}

export function decidePromotion(manifest, aggregate) {
  const taskOnly = aggregate['task-only'];
  const full = aggregate['context-pack'];
  const targeted = aggregate['targeted-packet'];
  if ([taskOnly, full, targeted].some(value => value.runs !== manifest.tasks.length * manifest.protocol.repetitions)) {
    return { status: 'incomplete', reasons: ['The frozen 27-run matrix is incomplete.'] };
  }
  const infrastructureFailures = taskOnly.infrastructureFailures + full.infrastructureFailures + targeted.infrastructureFailures;
  if (infrastructureFailures > 0) {
    return { status: 'incomplete', reasons: [`${infrastructureFailures} trial(s) ended in infrastructure failure; promotion requires observations from every frozen trial.`] };
  }
  const reasons = [];
  const nonInferior = targeted.failures <= Math.min(taskOnly.failures, full.failures) + manifest.promotion.nonInferiorityFailures;
  if (!nonInferior) reasons.push('Targeted context exceeded the frozen failure non-inferiority margin.');
  const requirementsSafe = targeted.requirementViolations <= taskOnly.requirementViolations
    && targeted.requirementViolations <= full.requirementViolations;
  if (!requirementsSafe) reasons.push('Targeted context introduced additional requirement violations.');
  const editsSafe = targeted.unnecessaryEdits <= taskOnly.unnecessaryEdits
    && targeted.unnecessaryEdits <= full.unnecessaryEdits;
  if (!editsSafe) reasons.push('Targeted context introduced additional unnecessary edits.');
  const reductions = {
    uncachedInputTokens: reduction(targeted.medianUncachedInputTokens, full.medianUncachedInputTokens),
    steps: reduction(targeted.medianSteps, full.medianSteps),
    latency: reduction(targeted.medianLatencyMs, full.medianLatencyMs),
  };
  const successGain = targeted.successes > full.successes;
  const costGain = Object.values(reductions).some(value => value != null && value >= manifest.promotion.minimumMedianReductionPercent);
  if (!successGain && !costGain) reasons.push('Targeted context produced neither a success gain nor the frozen 15% median cost reduction versus the context pack.');
  if (nonInferior && requirementsSafe && editsSafe && (successGain || costGain)) {
    reasons.push(successGain ? 'Targeted context gained at least one success versus the context pack.' : 'Targeted context met the frozen median cost-reduction threshold.');
    return { status: 'promote', reasons, reductions };
  }
  return { status: 'reject', reasons, reductions };
}

function buildResult(manifest, fixtureSummaries, trials, executableVersion) {
  const aggregate = aggregateTrials(manifest, trials);
  const decision = decidePromotion(manifest, aggregate);
  return {
    $schema: RESULT_SCHEMA,
    schemaVersion: 1,
    core: {
      protocolId: manifest.protocol.id,
      manifestDigest: sha256(stableJson(manifest)),
      harnessDigest: sha256(readFileSync(fileURLToPath(import.meta.url))),
      analysisDigest: sha256(readFileSync(fileURLToPath(import.meta.url))),
      selectorDigest: sha256(readFileSync(TASK_SELECTOR)),
      fixtureDigests: Object.fromEntries(fixtureSummaries.map(item => [item.id, item.fixtureDigest])),
      trialOrder: orderedTrials(manifest).map(trial => trial.id),
      aggregate,
      decision,
    },
    observations: {
      generatedAt: new Date().toISOString(),
      environment: { platform: process.platform, arch: process.arch, node: process.version, codex: executableVersion },
      trials: orderedTrials(manifest).map(({ id }) => trials.find(trial => trial.id === id)),
    },
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function runMatrix(manifest, fixtureSummaries, options) {
  const executable = options.executable;
  const versionResult = runFile(executable, ['--version'], { cwd: REPO_ROOT });
  if (versionResult.status !== 0) throw new Error(`Codex CLI unavailable: ${versionResult.stderr}`);
  const version = versionResult.stdout.trim();
  if (!version.includes(manifest.protocol.model.cliVersion)) throw new Error(`Frozen CLI version ${manifest.protocol.model.cliVersion} required; found ${version}`);
  const checkpointPath = `${options.out}.checkpoint`;
  const prior = existsSync(checkpointPath) ? readJson(checkpointPath) : { manifestDigest: sha256(stableJson(manifest)), trials: [] };
  if (prior.manifestDigest !== sha256(stableJson(manifest))) throw new Error('Checkpoint belongs to a different manifest.');
  const byId = new Map(prior.trials.map(trial => [trial.id, trial]));
  const pending = orderedTrials(manifest).filter(trial => !byId.has(trial.id));
  let next = 0;
  const workers = Array.from({ length: Math.min(options.concurrency, pending.length) }, async () => {
    while (next < pending.length) {
      const trial = pending[next++];
      process.stderr.write(`[r7] start ${trial.id}\n`);
      const result = await runTrial(manifest, trial, executable);
      byId.set(result.id, result);
      writeJson(checkpointPath, { manifestDigest: prior.manifestDigest, trials: [...byId.values()] });
      process.stderr.write(`[r7] ${result.success ? 'pass' : result.status} ${trial.id} (${result.latencyMs}ms)\n`);
    }
  });
  await Promise.all(workers);
  const result = buildResult(manifest, fixtureSummaries, [...byId.values()], version);
  writeJson(options.out, result);
  rmSync(checkpointPath, { force: true });
  return result;
}

function parseArgs(argv) {
  const options = { run: false, out: DEFAULT_RESULT, concurrency: 3, executable: process.env.CODEX_BIN || '/Applications/ChatGPT.app/Contents/Resources/codex' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run') options.run = true;
    else if (argv[i] === '--out' && argv[i + 1]) options.out = resolve(argv[++i]);
    else if (argv[i] === '--concurrency' && argv[i + 1]) options.concurrency = Number(argv[++i]);
    else if (argv[i] === '--codex' && argv[i + 1]) options.executable = resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 6) throw new Error('--concurrency must be an integer from 1 to 6');
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = loadManifest();
  const fixtures = verifyFixtures(manifest);
  if (!options.run) {
    console.log(JSON.stringify({ status: 'validated', protocol: manifest.protocol.id, trials: orderedTrials(manifest).length, fixtures }, null, 2));
    return;
  }
  const result = await runMatrix(manifest, fixtures, options);
  console.log(JSON.stringify({ status: result.core.decision.status, aggregate: result.core.aggregate, decision: result.core.decision, out: relative(process.cwd(), options.out) }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}
