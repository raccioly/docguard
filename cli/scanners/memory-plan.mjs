/**
 * Memory Plan — the orchestration artifact behind AI-powered Generate.
 *
 * DocGuard's job (per the v2 vision) is to ORCHESTRATE: scan the codebase, build
 * the code-truth skeleton in marked sections, and emit a structured **agent task
 * manifest** telling the AI exactly what prose to write for each section,
 * grounded in scanned facts. The agent then writes the content; DocGuard verifies.
 *
 * This is language-aware: the set of documents and sections depends on the
 * detected project profile (a Rust CLI gets no Screens/API doc; a webapp does).
 *
 * Pure read-only assembly. Zero NPM dependencies.
 */

import { detectProjectProfile } from './project-type.mjs';
import { detectDocTools } from './doc-tools.mjs';
import { scanRoutesDeep } from './routes.mjs';
import { scanSchemasDeep } from './schemas.mjs';
import { scanFrontend } from './frontend.mjs';
import { grepEnvUsage } from '../shared-source.mjs';
import { detectIntegrations } from './integrations.mjs';

const md = {
  table(headers, rows) {
    const head = `| ${headers.join(' | ')} |`;
    const sep = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map(r => `| ${r.join(' | ')} |`).join('\n');
    return [head, sep, body].join('\n');
  },
};

/**
 * v0.15-P1: in-process cache. buildMemoryPlan is expensive (~400ms on
 * an enterprise client project, 33% of total guard validator time) because it triggers
 * routes/schemas/screens/frontend scanners — all of which walk the source
 * tree. Within a single guard run, sync, generate, and the Generated-
 * Staleness validator all ask for the SAME plan; without caching they each
 * re-pay the cost.
 *
 * Cache key: projectDir + a config fingerprint that captures the fields the
 * scanners actually consume (sourceRoot, ignore, projectType). Other config
 * mutations (e.g. changedFiles per-validator) don't invalidate the plan.
 *
 * Bypass with `_skipCache: true` in opts — used by tests and any caller that
 * wants a fresh scan.
 */
const _memoryPlanCache = new Map(); // key → plan

export function clearMemoryPlanCache() {
  _memoryPlanCache.clear();
}

function _cacheKey(projectDir, config) {
  return JSON.stringify({
    dir: projectDir,
    sourceRoot: config.sourceRoot,
    ignore: Array.isArray(config.ignore) ? [...config.ignore].sort() : null,
    projectType: config.projectType,
    profile: config.profile,
  });
}

/**
 * Build the full memory plan for a project.
 * @returns {{ profile, surface, docs, agentTasks }}
 *   docs[].sections[]: { id, source:'code', body } OR { id, source:'human', task, grounding }
 *   agentTasks: flattened prose tasks the AI must write.
 */
export function buildMemoryPlan(projectDir, config = {}, opts = {}) {
  if (!opts._skipCache) {
    const key = _cacheKey(projectDir, config);
    const cached = _memoryPlanCache.get(key);
    if (cached) return cached;
  }
  const result = _buildMemoryPlanUncached(projectDir, config);
  if (!opts._skipCache) {
    _memoryPlanCache.set(_cacheKey(projectDir, config), result);
  }
  return result;
}

