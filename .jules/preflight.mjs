#!/usr/bin/env node
/**
 * Step 0 of every Jules routine: is there work, and which?
 *
 *   node .jules/preflight.mjs <routine>
 *
 * Prints `GO` and the one target for this run, or `STOP: <reason>`. Exit 0 on
 * GO, 3 on STOP. A routine that gets STOP ends without changes and without a
 * pull request.
 *
 * Reads this repository's pull requests from the public GitHub API (no token
 * needed; GITHUB_TOKEN is sent when present). It fails closed: if the queue
 * cannot be read, the answer is STOP, never a guess. Server-side triage
 * (.github/workflows/jules-triage.yml) enforces the same policy after the
 * fact; this exists so the work is not done in the first place.
 *
 * Maintenance tooling, not part of the package (`files` in package.json does
 * not ship `.jules/`): the CLI makes no network calls, and nothing under cli/
 * imports this. DOCGUARD_JULES_API and DOCGUARD_JULES_REPO override the API
 * base and the repository, for tests.
 *
 * @implements docguard.jules-policy#FR-009
 * @implements docguard.jules-policy#FR-010
 */
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECLINE_WINDOW_DAYS, ROUTINES, bugHuntTargets, governingSpecs, helpSubcommands, isJules, pickTarget, tagTitle, untestedExports,
} from '../.github/scripts/jules-policy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = (process.env.DOCGUARD_JULES_API ?? 'https://api.github.com').replace(/\/+$/, '');
const REPO = process.env.DOCGUARD_JULES_REPO ?? 'raccioly/docguard';
const STOP = 3;
const PAGE = 100;
const MAX_PAGES = 10;

const stop = (reason) => { console.log(`STOP: ${reason}`); process.exit(STOP); };

async function api(path) {
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'docguard-jules-preflight' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`${API}/repos/${REPO}${path}`, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

/** Pages of a pull-request listing, until a short page or `enough(page)`. */
async function pulls(query, enough = () => false) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await api(`/pulls?${query}&per_page=${PAGE}&page=${page}`);
    if (!Array.isArray(data)) throw new Error('unexpected response shape');
    out.push(...data);
    if (data.length < PAGE || enough(data)) return out;
  }
  return out;
}

const sources = (dir, keep) => {
  const out = [];
  const walk = (rel) => {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (keep(path)) out.push({ path, source: readFileSync(join(ROOT, path), 'utf8') });
    }
  };
  walk(dir);
  return out;
};

const cliModules = () => sources('cli', (p) => p.endsWith('.mjs'));
const testModules = () => readdirSync(join(ROOT, 'tests'))
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => ({ path: `tests/${f}`, source: readFileSync(join(ROOT, 'tests', f), 'utf8') }));

let gaps = null;
function candidates(routine) {
  if (routine === 'bug-hunt') return bugHuntTargets(cliModules());
  if (routine === 'test-gaps') {
    gaps = untestedExports({ modules: cliModules(), tests: testModules() });
    return gaps.map((g) => g.file);
  }
  const help = execFileSync(process.execPath, [join(ROOT, 'cli', 'docguard.mjs'), '--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return helpSubcommands(help);
}

function details(routine, target) {
  if (routine === 'bug-hunt') return [`governing spec: ${governingSpecs(readFileSync(join(ROOT, target), 'utf8')).join(', ')}`];
  if (routine === 'test-gaps') return [`untested exports: ${gaps.find((g) => g.file === target).names.join(', ')}`];
  return [`compare: node cli/docguard.mjs ${target} --help  against every mention of \`docguard ${target}\` in README.md, README.<lang>.md and docs/`];
}

const routine = process.argv[2];
if (!ROUTINES.includes(routine)) stop(`unknown routine "${routine ?? ''}"; known: ${ROUTINES.join(', ')}`);

const now = new Date().toISOString();
const cutoff = Date.parse(now) - DECLINE_WINDOW_DAYS * 86_400_000;
let open, closed;
try {
  const toPr = (p) => ({ number: p.number, title: p.title, labels: p.labels, mergedAt: p.merged_at, closedAt: p.closed_at });
  open = (await pulls('state=open')).filter((p) => isJules(p.user?.login)).map(toPr);
  closed = (await pulls('state=closed&sort=updated&direction=desc', (page) => page.some((p) => Date.parse(p.updated_at) < cutoff)))
    .filter((p) => isJules(p.user?.login)).map(toPr);
} catch (e) {
  stop(`cannot read the pull request queue (${e.message}); failing closed`);
}

const pick = pickTarget({ routine, candidates: candidates(routine), open, closed, now });
if (!pick.go) stop(pick.reason);

console.log('GO');
console.log(`routine: ${routine}`);
console.log(`target: ${pick.target}`);
for (const line of details(routine, pick.target)) console.log(line);
console.log(`title: ${tagTitle(routine, pick.target)} — <one-line summary>`);
console.log(`open Jules PRs: ${open.length}`);
