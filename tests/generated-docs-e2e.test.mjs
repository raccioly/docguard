/**
 * End to end: on a fresh project of each supported stack, every command that
 * writes documents is followed by `guard` and `diff`, and neither reports a
 * finding caused by what DocGuard just wrote (specs/044-generated-docs-consistency).
 *
 * A finding that remains must be on the flow's allow-list below, and each
 * allow-listed code describes the project, not DocGuard's output.
 *
 * @req docguard.generated-docs-consistency#SC-001
 * @req docguard.generated-docs-consistency#SC-002
 * @req docguard.generated-docs-consistency#SC-003
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { PROJECTS, materialize } from './fixtures/generated-docs-projects.mjs';

const run = promisify(execFile);
const CLI = resolve('cli/docguard.mjs');
const temps = [];
after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

// The flows run without the Spec Kit CLI on every machine. With `specify`
// installed, `init` sets Spec Kit up; without it (as on CI) it cannot, so a
// developer machine and CI would see different findings. Removing every PATH
// entry that holds a `specify` makes the outcome the same everywhere.
const PATH_WITHOUT_SPECIFY = (process.env.PATH || '')
  .split(delimiter)
  .filter(dir => dir && !['specify', 'specify.exe', 'specify.cmd'].some(bin => existsSync(join(dir, bin))))
  .join(delimiter);

async function cli(dir, args) {
  try {
    const { stdout } = await run(process.execPath, [CLI, ...args], { cwd: dir, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PATH: PATH_WITHOUT_SPECIFY, NO_COLOR: '1' } });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.code, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

// SPK001/SPK002 describe the project: Spec Kit is not initialized, because
// the flows run without the Spec Kit CLI (see PATH_WITHOUT_SPECIFY). SPK002
// is the as-built spec's specs/ directory without a .specify/ beside it.
const NO_SPEC_KIT = ['SPK001', 'SPK002'];
// After a blank `init`, the templates are empty forms. Requests to fill them
// in describe work to do, not a defect in what DocGuard wrote.
const FILL_THE_TEMPLATE = ['DCV003', 'ENV003', 'SCH002', 'DDF001', 'DDF002', 'TRC002', ...NO_SPEC_KIT];

const FLOWS = {
  generate: { steps: [['generate']], allow: NO_SPEC_KIT, diffClean: true },
  plan: {
    steps: [['generate', '--plan', '--write']],
    // The plan scaffolds code-derived docs only; without init, the profile's
    // other required files (SECURITY.md, AGENTS.md, CHANGELOG.md, DRIFT-LOG.md)
    // do not exist yet.
    allow: [...NO_SPEC_KIT, 'STR001', 'STR002', 'TRC001'],
    diffClean: true,
  },
  init: { steps: [['init', '--skip-prompts']], allow: FILL_THE_TEMPLATE, diffClean: false },
  'init-plan': { steps: [['init', '--skip-prompts'], ['generate', '--plan', '--write']], allow: NO_SPEC_KIT, diffClean: true },
  'init-spec': {
    steps: [['init', '--skip-prompts'], ['generate', '--spec', '<area>', '--write']],
    // TRC004: the as-built candidates have no test annotations yet — true.
    allow: [...FILL_THE_TEMPLATE, 'TRC004'],
    diffClean: false,
  },
};

/** Paths DocGuard owns: a finding about them is always DocGuard's own output. */
const OWNED = /docs-canonical\/|docs-implementation\/|(^|["\s/])specs\/|\.docguard-specs\.json/;

function bakFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === '.git' || name === 'node_modules') continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.bak')) out.push(full.slice(dir.length + 1));
    }
  };
  walk(dir);
  return out;
}

// Two flows at a time: fast enough, without starving timing-sensitive
// suites that node --test runs in parallel with this file.
describe('generated docs pass DocGuard\'s own checks (SC-001)', { concurrency: 2 }, () => {
  for (const [name, project] of Object.entries(PROJECTS)) {
    for (const [flowName, flow] of Object.entries(FLOWS)) {
      it(`${name}: ${flowName} → guard and diff`, { timeout: 240_000 }, async () => {
        const dir = materialize(project.files, { prefix: `gdc-${name}-` });
        temps.push(dir);
        for (const step of flow.steps) {
          const args = step.map(a => (a === '<area>' ? project.area : a));
          const r = await cli(dir, args);
          assert.equal(r.code, 0, `${args.join(' ')} failed:\n${r.stderr}\n${r.stdout.slice(-2000)}`);
        }

        const guard = await cli(dir, ['guard', '--format', 'json']);
        const report = JSON.parse(guard.stdout);
        const foreign = report.findings.filter(f => !flow.allow.includes(f.code));
        assert.deepEqual(foreign.map(f => `${f.code} ${f.message}`), [], 'findings caused by DocGuard output');

        // An allow-listed directory or config finding must not be about DocGuard's own files.
        const aboutOwn = report.findings.filter(f => ['DCV001', 'DCV003'].includes(f.code) && OWNED.test(f.message || ''));
        assert.deepEqual(aboutOwn.map(f => `${f.code} ${f.message}`), [], 'findings about DocGuard-owned paths');
        // A template must never claim what the code lacks.
        const placeholderClaims = report.findings.filter(f => f.code === 'DDF001' && /documented but not found/.test(f.message));
        assert.deepEqual(placeholderClaims.map(f => f.message), [], 'template placeholders read as claims');

        const diff = await cli(dir, ['diff', '--format', 'json']);
        for (const result of JSON.parse(diff.stdout)) {
          assert.deepEqual(result.onlyInDocs, [], `diff ${result.title}: documented but not in code`);
          if (flow.diffClean) assert.deepEqual(result.onlyInCode, [], `diff ${result.title}: in code but not documented`);
        }

        assert.deepEqual(bakFiles(dir), [], 'no backup left behind');
      });
    }
  }
});