// Original implementation, renamed so the public buildMemoryPlan can wrap it.
function _buildMemoryPlanUncached(projectDir, config = {}) {
  const profile = detectProjectProfile(projectDir, config);
  const primaryFramework = profile.primary?.framework || profile.frameworks[0] || '';

  // ── Gather the code-truth surface ──
  const docTools = detectDocTools(projectDir);
  const routes = scanRoutesDeep(projectDir, { framework: profile.frameworks.join(' ') }, docTools, { config });
  const schemas = scanSchemasDeep(projectDir, { framework: primaryFramework }, docTools);
  const entities = schemas.entities || [];
  const isWebFrontend = profile.ecosystems.some(e => e.kind === 'webapp');
  const fe = isWebFrontend
    ? scanFrontend(projectDir, config)
    : { screens: [], components: [], stores: [], hooks: [], contexts: [], apiCalls: [],
        i18n: { usedKeys: [], locales: [], missing: [] },
        framework: null, stateLib: null, dataLib: null };
  const envVars = [...grepEnvUsage(projectDir, config)].sort();
  const integrations = detectIntegrations(projectDir, config);

  const surface = {
    profile,
    endpoints: routes.map(r => ({ method: r.method, path: r.path, auth: !!r.auth })),
    entities: entities.map(e => ({ name: e.name, fields: e.fields || [] })),
    screens: fe.screens,
    components: fe.components,
    envVars,
    integrations,
    stores: fe.stores,
    hooks: fe.hooks,
    contexts: fe.contexts,
    apiCalls: fe.apiCalls,
    i18n: fe.i18n,
    frontend: { framework: fe.framework, stateLib: fe.stateLib, dataLib: fe.dataLib },
  };

  // ── Compose documents + sections (language/kind-aware) ──
  const docs = [];
  const agentTasks = [];
  const addTask = (doc, sectionId, instruction, grounding) => {
    agentTasks.push({ doc, sectionId, instruction, grounding });
    return { id: sectionId, source: 'human', task: instruction, grounding };
  };

  // ARCHITECTURE — always.
  {
    const sections = [];
    const stackRows = [
      ...profile.ecosystems.map(e => [e.dir, e.language, e.framework || '—', e.kind]),
    ];
    sections.push({
      id: 'tech-stack',
      source: 'code',
      body: md.table(['Path', 'Language', 'Framework', 'Kind'], stackRows),
    });
    sections.push(addTask('docs-canonical/ARCHITECTURE.md', 'overview',
      'Write a 2-3 sentence System Overview: what this project does and who uses it.',
      { languages: profile.languages, frameworks: profile.frameworks, kind: profile.kind }));
    sections.push(addTask('docs-canonical/ARCHITECTURE.md', 'components',
      'Describe the major components/modules and their responsibilities, using the real directories below.',
      { ecosystems: profile.ecosystems.map(e => ({ dir: e.dir, language: e.language, framework: e.framework })) }));

    // Frontend modules (stores/hooks/contexts) — code-truth section when present.
    const feCounts = surface.stores.length + surface.hooks.length + surface.contexts.length;
    if (feCounts > 0) {
      const feRows = [
        ['Stores',   String(surface.stores.length),   surface.stores.slice(0, 4).map(s => `\`${s.name}\``).join(', ') || '—'],
        ['Hooks',    String(surface.hooks.length),    surface.hooks.slice(0, 4).map(s => `\`${s.name}\``).join(', ') || '—'],
        ['Contexts', String(surface.contexts.length), surface.contexts.slice(0, 4).map(s => `\`${s.name}\``).join(', ') || '—'],
      ].filter(r => r[1] !== '0');
      sections.push({
        id: 'frontend-modules',
        source: 'code',
        body: md.table(['Kind', 'Count', 'Examples'], feRows),
      });
    }
    docs.push({ path: 'docs-canonical/ARCHITECTURE.md', sections });
  }

  // API-REFERENCE — only if there's an API surface.
  if (surface.endpoints.length > 0) {
    const rows = surface.endpoints.map(e => [`\`${e.method}\``, `\`${e.path}\``, e.auth ? '🔒' : '🔓']);
    const sections = [{
      id: 'endpoints',
      source: 'code',
      body: md.table(['Method', 'Path', 'Auth'], rows),
    }];
    sections.push(addTask('docs-canonical/API-REFERENCE.md', 'overview',
      `Write a short intro describing the API (${surface.endpoints.length} endpoints) and its auth model.`,
      { endpointCount: surface.endpoints.length, framework: primaryFramework }));
    docs.push({ path: 'docs-canonical/API-REFERENCE.md', sections });
  }

  // DATA-MODEL — only if entities detected.
  if (surface.entities.length > 0) {
    const rows = surface.entities.map(e => [`\`${e.name}\``, String((e.fields || []).length)]);
    const sections = [{
      id: 'entities',
      source: 'code',
      body: md.table(['Entity', 'Fields'], rows),
    }];
    sections.push(addTask('docs-canonical/DATA-MODEL.md', 'relationships',
      'Describe the relationships between the entities below and any key indexes.',
      { entities: surface.entities.map(e => e.name) }));
    docs.push({ path: 'docs-canonical/DATA-MODEL.md', sections });
  }

  // SCREENS — only for web frontends with screens.
  if (surface.screens.length > 0) {
    const rows = surface.screens.map(s => [`\`${s.path}\``, s.component || '—']);
    const sections = [{
      id: 'screens',
      source: 'code',
      body: md.table(['Route', 'Screen'], rows),
    }];
    sections.push(addTask('docs-canonical/SCREENS.md', 'flows',
      `Group the ${surface.screens.length} screens into features/user-flows and describe each flow.`,
      { screens: surface.screens.map(s => s.path), components: surface.components.length }));
    docs.push({ path: 'docs-canonical/SCREENS.md', sections });
  }

  // INTEGRATIONS — external services / SDKs detected from deps.
  if (surface.integrations.length > 0) {
    const rows = surface.integrations.map(i => [i.category, `**${i.name}**`, i.evidence.slice(0, 3).join(', ')]);
    const sections = [{
      id: 'integrations',
      source: 'code',
      body: md.table(['Category', 'Service', 'Evidence (SDK)'], rows),
    }];
    sections.push(addTask('docs-canonical/INTEGRATIONS.md', 'overview',
      `Describe each detected integration: what role it plays in this system, which module(s) use it, and any operational notes (auth, credentials, regions).`,
      { integrations: surface.integrations.map(i => ({ name: i.name, category: i.category })) }));
    docs.push({ path: 'docs-canonical/INTEGRATIONS.md', sections });
  }

  // FEATURES — derived from screens + endpoints when there's a UI surface.
  if (surface.screens.length > 0) {
    const groups = {};
    for (const s of surface.screens) {
      const seg = (s.path.split('/').filter(Boolean)[0] || 'root');
      (groups[seg] ??= []).push(s);
    }
    const rows = Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([area, list]) => [`/${area === 'root' ? '' : area}`, String(list.length), list.slice(0, 4).map(s => s.component || s.path).join(', ')]);
    const sections = [{
      id: 'feature-areas',
      source: 'code',
      body: md.table(['Area', 'Screens', 'Examples'], rows),
    }];
    sections.push(addTask('docs-canonical/FEATURES.md', 'features',
      `Turn the candidate feature areas below into a clear feature inventory. For each area: what user job it serves, which screens belong to it, which endpoints back it (use the apiCalls map below as evidence), and the success criteria.`,
      {
        areas: Object.keys(groups),
        screenCount: surface.screens.length,
        endpointCount: surface.endpoints.length,
        apiCalls: surface.apiCalls.slice(0, 30).map(c => ({ method: c.method, path: c.path })),
        storeCount: surface.stores.length,
      }));
    docs.push({ path: 'docs-canonical/FEATURES.md', sections });
  }

  // ENVIRONMENT — env vars + setup.
  if (surface.envVars.length > 0) {
    const rows = surface.envVars.map(v => [`\`${v}\``, '<!-- describe -->']);
    const sections = [{
      id: 'env-vars',
      source: 'code',
      body: md.table(['Variable', 'Description'], rows),
    }];
    sections.push(addTask('docs-canonical/ENVIRONMENT.md', 'setup',
      'Write the Prerequisites and Setup Steps (clone → install → run) for this stack.',
      { languages: profile.languages, frameworks: profile.frameworks }));
    docs.push({ path: 'docs-canonical/ENVIRONMENT.md', sections });
  }

  // ── docs-implementation/ — tribal knowledge the AGENT writes (no code section) ──
  // These can't be derived from code; they capture lessons learned, current
  // state, and operational procedures. DocGuard emits guided prompts; the
  // agent reads git history / chat / human notes and writes them.
  docs.push({
    path: 'docs-implementation/KNOWN-GOTCHAS.md',
    sections: [
      addTask('docs-implementation/KNOWN-GOTCHAS.md', 'gotchas',
        'Document the non-obvious lessons that have bitten this team. For each: symptom → cause → fix. Mine git log (commit messages, revert/hotfix commits), recent PRs, and chat history. Keep entries terse and actionable.',
        { integrations: surface.integrations.map(i => i.name), primary: profile.primary?.framework }),
    ],
  });
  docs.push({
    path: 'docs-implementation/CURRENT-STATE.md',
    sections: [
      addTask('docs-implementation/CURRENT-STATE.md', 'state',
        'Snapshot of what is shipped vs in-flight vs planned. What is deployed (where, which versions), which features are behind flags, what is known tech debt. Mine CHANGELOG, deploy logs, feature-flag config, GitHub Issues/Projects.',
        { kind: profile.kind, languages: profile.languages }),
    ],
  });
  docs.push({
    path: 'docs-implementation/RUNBOOKS.md',
    sections: [
      addTask('docs-implementation/RUNBOOKS.md', 'runbooks',
        'Operational procedures for production: deploy, rollback, hot-fix, common incidents, on-call escalation. For each runbook: when to use, exact steps, and the verification check. Mine scripts/, .github/workflows, deploy docs, and chat history.',
        { integrations: surface.integrations.map(i => i.name) }),
    ],
  });

  return { profile, surface, docs, agentTasks };
}
