import { remapDocPath } from '../shared-doc-roles.mjs';
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
import { PROFILES } from '../shared.mjs';
import { scanComponents, scanTestInventory } from './inventory.mjs';

const md = {
  table(headers, rows) {
    const head = `| ${headers.join(' | ')} |`;
    const sep = `| ${headers.map(() => '---').join(' | ')} |`;
    const body = rows.map(r => `| ${r.join(' | ')} |`).join('\n');
    return [head, sep, body].join('\n');
  },
};

/**
 * Both cache layers share a working-tree identity (NFR-003). Content, paths,
 * configuration and scanner implementation participate: HEAD/status/mtimes
 * alone cannot distinguish repeated edits to an already-dirty file.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync,
  openSync, closeSync, readSync, fstatSync, renameSync, unlinkSync, constants,
} from 'node:fs';
import { resolve as resolvePath, join as joinPath, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_IGNORE_DIRS, buildIgnoreFilter } from '../shared-ignore.mjs';
import { astTierAvailable } from './js-ast.mjs';
import { pyAstAvailable } from './py-ast.mjs';

const _memoryPlanCache = new Map(); // config key → { treeHash, plan }
const _DISK_CACHE_PATH = '.docguard/plan.cache.json';
const _DISK_CACHE_VERSION = '2';
const _CACHE_IGNORE_DIRS = new Set([
  ...DEFAULT_IGNORE_DIRS, '.local', '.docguard', '.wolf', '.codex', '.claude',
]);
// A large/unreadable tree is a cache miss, never a partial cache identity.
const _MAX_HASH_BYTES = 64 * 1024 * 1024;
const _MAX_HASH_ENTRIES = 50_000;
const _MAX_CACHE_BYTES = 16 * 1024 * 1024;
const _MAX_MEMORY_PLANS = 32;
let _scannerIdentity;

function _stableConfig(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(_stableConfig);
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.keys(value).sort()
      .filter(k => value[k] !== undefined).map(k => [k, _stableConfig(value[k])]));
  }
  throw new Error('Non-JSON scanner configuration');
}

function _cacheKey(projectDir, config) {
  try {
    if (_scannerIdentity === undefined) {
      // Once per process: also invalidate developer builds without a version
      // bump. Loaded ESM modules themselves are immutable within this process.
      const cli = fileURLToPath(new URL('../', import.meta.url));
      const hash = createHash('sha256');
      hash.update(readFileSync(new URL('../../package.json', import.meta.url)));
      for (const dir of [cli, joinPath(cli, 'scanners')]) {
        for (const name of readdirSync(dir).sort()) {
          if (name.endsWith('.mjs')) hash.update(name).update(readFileSync(joinPath(dir, name)));
        }
      }
      hash.update(JSON.stringify([process.version, astTierAvailable(), pyAstAvailable()]));
      _scannerIdentity = hash.digest('hex');
    }
    // changedFiles scopes validators, not plan scanners; diskCache is policy.
    const { changedFiles, diskCache, ...scannerConfig } = config;
    return createHash('sha256').update(JSON.stringify([
      projectDir, _scannerIdentity, _stableConfig(scannerConfig),
    ])).digest('hex');
  } catch { return null; }
}

function _treeStateHash(projectDir, config) {
  try {
    // Source roots outside this tree cannot be certified by a project walk.
    const ignored = buildIgnoreFilter(config.ignore || []);
    const covered = root => {
      const rel = relative(projectDir, resolvePath(projectDir, root)).replaceAll('\\', '/');
      return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('../')
        && !rel.split('/').some(part => _CACHE_IGNORE_DIRS.has(part)) && !ignored(rel);
    };
    const roots = Array.isArray(config.sourceRoot) ? config.sourceRoot : [config.sourceRoot];
    for (const root of roots.filter(Boolean)) {
      if (!covered(root)) return null;
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let bytes = 0;
    let entries = 0;
    function walk(dir, prefix = '') {
      for (const name of readdirSync(dir).sort()) {
        if (_CACHE_IGNORE_DIRS.has(name)) continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        // Always fingerprint the rules themselves, even if they exclude self.
        if (name !== '.docguardignore' && name !== '.docguard.json' && ignored(rel)) continue;
        if (++entries > _MAX_HASH_ENTRIES) throw new Error('Cache tree too large');
        const path = joinPath(dir, name);
        const stat = lstatSync(path);
        // Do not follow links (including broken links/cycles/private targets).
        // Some scanners follow known input names, so skipping a link is not a
        // complete identity either: bypass caching for the whole build.
        if (stat.isSymbolicLink()) throw new Error('Linked input');
        hash.update(JSON.stringify([rel, stat.isDirectory() ? 'dir' : 'file']));
        if (stat.isDirectory()) { walk(path, rel); continue; }
        if (!stat.isFile()) throw new Error('Non-regular input');
        // SECURITY.md: .env values must never be read. Metadata still tracks
        // existence/replacement/edits without incorporating secret contents.
        if (/^\.env(?:\.|$)/.test(name)) {
          hash.update(JSON.stringify([stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]));
          continue;
        }
        bytes += stat.size;
        if (bytes > _MAX_HASH_BYTES) throw new Error('Cache tree too large');
        const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        try {
          const before = fstatSync(fd);
          if (!before.isFile() || before.ino !== stat.ino || before.dev !== stat.dev)
            throw new Error('Input replaced while hashing');
          const content = createHash('sha256');
          let count = 0;
          let n;
          while ((n = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
            count += n;
            if (count > stat.size) throw new Error('Input grew while hashing');
            content.update(buffer.subarray(0, n));
          }
          const after = fstatSync(fd);
          if (count !== stat.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
            throw new Error('Input changed while hashing');
          hash.update(content.digest('hex'));
        } finally { closeSync(fd); }
      }
    }
    walk(projectDir);
    // Inspect declarations before expanding workspace globs: the shared
    // resolver can otherwise traverse an external/private workspace just to
    // discover its package names. This check only reads root manifests that
    // the completed walk already certified as regular files.
    for (const name of ['package.json', 'pnpm-workspace.yaml']) {
      const path = joinPath(projectDir, name);
      if (!existsSync(path)) continue;
      if (ignored(name) || !lstatSync(path).isFile()) return null;
      const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      let content;
      try { content = readFileSync(fd, 'utf-8'); }
      finally { closeSync(fd); }
      const declarations = name === 'package.json'
        ? (() => {
          const workspaces = JSON.parse(content).workspaces;
          return Array.isArray(workspaces) ? workspaces : workspaces?.packages || [];
        })()
        : [...content.matchAll(/^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map(m => m[1]);
      if (declarations.some(root => !covered(root))) return null;
    }
    return hash.digest('hex');
  } catch { return null; }
}

function _cacheDirectorySafe(projectDir) {
  try { return lstatSync(joinPath(projectDir, '.docguard')).isDirectory(); }
  catch { return false; }
}

/** Validate the serialized contract before any consumer can dereference it. */
function _validCachedPlan(plan) {
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const text = value => typeof value === 'string';
  const nullableText = value => value == null || text(value);
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const list = (value, valid) => Array.isArray(value) && value.every(valid);
  const texts = value => list(value, text);
  const records = value => list(value, record);
  // Consumers serialize grounding and other scanner metadata. Reject deep or
  // oversized object graphs too, so valid JSON cannot cause a stack overflow.
  let nodes = 0;
  const json = (value, depth = 0) => {
    if (++nodes > 200_000 || depth > 64) return false;
    if (value === null || text(value) || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (!record(value) && !Array.isArray(value)) return false;
    return Object.values(value).every(child => json(child, depth + 1));
  };
  const ecosystem = value => record(value) && text(value.dir) && text(value.language)
    && text(value.kind) && nullableText(value.framework);
  const profile = value => record(value) && text(value.kind) && typeof value.polyglot === 'boolean'
    && texts(value.languages) && texts(value.frameworks) && list(value.ecosystems, ecosystem)
    && (value.primary === null || ecosystem(value.primary));
  const docPath = value => text(value) && /^docs-(?:canonical|implementation)\/.+\.md$/.test(value)
    && !/[\\:\x00-\x1f]/.test(value) && value.split('/').every(part => part && !part.startsWith('.'));
  const grounding = value => value == null || record(value);
  const section = value => record(value) && text(value.id) && (
    value.source === 'code' ? text(value.body)
      : value.source === 'human' && text(value.task) && grounding(value.grounding)
  );
  const namedFile = value => record(value) && text(value.name) && text(value.file);
  if (!record(plan) || !json(plan) || !profile(plan.profile) || !texts(plan.notes)
      || !list(plan.docs, doc => record(doc) && docPath(doc.path) && list(doc.sections, section))
      || !list(plan.agentTasks, task => record(task) && docPath(task.doc) && text(task.sectionId)
        && text(task.instruction) && grounding(task.grounding))) return false;
  const s = plan.surface;
  return record(s) && profile(s.profile)
    && list(s.endpoints, e => record(e) && text(e.method) && text(e.path) && typeof e.auth === 'boolean')
    && list(s.entities, e => record(e) && text(e.name) && records(e.fields))
    && list(s.screens, e => record(e) && text(e.path) && text(e.file) && nullableText(e.component))
    && [s.components, s.stores, s.hooks, s.contexts].every(items => list(items, namedFile))
    && list(s.apiCalls, e => record(e) && text(e.method) && text(e.path))
    && texts(s.envVars)
    && list(s.integrations, e => record(e) && text(e.name) && text(e.category) && texts(e.evidence))
    && list(s.modules, e => record(e) && text(e.name) && text(e.path) && ['module', 'file'].includes(e.kind))
    && record(s.tests) && count(s.tests.totalFiles) && count(s.tests.totalCases)
    && list(s.tests.files, e => record(e) && text(e.file) && count(e.cases))
    && record(s.i18n) && texts(s.i18n.usedKeys) && texts(s.i18n.missing)
    && list(s.i18n.locales, e => record(e) && text(e.file) && count(e.keys))
    && record(s.frontend) && [s.frontend.framework, s.frontend.stateLib, s.frontend.dataLib].every(nullableText);
}

/** One insertion policy for fresh builds and disk promotions (FIFO, not LRU). */
function _rememberPlan(key, treeHash, plan) {
  _memoryPlanCache.delete(key);
  while (_memoryPlanCache.size >= _MAX_MEMORY_PLANS) {
    _memoryPlanCache.delete(_memoryPlanCache.keys().next().value);
  }
  _memoryPlanCache.set(key, { treeHash, plan });
}

function _readDiskCache(projectDir, configKey, treeHash) {
  try {
    if (!_cacheDirectorySafe(projectDir)) return null;
    const path = resolvePath(projectDir, _DISK_CACHE_PATH);
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > _MAX_CACHE_BYTES) return null;
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let data;
    try { data = JSON.parse(readFileSync(fd, 'utf-8')); }
    finally { closeSync(fd); }
    if (data.v !== _DISK_CACHE_VERSION || data.configKey !== configKey || data.treeHash !== treeHash) return null;
    return _validCachedPlan(data.plan) ? data.plan : null;
  } catch { return null; }
}

