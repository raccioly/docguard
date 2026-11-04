/**
 * DORA's documentation-quality capability and AI Capabilities Model, read
 * from the repository (specs/092-dora-evidence). DORA measures both by
 * survey; this maps facts DocGuard already computes onto them, labels each
 * score `deterministic`, `proxy` or `survey-only`, and reports `null` with a
 * reason, never 0, when there is no evidence. Display-only: `score --dora`
 * renders it, and nothing here feeds the CDD score or an exit code.
 *
 * @implements docguard.dora-evidence#FR-002
 * @implements docguard.dora-evidence#FR-003
 * @implements docguard.dora-evidence#FR-004
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { listTrackedFiles, runGit } from '../shared-git.mjs';
import { docLockStatus } from '../scanners/doc-deps.mjs';
import { loadOwnership } from '../scanners/doc-ownership.mjs';
import { parseLifecycleStatus, RETIRED_STATUSES } from '../scanners/lifecycle-status.mjs';
import { diffEntities, diffEnvVars, diffRoutes, diffTechStack, domainAccuracy } from './diff.mjs';

export const DORA_SOURCES = Object.freeze({
  documentationQuality: 'https://dora.dev/capabilities/documentation-quality/',
  questionnaire: 'https://dora.dev/research/2022/questions/',
  aiCapabilities: 'https://cloud.google.com/blog/products/ai-machine-learning/from-adoption-to-impact-putting-the-dora-ai-capabilities-model-to-work/',
});

export const DORA_CAVEAT = 'DORA measures these capabilities with a survey of the people who do the work. This is evidence read from the repository: it complements that survey and never replaces it. The scores are DocGuard\'s own, not DORA\'s.';

const SMALL_BATCH_DAYS = 90;
const LARGE_COMMIT_FILES = 20;
const MIN_COMMITS = 5;
const INCIDENT_DOC = /runbook|troubleshoot|incident|playbook|on-?call|disaster[-_ ]?recovery/i;
const MCP_CONFIGS = ['.mcp.json', '.cursor/mcp.json', '.vscode/mcp.json'];
const AGENT_FILES = ['AGENTS.md', 'CLAUDE.md'];

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
const mean = xs => { const v = xs.filter(x => typeof x === 'number'); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
const read = (dir, rel) => { try { return readFileSync(resolve(dir, rel), 'utf8'); } catch { return null; } };
const item = (id, label, measure, score, evidence, improve, reason = null) => ({
  id, label, measure, score, evidence, improve, ...(score === null && reason ? { reason } : {}),
});

/** The memory domains (`docguard memory`), each `null` when not applicable. */
function memoryDomains(projectDir, config) {
  const safe = fn => { try { return domainAccuracy(fn(projectDir, config)); } catch { return null; } };
  return { endpoints: safe(diffRoutes), entities: safe(diffEntities), envVars: safe(diffEnvVars), techStack: safe(diffTechStack) };
}

function sum(domains, keys, field) {
  return keys.reduce((n, k) => n + (domains[k] ? (Array.isArray(domains[k][field]) ? domains[k][field].length : domains[k][field]) : 0), 0);
}

function domainEvidence(domains, keys) {
  return keys.filter(k => domains[k]).map(k => {
    const d = domains[k];
    const examples = (label, xs) => (xs.length ? `; ${label}: ${xs.slice(0, 3).join(', ')}${xs.length > 3 ? ', …' : ''}` : '');
    return `${d.title}: ${d.matched} match code, ${d.onlyInDocs.length} only in docs, ${d.onlyInCode.length} only in code${examples('only in docs', d.onlyInDocs)}${examples('only in code', d.onlyInCode)}`;
  });
}

