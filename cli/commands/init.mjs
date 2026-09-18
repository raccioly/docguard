import { assertDefaultDocWrites } from '../shared-doc-roles.mjs';
/**
 * Init Command — Initialize CDD documentation from templates
 *
 * Extension-First: When `specify` CLI is available, DocGuard delegates
 * LLM/IDE detection and spec-kit skill installation to spec-kit.
 * DocGuard then layers CDD-specific docs on top.
 *
 * Fallback: When `specify` is not available, DocGuard runs standalone
 * with a warning suggesting spec-kit installation.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { listCanonicalDocs } from '../shared-ignore.mjs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { execSync } from 'node:child_process';
import { c, PROFILES, CURRENT_SCHEMA_VERSION } from '../shared.mjs';
import { detectCanonicalLayout, applyDocRoles } from '../shared-doc-roles.mjs';
import { ensureSkills, detectAgentMode, detectAIAgent, isSpecKitAvailable, isSpecKitInitialized, getDetectedAgent, safeSpawnSpecify } from '../ensure-skills.mjs';
import { safeWrite } from '../writers/generate-io.mjs';

// v0.20: scaffolder names that can be passed via `init --with <name>` and
// dispatched to their writers. CI scaffolding is distinct from the standalone
// `ci` validation gate; it copies the maintained workflow starter.
const SCAFFOLDER_DISPATCH = {
  agents:  async (dir, cfg, flags) => (await import('./agents.mjs')).runAgents(dir, cfg, flags),
  hooks:   async (dir, cfg, flags) => (await import('./hooks.mjs')).runHooks(dir, cfg, flags),
  ci:      (dir, cfg, flags) => scaffoldCI(dir, flags),
  badge:   async (dir, cfg, flags) => (await import('./badge.mjs')).runBadge(dir, cfg, flags),
  llms:    async (dir, cfg, flags) => (await import('./llms.mjs')).runLlms(dir, cfg, flags),
  publish: async (dir, cfg, flags) => (await import('./publish.mjs')).runPublish(dir, cfg, flags),
};

/**
 * Run one or more scaffolders after init has completed.
 * Called when `docguard init --with agents,hooks,ci` is invoked.
 * Each scaffolder runs in sequence; if one throws, the rest are skipped
 * (matches the standalone command's failure semantics).
 */
async function runScaffolders(projectDir, config, flags, names) {
  const unknown = names.filter(n => !SCAFFOLDER_DISPATCH[n]);
  if (unknown.length > 0) {
    console.error(`${c.red}Unknown --with target(s): ${unknown.join(', ')}${c.reset}`);
    console.log(`${c.dim}Valid: ${Object.keys(SCAFFOLDER_DISPATCH).join(', ')}${c.reset}`);
    process.exit(1);
  }

  console.log(`\n${c.bold}🧰 Scaffolders:${c.reset} ${c.cyan}${names.join(', ')}${c.reset}\n`);

  for (const name of names) {
    console.log(`${c.dim}── ${name} ───────────────────────────────────────${c.reset}`);
    try {
      await SCAFFOLDER_DISPATCH[name](projectDir, config, flags);
    } catch (err) {
      console.error(`${c.red}✗ ${name} failed: ${err.message}${c.reset}`);
      process.exit(1);
    }
  }
}

function detectProjectType(dir) {
  const pkgPath = resolve(dir, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (pkg.bin) return 'cli';
      if (allDeps.next || allDeps.react || allDeps.vue || allDeps['@angular/core'] ||
          allDeps.svelte || allDeps.nuxt) return 'webapp';
      if (allDeps.express || allDeps.fastify || allDeps.hono || allDeps.koa) return 'api';
      if (pkg.main || pkg.exports || pkg.module) return 'library';
    } catch { /* fall through */ }
  }
  if (existsSync(resolve(dir, 'manage.py'))) return 'webapp';
  if (existsSync(resolve(dir, 'setup.py')) || existsSync(resolve(dir, 'pyproject.toml'))) return 'library';
  return 'unknown';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEMPLATES_DIR = resolve(__dirname, '../../templates');