function _writeDiskCache(projectDir, configKey, treeHash, plan) {
  let temporary;
  try {
    const dir = joinPath(projectDir, '.docguard');
    if (!existsSync(dir)) mkdirSync(dir);
    if (!_cacheDirectorySafe(projectDir)) return;
    const path = resolvePath(projectDir, _DISK_CACHE_PATH);
    // Never read or overwrite the target of a pre-existing cache symlink.
    try { if (!lstatSync(path).isFile()) return; }
    catch (err) { if (err.code !== 'ENOENT') return; }
    const payload = JSON.stringify({
      v: _DISK_CACHE_VERSION, configKey, treeHash, plan, writtenAt: new Date().toISOString(),
    });
    if (Buffer.byteLength(payload) > _MAX_CACHE_BYTES) return;
    temporary = joinPath(dir, `plan.cache.${randomUUID()}.tmp`);
    // safeWrite is for generated docs (backup + overwrite). Cache publication
    // needs an exclusive temporary file + atomic rename so competing readers
    // never see partial JSON; backups would only preserve disposable data.
    writeFileSync(temporary, payload, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
    if (!_cacheDirectorySafe(projectDir)) return;
    renameSync(temporary, path);
  } catch { /* cache persistence is best-effort */ }
  finally {
    if (temporary && _cacheDirectorySafe(projectDir)) {
      try { unlinkSync(temporary); } catch { /* renamed or unavailable */ }
    }
  }
}

export function clearMemoryPlanCache() {
  _memoryPlanCache.clear();
}

/** Build the plan, caching only a complete, stable working-tree snapshot. */
export function buildMemoryPlan(projectDir, config = {}, opts = {}) {
  projectDir = resolvePath(projectDir);
  // Read current ignore rules on every call, including calls with reused config.
  // Refuse symlinked ignore files rather than following them in the cache layer.
  let cacheable = !opts._skipCache;
  try {
    const path = joinPath(projectDir, '.docguardignore');
    if (lstatSync(path).isFile()) {
      const patterns = readFileSync(path, 'utf-8').split(/\r?\n/)
        .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
      config = { ...config, ignore: [...new Set([...(config.ignore || []), ...patterns])] };
    } else { cacheable = false; }
  } catch (err) { if (err.code !== 'ENOENT') cacheable = false; }
  const key = cacheable ? _cacheKey(projectDir, config) : null;
  const treeHash = key ? _treeStateHash(projectDir, config) : null;
  if (treeHash) {
    const cached = _memoryPlanCache.get(key);
    if (cached?.treeHash === treeHash) return cached.plan;
    _memoryPlanCache.delete(key);
    if (config.diskCache !== false) {
      const onDisk = _readDiskCache(projectDir, key, treeHash);
      if (onDisk) {
        _rememberPlan(key, treeHash, onDisk);
        return onDisk;
      }
    }
  } else if (key) { _memoryPlanCache.delete(key); }

  const result = _buildMemoryPlanUncached(projectDir, config);
  // Scanners perform several walks. Do not stamp a mixed-state result with a
  // later tree's identity if an editor changed inputs during the build.
  if (treeHash && _treeStateHash(projectDir, config) === treeHash) {
    _rememberPlan(key, treeHash, result);
    if (config.diskCache !== false) _writeDiskCache(projectDir, key, treeHash, result);
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
  const schemas = scanSchemasDeep(projectDir, { framework: primaryFramework }, docTools, config);
  const entities = schemas.entities || [];
  const isWebFrontend = profile.ecosystems.some(e => e.kind === 'webapp');
  const fe = isWebFrontend
    ? scanFrontend(projectDir, config)
    : { screens: [], components: [], stores: [], hooks: [], contexts: [], apiCalls: [],
        i18n: { usedKeys: [], locales: [], missing: [] },
        framework: null, stateLib: null, dataLib: null };
  const envVars = [...grepEnvUsage(projectDir, config)].sort();
  const integrations = detectIntegrations(projectDir, config);
  // Pre-filled code-truth (field report §5): real source modules + test inventory.
  const modules = scanComponents(projectDir, config);
  const tests = scanTestInventory(projectDir, config);

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
    modules,   // top-level source modules → ARCHITECTURE Component Map (pre-filled)
    tests,     // { files:[{file,cases}], totalCases, totalFiles } → TEST-SPEC inventory
  };

  // ── Profile gate (Bug #5) ──
  // generate must respect the active COMPLIANCE profile, not just surface
  // counts. For non-web profiles (cli/library) we only emit an optional
  // web/UI/DB-shaped canonical doc when the profile explicitly requires it — so
  // a CLI never gets API-REFERENCE/INTEGRATIONS just because the surface scan
  // tripped on a stray HTTP call or SDK string. Other profiles
  // (standard/enterprise/…) stay surface-driven.
  const profileName = config.profile || 'standard';
  const allowedCanonical = new Set(PROFILES[profileName]?.requiredFiles?.canonical || []);
  const constrainedProfile = profileName === 'cli' || profileName === 'library';
  const profileAllows = (docPath) => !constrainedProfile || allowedCanonical.has(docPath);

  // Anti-false-green: when the profile suppresses a doc the surface WOULD have
  // produced, say so — a web app mislabeled with the wrong --profile is still
  // recoverable instead of silently under-documented.
  const notes = [];
  if (constrainedProfile) {
    if (surface.endpoints.length > 0 && !allowedCanonical.has('docs-canonical/API-REFERENCE.md')) {
      notes.push(`Detected ${surface.endpoints.length} endpoint(s) but the '${profileName}' profile omits API-REFERENCE.md — not generated. If this project genuinely exposes an HTTP API, re-run with --profile standard.`);
    }
    if (surface.integrations.length > 0 && !allowedCanonical.has('docs-canonical/INTEGRATIONS.md')) {
      notes.push(`Detected ${surface.integrations.length} integration(s) but the '${profileName}' profile omits INTEGRATIONS.md — not generated.`);
    }
  }

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

    // Component Map — PRE-FILLED from the real source layout (field report §5):
    // the agent gets the module list for free and only annotates responsibilities.
    if (surface.modules.length > 0) {
      sections.push({
        id: 'component-map',
        source: 'code',
        body: md.table(['Module', 'Kind', 'Responsibility'],
          surface.modules.map(m => [`\`${m.path}\``, m.kind, '<!-- one-line responsibility -->'])),
      });
      sections.push(addTask('docs-canonical/ARCHITECTURE.md', 'components',
        'Fill in a one-line responsibility for each module in the Component Map above (replace each `<!-- one-line responsibility -->`). Group related modules into layers if it aids understanding.',
        { modules: surface.modules.map(m => m.path) }));
    } else {
      sections.push(addTask('docs-canonical/ARCHITECTURE.md', 'components',
        'Describe the major components/modules and their responsibilities, using the real directories below.',
        { ecosystems: profile.ecosystems.map(e => ({ dir: e.dir, language: e.language, framework: e.framework })) }));
    }

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

  // TEST-SPEC — always (a required canonical doc in every profile). The test
  // INVENTORY is pre-filled from the real test files (field report §5); the
  // agent writes only the coverage rules + the service→test mapping.
  {
    const ti = surface.tests;
    const sections = [];
    if (ti.totalFiles > 0) {
      const header = `**${ti.totalFiles} test file(s)${ti.totalCases > 0 ? `, ${ti.totalCases} test case(s)` : ''}**`;
      const rows = ti.files.map(t => [`\`${t.file}\``, t.cases > 0 ? String(t.cases) : '—']);
      sections.push({
        id: 'test-inventory',
        source: 'code',
        body: `${header}\n\n${md.table(['Test file', 'Cases'], rows)}`,
      });
    }
    sections.push(addTask('docs-canonical/TEST-SPEC.md', 'coverage',
      ti.totalFiles > 0
        ? 'Document the test categories (unit / integration / e2e), the coverage rules, and the service→test mapping. The detected test files + case counts are listed above.'
        : 'No test files were detected. Document the intended test strategy: categories, coverage targets, and where tests will live.',
      { totalFiles: ti.totalFiles, totalCases: ti.totalCases }));
    docs.push({ path: 'docs-canonical/TEST-SPEC.md', sections });
  }

  // API-REFERENCE — only if there's an API surface AND the profile allows it.
  if (surface.endpoints.length > 0 && profileAllows('docs-canonical/API-REFERENCE.md')) {
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

  // DATA-MODEL — only if entities detected AND the profile allows it.
  if (surface.entities.length > 0 && profileAllows('docs-canonical/DATA-MODEL.md')) {
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

  // SCREENS — only for web frontends with screens AND if the profile allows it.
  if (surface.screens.length > 0 && profileAllows('docs-canonical/SCREENS.md')) {
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

  // INTEGRATIONS — external services / SDKs detected from deps (profile-gated).
  if (surface.integrations.length > 0 && profileAllows('docs-canonical/INTEGRATIONS.md')) {
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

  // FEATURES — derived from screens + endpoints when there's a UI surface (profile-gated).
  if (surface.screens.length > 0 && profileAllows('docs-canonical/FEATURES.md')) {
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

  for (const doc of docs) doc.path = remapDocPath(config, doc.path);
  for (const task of agentTasks) task.doc = remapDocPath(config, task.doc);
  return { profile, surface, docs, agentTasks, notes };
}