export function incidentDocs(tracked, projectDir) {
  const found = [];
  for (const f of tracked.filter(p => /\.md$/i.test(p))) {
    const content = read(projectDir, f);
    const h1 = content?.match(/^#\s+(.+)$/m)?.[1] || '';
    if (!INCIDENT_DOC.test(basename(f)) && !INCIDENT_DOC.test(h1)) continue;
    const scenarios = (content?.match(/^#{2,3}\s+\S/gm) || []).length;
    found.push({ file: f, scenarios });
  }
  return found;
}

function documentationItems(projectDir, config, { scores, agentRead, domains, tracked }) {
  const all = ['endpoints', 'entities', 'envVars', 'techStack'];
  const matchedAll = sum(domains, all, 'matched');
  const totalAll = sum(domains, all, 'total');
  const metric = key => agentRead.metrics.find(m => m.key === key);

  const lock = (() => { try { return docLockStatus(projectDir, config); } catch { return null; } })();
  const covered = lock ? lock.sections.filter(s => s.state !== 'empty') : [];
  const current = covered.filter(s => s.state === 'current').length;

  const ownership = (() => { try { return loadOwnership(projectDir, config); } catch { return { present: false }; } })();
  const find = [metric('addressability'), metric('llms-txt')].filter(Boolean);

  const capKeys = ['endpoints', 'techStack'];
  const capMatched = sum(domains, capKeys, 'matched');
  const capOnlyDocs = sum(domains, capKeys, 'onlyInDocs');

  const codeKeys = ['endpoints', 'entities', 'envVars'];
  const codeMatched = sum(domains, codeKeys, 'matched');
  const codeOnlyCode = sum(domains, codeKeys, 'onlyInCode');

  const incidents = tracked ? incidentDocs(tracked, projectDir) : [];
  const bestIncident = incidents.sort((a, b) => b.scenarios - a.scenarios)[0];

  return [
    item('reliable', 'Reliable', 'deterministic', pct(matchedAll, totalAll),
      [...(totalAll ? [`${matchedAll} of ${totalAll} checked facts agree between docs and code`] : []), ...domainEvidence(domains, all)],
      'docguard memory --diff — fix each documented fact that does not match code',
      'no documented routes, entities, environment variables or stack facts to check'),
    item('easy-to-understand', 'Easy to understand', 'proxy', scores.docQuality ?? null,
      [`Doc Quality score ${scores.docQuality}/100 (required sections, content and readability)`],
      'docguard score --diff — the Doc Quality findings name the thin sections'),
    item('easy-to-find', 'Easy to find', 'deterministic', mean(find.map(m => m.score)),
      [...find.map(m => `${m.label}: ${m.detail}`), ownership.present ? 'doc ownership map configured: each source path names its doc' : 'no doc ownership map'],
      'docguard llms; add docguard:section markers; docguard init --with ownership',
      'Agent Readability had no addressability or llms.txt metric for this project'),
    item('code-documented', 'Most code is documented', 'deterministic', pct(codeMatched, codeMatched + codeOnlyCode),
      [...(codeMatched + codeOnlyCode ? [`${codeMatched} of ${codeMatched + codeOnlyCode} routes, entities and environment variables in code are documented`] : []), ...domainEvidence(domains, codeKeys)],
      'docguard memory --diff — document the routes, entities and environment variables listed as only in code',
      'no routes, entities or environment variables found in code'),
    item('well-organized', 'Well organized', 'deterministic', scores.structure ?? null,
      [`Structure score ${scores.structure}/100 (required canonical files and layout)`],
      'docguard init — scaffold the missing canonical files'),
    covered.length
      ? item('updated-with-changes', 'Updated as changes are made', 'deterministic', pct(current, covered.length),
        [`${current} of ${covered.length} doc-lock sections reviewed against their current code`],
        'docguard review — re-read each changed section, then review --accept')
      : item('updated-with-changes', 'Updated as changes are made', 'proxy', scores.drift ?? null,
        [`no doc-lock sections; Drift score ${scores.drift}/100 stands in`],
        'cover sections with docguard:covers markers so code changes flag the docs that describe them'),
    item('reflects-capabilities', 'Reflects the capabilities', 'deterministic', pct(capMatched, capMatched + capOnlyDocs),
      [...(capMatched + capOnlyDocs ? [`${capOnlyDocs} of ${capMatched + capOnlyDocs} documented routes and stack facts have no code behind them`] : []), ...domainEvidence(domains, capKeys)],
      'docguard memory --diff — remove or fix the documented routes and stack facts with no code behind them',
      'no documented routes or stack facts to check'),
    item('used-in-incidents', 'Used in incidents', 'proxy',
      tracked ? (bestIncident ? (bestIncident.scenarios >= 2 ? 100 : 50) : 0) : null,
      bestIncident
        ? incidents.slice(0, 5).map(d => `${d.file}: ${d.scenarios} scenario heading(s)`)
        : ['no runbook, troubleshooting or incident document; whether people reach for the docs in an incident is survey-only'],
      'add a runbook (docs/RUNBOOK.md) with one heading per failure scenario',
      'git file list unavailable'),
  ];
}

/** Agent instruction lines that point at retired or superseded docs. */
function stalePointers(projectDir, tracked) {
  const retired = tracked.filter(p => /\.md$/i.test(p)).filter(p => {
    const status = parseLifecycleStatus(read(projectDir, p) || '')?.toLowerCase();
    return status && RETIRED_STATUSES.has(status);
  });
  const hits = [];
  for (const agent of AGENT_FILES) {
    const content = read(projectDir, agent);
    if (!content) continue;
    for (const doc of retired) if (content.includes(doc)) hits.push(`${agent} points at ${doc}, which is ${parseLifecycleStatus(read(projectDir, doc)).toLowerCase()}`);
  }
  return hits;
}

function smallBatches(projectDir) {
  const r = runGit(projectDir, ['log', `--since=${SMALL_BATCH_DAYS}.days`, '--no-merges', '--name-only', '--format=%x00%H'], { operation: 'git log (DORA small batches)', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || r.error) return { score: null, reason: 'git history unavailable', evidence: [] };
  const sizes = r.stdout.split('\0').filter(Boolean).map(block => block.split('\n').slice(1).filter(Boolean).length);
  if (sizes.length < MIN_COMMITS) return { score: null, reason: `${sizes.length} commit(s) in the last ${SMALL_BATCH_DAYS} days; at least ${MIN_COMMITS} are needed`, evidence: [] };
  const sorted = [...sizes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const large = sizes.filter(n => n > LARGE_COMMIT_FILES).length;
  const share = large / sizes.length;
  // 100 at <= 5% large commits, falling linearly to 0 at 50%.
  const score = Math.max(0, Math.min(100, Math.round(100 - ((share - 0.05) / 0.45) * 100)));
  return {
    score,
    evidence: [`${sizes.length} commits in the last ${SMALL_BATCH_DAYS} days: median ${median} file(s) changed, ${large} (${Math.round(share * 100)}%) over ${LARGE_COMMIT_FILES} files`],
  };
}

/**
 * DORA's four version-control items. Infrastructure configuration is
 * evidence only: a repository without it may be a library with none, or an
 * application whose infrastructure lives elsewhere, and nothing here can tell
 * the two apart, so its absence is never scored.
 */
function versionControl(tracked) {
  const has = re => tracked.some(f => re.test(f));
  const infra = tracked.filter(f => /\.tf$|(^|\/)(cdk\.json|serverless\.ya?ml|Pulumi\.ya?ml|template\.ya?ml|kustomization\.ya?ml|docker-compose\.ya?ml|compose\.ya?ml|Procfile|fly\.toml|vercel\.json|netlify\.toml|app\.yaml|wrangler\.toml)$|(^|\/)(k8s|kubernetes|helm|charts)\//.test(f));
  const checks = [
    ['application code', has(/\.(m?[jt]sx?|cjs|py|go|rs|java|kt|rb|php|cs|swift|c|cc|cpp|scala|ex|exs)$/)],
    ['application configuration', has(/\.(json|ya?ml|toml|ini)$|(^|\/)\.env\.example$/)],
    ['build and automation scripts', has(/(^|\/)(package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?|Makefile|Dockerfile)$|^\.github\/workflows\//)],
  ];
  const met = checks.filter(([, ok]) => ok).length;
  return {
    score: pct(met, checks.length),
    evidence: [
      ...checks.map(([name, ok]) => `${name}: ${ok ? 'tracked in git' : 'none tracked'}`),
      infra.length
        ? `infrastructure configuration: tracked in git (${infra.slice(0, 3).join(', ')}${infra.length > 3 ? ', …' : ''})`
        : 'infrastructure configuration: none found; not scored, since a library has none and an application may keep it elsewhere',
    ],
  };
}

function aiStance(projectDir) {
  const file = AGENT_FILES.find(f => existsSync(resolve(projectDir, f)));
  if (!file) return { score: 0, evidence: ['no AGENTS.md or CLAUDE.md'] };
  const content = read(projectDir, file) || '';
  const rules = /\b(must not|never|do not|don't|must|always)\b/i.test(content);
  const boundary = /^#{1,4}\s+.*\b(rules?|boundar|permission|guardrail|policy|do not|never)/im.test(content);
  return {
    score: 50 + (rules || boundary ? 50 : 0),
    evidence: [`${file} present`, rules || boundary ? `${file} states what agents must or must not do` : `${file} states no rule for agents`],
  };
}

function aiItems(projectDir, { agentRead, documentation, tracked }) {
  const reliable = documentation.find(i => i.id === 'reliable').score;
  const mcp = MCP_CONFIGS.filter(f => /docguard/i.test(read(projectDir, f) || ''));
  const stale = tracked ? stalePointers(projectDir, tracked) : [];
  const base = mean([agentRead.score, reliable]);
  const batches = tracked ? smallBatches(projectDir) : { score: null, reason: 'not a git repository', evidence: [] };
  const vc = tracked ? versionControl(tracked) : { score: null, evidence: [] };
  const stance = aiStance(projectDir);
  const survey = (id, label, where) => item(id, label, 'survey-only', null, [where], null, 'not observable in a repository');
  return [
    item('ai-stance', 'Clear AI stance', 'proxy', stance.score, stance.evidence,
      'state in AGENTS.md what agents may do, must do and must never do'),
    survey('healthy-data-ecosystem', 'Healthy data ecosystem', 'lives in data platforms and pipelines, outside this repository'),
    item('ai-accessible-data', 'AI-accessible internal data', 'deterministic',
      base === null ? null : Math.max(0, base - 10 * stale.length),
      [
        `Agent Readability ${agentRead.score}% (${agentRead.grade})`,
        ...(reliable === null ? [] : [`${reliable}% of documented facts match code`]),
        mcp.length ? `DocGuard MCP server configured in ${mcp.join(', ')}` : 'no DocGuard MCP server configured for agents (docguard mcp)',
        ...(stale.length ? stale : ['no agent instruction points at a retired or superseded document']),
      ],
      'docguard memory --pack; docguard mcp; retire stale docs with docguard retire',
      'no agent readability or fact-accuracy evidence'),
    item('version-control', 'Strong version control', 'deterministic', vc.score, vc.evidence,
      'track configuration, build scripts and infrastructure in git', 'not a git repository'),
    item('small-batches', 'Working in small batches', 'deterministic', batches.score, batches.evidence,
      'split changes so most commits touch fewer than 20 files', batches.reason),
    survey('user-centric-focus', 'User-centric focus', 'lives in product research and user feedback, outside this repository'),
    survey('quality-internal-platform', 'Quality internal platform', 'lives in the platform teams use to build and ship, outside this repository'),
  ];
}

/** The `dora` object of `score --dora`, from scores already computed by `runScore`. */
export function computeDoraEvidence(projectDir, config, { scores, agentRead }) {
  const tracked = listTrackedFiles(projectDir);
  const domains = memoryDomains(projectDir, config);
  const documentation = documentationItems(projectDir, config, { scores, agentRead, domains, tracked });
  const ai = aiItems(projectDir, { agentRead, documentation, tracked });
  const scored = documentation.filter(i => i.score !== null);
  return {
    schemaVersion: 1,
    source: DORA_SOURCES,
    caveat: DORA_CAVEAT,
    documentation,
    documentationScore: mean(scored.map(i => i.score)),
    ai,
  };
}