function scaffoldCI(projectDir, flags) {
  // Resolve the user's root once (e.g. macOS /tmp), then refuse symlinks in
  // every destination component, including the backup safeWrite will use.
  const root = realpathSync(projectDir);
  const target = resolve(root, '.github/workflows/docguard.yml');
  let existing;
  for (const [path, directory] of [
    [resolve(root, '.github'), true],
    [dirname(target), true],
    [target, false],
    [target + '.bak', false],
  ]) {
    let stat;
    try { stat = lstatSync(path); } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Unsafe CI scaffold path: ${path} (expected a real ${directory ? 'directory' : 'file'}, not a symlink)`);
    }
    if (!directory && stat.nlink > 1) throw new Error(`Unsafe CI scaffold path: ${path} (hard-linked file)`);
    if (path === target) existing = stat;
  }
  if (existing && !flags.force) {
    console.log(`  ${c.dim}⏭️  .github/workflows/docguard.yml exists; use --force to overwrite${c.reset}`);
    return;
  }
  // Copy literally: the starter's fixed package pin is release-tested, and
  // GitHub expressions must not go through canonical-doc interpolation.
  const content = readFileSync(resolve(TEMPLATES_DIR, 'ci/github-actions.yml'), 'utf-8');
  // safeWrite's generic backup is best-effort and skips empty files. Here a
  // forced replacement requires a successful backup, including empty files.
  if (existing) copyFileSync(target, target + '.bak');
  safeWrite(target, content);
  console.log(`  ${c.green}✅ .github/workflows/docguard.yml ${existing ? 'replaced (backup: docguard.yml.bak)' : 'created'}${c.reset}`);
}

/**
 * v0.28 (field report #11): inject a `<!-- docguard:last-reviewed DATE -->`
 * marker right after the first H1, so a canonical doc has a freshness signal the
 * Freshness validator reads directly (not git mtime). No-op if one is present.
 */
function stampLastReviewed(content, date) {
  const marker = `<!-- docguard:last-reviewed ${date} -->`;
  const lines = content.split('\n');
  const h1 = lines.findIndex(l => /^#\s/.test(l));
  if (h1 === -1) return `${marker}\n\n${content}`;
  lines.splice(h1 + 1, 0, '', marker);
  return lines.join('\n');
}

// ── Readline helper ──────────────────────────────────────────────────────

function askQuestion(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => {
    rl.question(prompt, answer => {
      rl.close();
      res(answer);
    });
  });
}

/**
 * Confirm where a project actually keeps its canonical documents.
 *
 * Runs before init creates anything. If the role filenames already exist
 * somewhere other than the directory the config points at, say so and offer to
 * adopt that location, instead of reporting "no canonical docs" and scaffolding
 * a second copy next to the real one.
 *
 * Writes `docs.roles` (the mechanism every validator already resolves through)
 * plus a matching `requiredFiles.canonical`. Declaring only the latter leaves
 * the content validators walking the conventional directory, where they find
 * nothing and report "no matches" — checks disappear without anyone saying so.
 *
 * @returns {Promise<Record<string,string>|null>} adopted roles, or null
 */
async function confirmCanonicalLocation(projectDir, flags) {
  const configPath = resolve(projectDir, '.docguard.json');
  let existing = {};
  if (existsSync(configPath)) {
    try { existing = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { return false; }
  }
  // An explicit mapping is the user's answer already; do not second-guess it.
  if (existing.docs?.roles) return null;

  const hits = detectCanonicalLayout(projectDir).filter(h => h.count >= 2);
  if (hits.length === 0) return null;
  const best = hits[0];
  if (best.dir === 'docs-canonical') return null; // already conventional

  console.log(`\n${c.bold}📁 Found existing canonical documents${c.reset}`);
  console.log(`${c.dim}   DocGuard defaults to docs-canonical/, but ${Object.keys(best.roles).length} of its documents${c.reset}`);
  console.log(`${c.dim}   already live in ${c.reset}${c.cyan}${best.dir}/${c.reset}${c.dim}:${c.reset}`);
  for (const [role, path] of Object.entries(best.roles)) {
    console.log(`     ${c.green}•${c.reset} ${path} ${c.dim}(${role})${c.reset}`);
  }

  if (!flags.skipPrompts && !flags.force) {
    const answer = (await askQuestion(`\n   Use ${best.dir}/ as the canonical location? [Y/n] `)).trim().toLowerCase();
    if (answer === 'n' || answer === 'no') {
      console.log(`${c.dim}   Keeping docs-canonical/. Map them later with docs.roles in .docguard.json.${c.reset}\n`);
      return null;
    }
  } else {
    // Non-interactive: adopting what is on disk is the safe default, because
    // the alternative is scaffolding a duplicate the user never asked for.
    console.log(`${c.dim}   Adopting ${best.dir}/ (non-interactive).${c.reset}`);
  }

  const next = { ...existing };
  next.docs = { ...(next.docs || {}), roles: { ...best.roles } };
  next.requiredFiles = {
    ...(next.requiredFiles || {}),
    canonical: Object.values(best.roles).sort(),
  };
  writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n');
  console.log(`  ${c.green}✅${c.reset} .docguard.json now points at ${c.cyan}${best.dir}/${c.reset}\n`);
  return best.roles;
}

// ── Init Command ─────────────────────────────────────────────────────────


/**
 * v0.21 — Smart first-run detection.
 *
 * Heuristic: if the user is running `docguard init` against a project that
 * already has substantial source code (cli/, src/, lib/, app/, or 10+ source
 * files at depth 1-2) AND has no docs-canonical/ yet, switch from the
 * skeleton-first path to the "scan and propose" path — i.e. dispatch to
 * `docguard generate --plan` which reverse-engineers canonical docs from
 * existing code.
 *
 * Rationale: blank skeletons feel useless for existing projects (the dev
 * has to write everything from scratch). The scan path delivers immediate
 * value: "here's what your project actually does, mapped to canonical doc
 * shape." That's a 30-second wow for the 80% of adopters who arrive with
 * an existing codebase.
 *
 * Opt out: `docguard init --skeleton` forces the blank-template path
 * (preserves the v0.20 behavior for greenfield projects and CI flows).
 *
 * @returns {boolean} true if smart-detection fired and dispatched
 */
function shouldRunGenerate(projectDir, flags) {
  if (flags.skeleton)        return false; // explicit opt-out
  if (flags.skipPrompts)     return false; // non-interactive (CI) keeps deterministic skeleton path
  if (flags.wizard)          return false; // wizard has its own scan step
  if (flags.profile)         return false; // explicit profile = user knows what they want
  if (flags.fix)             return false; // --fix = deterministic create-missing-from-templates (headless)

  // If canonical docs already exist, this is a re-init, not a first-run.
  // Recursive — a project whose only canonical docs are nested must still be
  // detected as already-initialized, or the wizard re-triggers on every run.
  if (listCanonicalDocs(projectDir).length > 0) return false;

  // listCanonicalDocs only walks the directories the config points at, so a
  // project keeping the same documents somewhere else (docs/canonical/) read as
  // EMPTY. Init then offered to reverse-engineer docs from code and would
  // scaffold a second canonical directory beside the real one. Look for the
  // role filenames anywhere before concluding a project has no documentation.
  if (detectCanonicalLayout(projectDir).some(hit => hit.count >= 2)) return false;

  // Existing-code signals: any of cli/, src/, lib/, app/ as a directory.
  const codeDirs = ['cli', 'src', 'lib', 'app'];
  for (const d of codeDirs) {
    if (existsSync(resolve(projectDir, d))) return true;
  }

  // Fallback: count source files at top level (Python / Rust / Go projects
  // often don't use src/ — files live at the root).
  try {
    const exts = ['.py', '.rs', '.go', '.java', '.rb', '.ts', '.tsx', '.mjs', '.js'];
    const topLevel = readdirSync(projectDir).filter(f => {
      return exts.some(e => f.endsWith(e));
    });
    if (topLevel.length >= 10) return true;
  } catch { /* fall through */ }

  return false;
}

export async function runInit(projectDir, configArg, flags) {
  let config = configArg;
  // `--list` is read-only inventory owned by the hooks scaffolder. Routing it
  // through normal init can start prompts or create documentation before the
  // requested inventory is shown, which violates the command's read-only intent.
  if (flags.list && Array.isArray(flags.with)) {
    if (flags.with.length !== 1 || flags.with[0] !== 'hooks') {
      console.error(`${c.red}--list is supported only with \`docguard init --with hooks\`.${c.reset}`);
      process.exitCode = 1;
      return;
    }
    const { runHooks } = await import('./hooks.mjs');
    return runHooks(projectDir, config, flags);
  }
  // Ask where the documents live before creating any. The adopted mapping has
  // to reach the in-memory config as well: the skeleton path below reads it,
  // and would otherwise create a second canonical directory it was just told
  // not to use.
  const adoptedRoles = await confirmCanonicalLocation(projectDir, flags);
  if (adoptedRoles) {
    config.docs = { ...(config.docs || {}), roles: { ...adoptedRoles } };
    config.requiredFiles = {
      ...(config.requiredFiles || {}),
      canonical: Object.values(adoptedRoles).sort(),
    };
    config = applyDocRoles(projectDir, config);
  }
  if (true) assertDefaultDocWrites(config);
  // v0.20: `--wizard` dispatches to the full interactive onboarding (formerly
  // `docguard setup`). Done before profile validation so the wizard can ask
  // for the profile itself if needed.
  if (flags.wizard) {
    const { runSetup } = await import('./setup.mjs');
    return runSetup(projectDir, config, flags);
  }

  // v0.21: smart first-run — for existing projects without canonical docs,
  // dispatch to `generate --plan` (the "scan and propose" path). Opt out
  // with --skeleton or by setting --profile/--skip-prompts/--wizard explicitly.
  if (shouldRunGenerate(projectDir, flags)) {
    console.log(`${c.bold}🔍 DocGuard Init — Smart Mode${c.reset}`);
    console.log(`${c.dim}   Detected existing project with code but no canonical docs.${c.reset}`);
    console.log(`${c.dim}   Switching to "scan and propose" mode — DocGuard will reverse-engineer${c.reset}`);
    console.log(`${c.dim}   canonical docs from your code instead of dumping a blank skeleton.${c.reset}`);
    console.log(`${c.dim}   (Opt out: ${c.cyan}docguard init --skeleton${c.dim} for the blank-template path.)${c.reset}\n`);
    const { runGenerate } = await import('./generate.mjs');
    const result = await runGenerate(projectDir, config, { ...flags, plan: true });
    // Smart init still honors explicit workflow/scaffolder requests after the
    // plan, with the same ordering and stop-on-failure semantics as skeletons.
    if (Array.isArray(flags.with) && flags.with.length > 0) {
      await runScaffolders(projectDir, config, flags, flags.with);
    }
    return result;
  }

  const profileName = flags.profile || 'standard';
  const profile = PROFILES[profileName];

  if (!profile) {
    console.error(`${c.red}Unknown profile: ${profileName}${c.reset}`);
    console.log(`Available profiles: ${Object.keys(PROFILES).join(', ')}`);
    process.exit(1);
  }

  console.log(`${c.bold}🏗️  DocGuard Init — ${config.projectName}${c.reset}`);
  console.log(`${c.dim}   Directory: ${projectDir}${c.reset}`);
  console.log(`${c.dim}   Profile:   ${profileName} — ${profile.description}${c.reset}\n`);

  // Detect project type
  const detectedType = detectProjectType(projectDir);
  console.log(`  ${c.dim}Auto-detected project type: ${c.cyan}${detectedType}${c.reset}\n`);

  // ── Doc catalog ────────────────────────────────────────────────────────
  const allDocs = [
    { key: 'ARCHITECTURE', file: 'docs-canonical/ARCHITECTURE.md', template: 'ARCHITECTURE.md.template', desc: 'System architecture, tech stack, layer boundaries', defaultYes: true },
    { key: 'DATA-MODEL', file: 'docs-canonical/DATA-MODEL.md', template: 'DATA-MODEL.md.template', desc: 'Database schemas, entities, relationships', defaultYes: ['webapp', 'api'].includes(detectedType) },
    { key: 'SECURITY', file: 'docs-canonical/SECURITY.md', template: 'SECURITY.md.template', desc: 'Auth, secrets, security controls', defaultYes: ['webapp', 'api'].includes(detectedType) },
    { key: 'TEST-SPEC', file: 'docs-canonical/TEST-SPEC.md', template: 'TEST-SPEC.md.template', desc: 'Test strategy, coverage requirements', defaultYes: true },
    { key: 'ENVIRONMENT', file: 'docs-canonical/ENVIRONMENT.md', template: 'ENVIRONMENT.md.template', desc: 'Environment variables, deployment config', defaultYes: ['webapp', 'api'].includes(detectedType) },
    { key: 'REQUIREMENTS', file: 'docs-canonical/REQUIREMENTS.md', template: 'REQUIREMENTS.md.template', desc: 'Functional requirements, user stories (spec-kit aligned)', defaultYes: true },
  ];

  let selectedDocs;

  if (flags.skipPrompts || flags.force || flags.fix) {
    // Non-interactive — use profile defaults. `--fix` lands here too: its
    // documented contract is "auto-create missing files from templates", so it
    // must never block on prompts (CI / headless / agent use). The create-loop
    // below already skips existing files, so --fix only fills gaps.
    const profileCanonical = profile.requiredFiles?.canonical || allDocs.map(d => d.file);
    selectedDocs = allDocs.filter(d => profileCanonical.includes(d.file));
    console.log(`  ${c.dim}Non-interactive mode — using ${profileName} profile defaults${c.reset}\n`);
  } else {
    // Interactive — ask about each doc
    console.log(`  ${c.bold}Which canonical docs does your project need?${c.reset}`);
    console.log(`  ${c.dim}(press Enter for default, type y or n)${c.reset}\n`);

    selectedDocs = [];
    for (const doc of allDocs) {
      const defaultLabel = doc.defaultYes ? 'Y/n' : 'y/N';
      const answer = await askQuestion(`    ${doc.key} — ${doc.desc} [${defaultLabel}]: `);
      const trimmed = answer.trim().toLowerCase();

      const include = doc.defaultYes
        ? (trimmed === '' || trimmed === 'y' || trimmed === 'yes')
        : (trimmed === 'y' || trimmed === 'yes');

      if (include) {
        selectedDocs.push(doc);
      }
    }
    console.log('');
  }

  // ── Create selected doc files ──────────────────────────────────────────
  const created = [];
  const skipped = [];

  // Always create tracking files
  const alwaysCreate = [
    { template: 'AGENTS.md.template', dest: 'AGENTS.md' },
    { template: 'CHANGELOG.md.template', dest: 'CHANGELOG.md' },
    { template: 'DRIFT-LOG.md.template', dest: 'DRIFT-LOG.md' },
  ];

  const fileMappings = [
    ...selectedDocs.map(d => ({ template: d.template, dest: d.file })),
    ...alwaysCreate,
  ];

  for (const mapping of fileMappings) {
    const destPath = resolve(projectDir, mapping.dest);
    const templatePath = resolve(TEMPLATES_DIR, mapping.template);

    if (existsSync(destPath)) {
      skipped.push(mapping.dest);
      console.log(`  ${c.yellow}⏭️${c.reset}  ${mapping.dest} ${c.dim}(already exists)${c.reset}`);
      continue;
    }

    const destDir = dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    if (existsSync(templatePath)) {
      const content = readFileSync(templatePath, 'utf-8');
      const today = new Date().toISOString().split('T')[0];
      let processed = content.replace(/YYYY-MM-DD/g, today);
      // v0.28 (field report #11): every canonical doc must ship with a freshness
      // marker so the Freshness validator is marker-based (consistent across docs,
      // and satisfiable in a pre-commit review loop) rather than silently falling
      // back to git mtime. Templates now all carry one; this is the belt-and-
      // suspenders guarantee for any future template that forgets.
      if (mapping.dest.startsWith('docs-canonical/') && !/docguard:last-reviewed/.test(processed)) {
        processed = stampLastReviewed(processed, today);
      }
      writeFileSync(destPath, processed, 'utf-8');
      created.push(mapping.dest);
      console.log(`  ${c.green}✅${c.reset} Created: ${c.cyan}${mapping.dest}${c.reset}`);
    } else {
      console.log(`  ${c.red}❌${c.reset} Template not found: ${mapping.template}`);
    }
  }

  // ── Create .docguard.json ──────────────────────────────────────────────
  const configPath = resolve(projectDir, '.docguard.json');
  if (!existsSync(configPath)) {
    const typeDefaults = {
      cli:     { needsEnvVars: false, needsEnvExample: false, needsE2E: false, needsDatabase: false },
      library: { needsEnvVars: false, needsEnvExample: false, needsE2E: false, needsDatabase: false },
      webapp:  { needsEnvVars: true,  needsEnvExample: true,  needsE2E: true,  needsDatabase: true },
      api:     { needsEnvVars: true,  needsEnvExample: true,  needsE2E: false, needsDatabase: true },
      unknown: { needsEnvVars: true,  needsEnvExample: true,  needsE2E: false, needsDatabase: true },
    };

    const ptc = typeDefaults[detectedType] || typeDefaults.unknown;

    const defaultConfig = {
      // v0.15-P4: $schema reference enables VS Code / IDE autocomplete +
      // validation for .docguard.json fields. Picked up by any
      // JSON-Schema-aware editor; ignored by DocGuard itself.
      $schema: 'https://raccioly.github.io/docguard/schemas/docguard-config.schema.json',
      projectName: config.projectName,
      version: CURRENT_SCHEMA_VERSION, // single source of truth (shared.mjs) — never hardcode
      profile: profileName,
      projectType: detectedType,
      projectTypeConfig: ptc,
      requiredFiles: {
        canonical: selectedDocs.map(d => d.file),
      },
      validators: profile.validators || {
        structure: true,
        docsSync: true,
        drift: true,
        changelog: true,
        architecture: false,
        testSpec: true,
        security: false,
        environment: true,
        freshness: true,
      },
      // Per-validator severity overrides (v0.5+).
      //   'high':   warnings from this validator fail CI (exit 1)
      //   'medium': default — warnings exit 2 (informational)
      //   'low':    warnings ignored for exit code (exit 0)
      // Empty by default — every validator uses 'medium'. Add entries to dial
      // strictness up (CI-critical checks) or down (experimental validators).
      severity: {},
      // Exact stable-code overrides. Use this when one rule needs a different
      // policy without weakening or escalating every finding in its validator.
      findingSeverity: {},
    };

    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf-8');
    created.push('.docguard.json');
    console.log(`  ${c.green}✅${c.reset} Created: ${c.cyan}.docguard.json${c.reset} ${c.dim}(${selectedDocs.length} docs selected, type: ${detectedType})${c.reset}`);
  } else {
    skipped.push('.docguard.json');
    console.log(`  ${c.yellow}⏭️${c.reset}  .docguard.json ${c.dim}(already exists)${c.reset}`);
  }

  // ── Create .docguardignore ────────────────────────────────────────────
  // Starter ignore file with gitignore-style syntax. Patterns here are merged
  // into config.ignore at load time so every validator honors them.
  const ignorePath = resolve(projectDir, '.docguardignore');
  if (!existsSync(ignorePath)) {
    const ignoreContent = `# .docguardignore — paths to exclude from DocGuard validation.
# Gitignore-style syntax: one pattern per line, # for comments.
# Merged into config.ignore (in .docguard.json) at runtime.
#
# Common examples:
#   build/                   # exclude a directory
#   **/__generated__/**      # exclude anything in any __generated__ dir
#   vendor/legacy.ts         # exclude a single file
#   **/*.snap                # exclude all files matching a glob
#
# Build outputs, vendored libs, generated code are good candidates here.

# Vendored / generated code that's not yours to document
**/__generated__/**
**/generated/**
**/*.generated.*

# Migrations and lock files
**/migrations/**
**/*.lock
package-lock.json
yarn.lock
pnpm-lock.yaml
Cargo.lock
poetry.lock

# Common build artifacts (defaults also cover these, but listing here is clearer)
# dist/
# build/
# coverage/
`;
    writeFileSync(ignorePath, ignoreContent, 'utf-8');
    created.push('.docguardignore');
    console.log(`  ${c.green}✅${c.reset} Created: ${c.cyan}.docguardignore${c.reset} ${c.dim}(gitignore-style exclusions)${c.reset}`);
  } else {
    skipped.push('.docguardignore');
    console.log(`  ${c.yellow}⏭️${c.reset}  .docguardignore ${c.dim}(already exists)${c.reset}`);
  }

  // ── Spec-Kit Integration (Extension-First) ────────────────────────────
  // Delegate LLM/IDE detection and spec-kit skill install to `specify init`
  // v0.16-P8: --no-spec-kit lets users skip the .specify/.agent/commands
  // scaffolding (minimalist library projects, CI containers, etc.).
  const specKitAvailable = isSpecKitAvailable();
  const specKitInitialized = isSpecKitInitialized(projectDir);

  // v0.24 (field report #1): the `starter` profile is "minimal, for side
  // projects" — it skips the heavy Spec Kit framework scaffold (.specify/
  // templates/scripts/memory, ~30 files) by default. DocGuard's own canonical
  // docs and its lightweight agent skills/commands still install (ensureSkills
  // below). Opt back in with --spec-kit. Other profiles are unaffected.
  const starterSkipsSpecKit = profileName === 'starter' && !flags.specKit;

  if (flags.noSpecKit || starterSkipsSpecKit) {
    const why = flags.noSpecKit
      ? '--no-spec-kit'
      : 'starter profile is minimal — pass --spec-kit to include the framework scaffold';
    console.log(`\n  ${c.dim}⏭️  Spec Kit framework scaffold skipped (${why}).${c.reset}`);
  } else if (specKitAvailable && !specKitInitialized) {
    console.log(`\n  ${c.bold}🌱 Spec Kit Integration${c.reset}`);

    // Detect which AI agent is in use (matches spec-kit's --ai flag).
    // v0.21.1 (issue #190): the returned value is allowlist-validated inside
    // getDetectedAgent, so an attacker-controlled `.specify/init-options.json`
    // can no longer inject shell metacharacters here.
    const detectedAgent = detectAIAgent(projectDir);
    const aiArgs = detectedAgent
      ? ['--ai', detectedAgent]
      : ['--ai', 'generic', '--ai-commands-dir', '.agent/commands/'];

    console.log(`  ${c.dim}Running specify init (agent: ${detectedAgent || 'generic'})...${c.reset}`);
    try {
      // v0.21.1 (issue #190): execFileSync via safeSpawnSpecify — args pass
      // through as an array, no shell interpolation.
      const scriptArgs = process.platform === 'win32' ? ['--script', 'ps'] : ['--script', 'sh'];
      safeSpawnSpecify(
        ['init', '--here', '--force', ...aiArgs, '--ai-skills', '--ignore-agent-tools', '--no-git', ...scriptArgs],
        { cwd: projectDir, encoding: 'utf-8', stdio: 'pipe', timeout: 30000 }
      );
      console.log(`  ${c.green}✅${c.reset} Spec Kit initialized ${c.dim}(.specify/, spec-kit skills, agent: ${detectedAgent || 'generic'})${c.reset}`);
      created.push('.specify/ (spec-kit foundation)');
    } catch (err) {
      console.log(`  ${c.yellow}⚠️${c.reset}  Spec Kit init had issues ${c.dim}(continuing with DocGuard standalone)${c.reset}`);
      if (flags.debug) console.log(`     ${c.dim}${err.message}${c.reset}`);
    }
  } else if (specKitInitialized) {
    const agent = getDetectedAgent(projectDir);
    console.log(`\n  ${c.green}✅${c.reset} Spec Kit already initialized${agent ? ` ${c.dim}(agent: ${agent})${c.reset}` : ''}`);
  } else {
    console.log(`\n  ${c.red}┌─────────────────────────────────────────────────────────────┐${c.reset}`);
    console.log(`  ${c.red}│${c.reset}  ${c.bold}⚠️  Spec Kit not installed — running in standalone mode${c.reset}     ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}                                                              ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}  DocGuard is designed as a Spec Kit extension.               ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}  Without Spec Kit, you get ${c.bold}4 skills${c.reset}. With it: ${c.bold}13 skills${c.reset}.    ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}                                                              ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}  ${c.bold}What you're missing:${c.reset}                                       ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}   • 9 Spec Kit AI skills (specify, plan, tasks, implement)  ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}   • Project constitution (${c.cyan}constitution.md${c.reset})                 ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}   • Full SDD + CDD integrated workflow                     ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}   • AI agent auto-detection and config                     ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}                                                              ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}  ${c.bold}Install with:${c.reset}                                              ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}  ${c.cyan}uv tool install specify-cli \\${c.reset}                              ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}  ${c.cyan}  --from git+https://github.com/github/spec-kit.git${c.reset}       ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}                                                              ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}  ${c.dim}Alternative: ${c.cyan}pip install specify-cli${c.reset}                       ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}                                                              ${c.red}│${c.reset}`);
    console.log(`  ${c.red}│${c.reset}  ${c.dim}Then re-run: ${c.cyan}docguard init${c.reset}                                 ${c.red}│${c.reset}`);
    console.log(`  ${c.red}└─────────────────────────────────────────────────────────────┘${c.reset}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n${c.bold}  ─────────────────────────────────────${c.reset}`);
  console.log(`  ${c.green}Created:${c.reset} ${created.length} files`);
  if (skipped.length > 0) {
    console.log(`  ${c.yellow}Skipped:${c.reset} ${skipped.length} files (already exist)`);
  }

  // ── Hooks suggestion ──────────────────────────────────────────────────
  console.log(`\n  ${c.bold}💡 Automation:${c.reset}`);
  console.log(`  ${c.dim}Auto-guard on commit:${c.reset}  ${c.cyan}docguard hooks --type pre-commit${c.reset}`);
  console.log(`  ${c.dim}Auto-guard on push:${c.reset}   ${c.cyan}docguard hooks --type pre-push${c.reset}`);

  // ── Next Steps (LLM-First) ─────────────────────────────────────────────
  const agentMode = detectAgentMode(projectDir);
  const createdDocs = created.filter(f => f.startsWith('docs-canonical/'));

  if (createdDocs.length > 0) {
    console.log(`\n  ${c.bold}🤖 Next Steps${c.reset} ${c.dim}(${agentMode === 'llm' ? 'LLM mode' : 'CLI mode'})${c.reset}`);
    console.log(`  ${c.dim}The files above are skeleton templates. Your AI agent should fill them.${c.reset}`);

    if (agentMode === 'llm') {
      // LLM-first: show skill commands
      console.log(`\n  ${c.bold}Use these skills in your AI agent:${c.reset}`);
      if (isSpecKitInitialized(projectDir)) {
        console.log(`  ${c.cyan}1. /speckit.constitution${c.reset} ${c.dim}← establish project principles${c.reset}`);
      }
      console.log(`  ${c.cyan}${isSpecKitInitialized(projectDir) ? '2' : '1'}. /docguard.guard${c.reset}    ${c.dim}← validate documentation${c.reset}`);

      const docNameMap = {
        'docs-canonical/ARCHITECTURE.md': 'architecture',
        'docs-canonical/DATA-MODEL.md': 'data-model',
        'docs-canonical/SECURITY.md': 'security',
        'docs-canonical/TEST-SPEC.md': 'test-spec',
        'docs-canonical/ENVIRONMENT.md': 'environment',
      };

      const fixTargets = createdDocs.map(d => docNameMap[d]).filter(Boolean);
      if (fixTargets.length > 0) {
        console.log(`\n  ${c.dim}Fix individual docs with the docguard-fix skill:${c.reset}`);
        for (const target of fixTargets) {
          console.log(`  ${c.cyan}/docguard.fix --doc ${target}${c.reset}`);
        }
      }
      console.log(`\n  ${c.dim}Then verify:${c.reset} ${c.cyan}/docguard.guard${c.reset}`);
    } else {
      // CLI fallback
      console.log(`\n  ${c.dim}Get a full remediation plan:${c.reset}`);
      console.log(`  ${c.cyan}${c.bold}docguard diagnose${c.reset}\n`);
      console.log(`  ${c.dim}Then verify:${c.reset} ${c.cyan}docguard guard${c.reset}`);
    }
    console.log('');
  } else {
    if (agentMode === 'llm') {
      console.log(`\n  ${c.dim}Use${c.reset} ${c.cyan}/docguard.guard${c.reset} ${c.dim}in your AI agent to check for issues.${c.reset}\n`);
    } else {
      console.log(`\n  ${c.dim}Run${c.reset} ${c.cyan}docguard diagnose${c.reset} ${c.dim}to check for issues.${c.reset}\n`);
    }
  }

  // Auto-install DocGuard's own skills and commands. Thread the spec-kit skip
  // decision through so ensureSkills doesn't re-trigger the framework scaffold
  // we just declined for the starter profile (or --no-spec-kit).
  ensureSkills(projectDir, { ...flags, noSpecKit: flags.noSpecKit || starterSkipsSpecKit });

  // v0.20: `docguard init --with agents,hooks,ci,badge,llms,publish` runs
  // the named scaffolders after init has finished. Each one runs in sequence
  // and uses the same flags object (so --force / --skip-prompts propagate).
  if (Array.isArray(flags.with) && flags.with.length > 0) {
    await runScaffolders(projectDir, config, flags, flags.with);
  }
}
