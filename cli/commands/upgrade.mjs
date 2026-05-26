/**
 * `docguard upgrade` — check whether the installed CLI and the project's
 * .docguard.json schema are current, and (with --apply) migrate them.
 *
 * Why this exists:
 *   Users were running stale CLI versions against new project setups, getting
 *   confusing "validator missing" or "field unknown" warnings. A one-shot
 *   `docguard upgrade` lets them see the gap and fix it in seconds.
 *
 * Three modes:
 *   docguard upgrade                — report current vs latest, exit 0
 *   docguard upgrade --check-only   — same report, exit 1 if behind (for CI)
 *   docguard upgrade --apply        — actually run `npm i -g docguard-cli@latest`
 *                                     and migrate .docguard.json if needed
 *
 * Network access (npm registry fetch) is OPTIONAL — if offline, we fall back
 * to "could not check remote version" without erroring.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { c, CURRENT_SCHEMA_VERSION, compareVersions } from '../shared.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf-8'));
const INSTALLED_VERSION = PKG.version;

/**
 * Fetch the latest published version from the npm registry. Uses node's
 * built-in fetch (Node 18+). Returns null on timeout/error/offline.
 *
 * 3-second timeout — we never want this command to feel slow.
 */
async function fetchLatestNpmVersion() {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 3000);
  try {
    const r = await fetch('https://registry.npmjs.org/docguard-cli/latest', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.version ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Read the project's stored schema version from .docguard.json. Returns:
 *   - null    : file missing OR unparseable (caller shows "init recommended")
 *   - '0.0'   : file exists but no `version` field (pre-0.4 schemas — these
 *               predate the version field and need migration)
 *   - 'x.y'   : the stored version string
 */
function readProjectSchemaVersion(projectDir) {
  const p = resolve(projectDir, '.docguard.json');
  if (!existsSync(p)) return null;
  try {
    const cfg = JSON.parse(readFileSync(p, 'utf-8'));
    // Pre-0.4 schemas (e.g. an enterprise client project's original config from 2024)
    // have no `version` field. Treat as 0.0 so the migration runs end-to-end.
    return cfg.version || '0.0';
  } catch {
    return null;
  }
}

/**
 * Idempotent migration: walk the project config and add any fields introduced
 * since the stored schema version. Returns { changed, newConfig }.
 *
 * Each migration is keyed by the version it migrates TO. Adding a new schema
 * version means adding one entry here.
 */
function migrateSchema(cfg, fromVersion) {
  const migrations = {
    // v0.4 — pre-0.4 schemas (no `version` field, often `project` instead
    // of `projectName`) normalize here. Rename `project` → `projectName`
    // when only the old field is present, stamp the version, no other change.
    '0.4': (c) => {
      const out = { ...c, version: '0.4' };
      if (!out.projectName && out.project) {
        out.projectName = out.project;
        delete out.project;
      }
      return out;
    },
    // v0.5 — K-4 per-validator severity overrides. Migration is purely
    // additive: existing projects get an empty severity map and default
    // (medium) behavior. No behavioral change unless they explicitly opt in.
    '0.5': (c) => ({ ...c, severity: c.severity || {}, version: '0.5' }),
  };
  let current = { ...cfg };
  let changed = false;
  const target = CURRENT_SCHEMA_VERSION;
  // No migrations yet — current schema matches the constant.
  if (compareVersions(fromVersion, target) >= 0) return { changed: false, newConfig: current };
  for (const [ver, fn] of Object.entries(migrations)) {
    if (compareVersions(fromVersion, ver) < 0 && compareVersions(ver, target) <= 0) {
      current = fn(current);
      changed = true;
    }
  }
  if (changed) current.version = target;
  return { changed, newConfig: current };
}

/**
 * Apply a CLI upgrade by running `npm install -g docguard-cli@latest`. We
 * shell out instead of importing npm — npm is not a runtime dependency and
 * we want zero-deps. Returns the spawn result.
 */
function applyCliUpgrade() {
  const r = spawnSync('npm', ['install', '-g', 'docguard-cli@latest'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return r;
}

/**
 * v0.14-P4: open a PR with the schema migration. Used when the team wants
 * a reviewable change instead of an in-place edit. Requires `gh` CLI on
 * PATH. Returns { ok: bool, prUrl?: string, error?: string }.
 */
function openUpgradePR(projectDir, migratedConfig, fromVersion, toVersion) {
  // Pre-flight: gh must be installed
  const which = spawnSync('which', ['gh'], { encoding: 'utf-8' });
  if (which.status !== 0) {
    return { ok: false, error: 'gh CLI not found. Install: https://cli.github.com' };
  }

  const branch = `docguard/upgrade-schema-${toVersion}-${Date.now().toString(36)}`;
  // Branch off current HEAD
  let r = spawnSync('git', ['checkout', '-b', branch], { cwd: projectDir, encoding: 'utf-8' });
  if (r.status !== 0) return { ok: false, error: `git checkout failed: ${r.stderr || r.stdout}` };

  // Write the migrated config
  try {
    writeFileSync(
      resolve(projectDir, '.docguard.json'),
      JSON.stringify(migratedConfig, null, 2) + '\n',
      'utf-8'
    );
  } catch (e) {
    return { ok: false, error: `write .docguard.json failed: ${e.message}` };
  }

  // Commit
  r = spawnSync('git', ['add', '.docguard.json'], { cwd: projectDir, encoding: 'utf-8' });
  if (r.status !== 0) return { ok: false, error: `git add failed: ${r.stderr}` };

  const commitMsg = `chore(docguard): migrate .docguard.json schema ${fromVersion} → ${toVersion}\n\nAutomated migration via \`docguard upgrade --apply --pr\`.`;
  r = spawnSync('git', ['commit', '-m', commitMsg], { cwd: projectDir, encoding: 'utf-8' });
  if (r.status !== 0) return { ok: false, error: `git commit failed: ${r.stderr || r.stdout}` };

  // Push
  r = spawnSync('git', ['push', '-u', 'origin', branch], { cwd: projectDir, encoding: 'utf-8' });
  if (r.status !== 0) return { ok: false, error: `git push failed: ${r.stderr || r.stdout}` };

  // Open PR
  const prBody =
    `Automated schema migration from \`${fromVersion}\` → \`${toVersion}\`.\n\n` +
    `This PR was opened by \`docguard upgrade --apply --pr\`. It updates the\n` +
    `\`.docguard.json\` schema version and any additive fields the new schema\n` +
    `introduces (e.g. \`severity: {}\` for v0.5).\n\n` +
    `Review and merge to keep your team's DocGuard config in sync.\n\n` +
    `> 🤖 Generated by [DocGuard](https://github.com/raccioly/docguard)`;
  r = spawnSync('gh', [
    'pr', 'create',
    '--title', `chore(docguard): migrate schema ${fromVersion} → ${toVersion}`,
    '--body', prBody,
  ], { cwd: projectDir, encoding: 'utf-8' });
  if (r.status !== 0) return { ok: false, error: `gh pr create failed: ${r.stderr || r.stdout}` };

  const prUrl = (r.stdout || '').trim().split('\n').pop();
  return { ok: true, prUrl };
}

export async function runUpgrade(projectDir, _config, flags) {
  const checkOnly = flags.checkOnly || flags['check-only'];
  const apply = flags.apply;

  console.log(`${c.bold}🔧 DocGuard Upgrade${c.reset}`);
  console.log(`${c.dim}   Checking CLI and schema versions...${c.reset}\n`);

  // CLI version check
  const latest = await fetchLatestNpmVersion();
  const cliCmp = latest ? compareVersions(INSTALLED_VERSION, latest) : 0;
  const cliBehind = cliCmp < 0;

  // Schema version check
  const projectSchema = readProjectSchemaVersion(projectDir);
  const schemaCmp = projectSchema ? compareVersions(projectSchema, CURRENT_SCHEMA_VERSION) : 0;
  const schemaBehind = projectSchema !== null && schemaCmp < 0;

  // ── Report ──────────────────────────────────────────────────────────────
  console.log(`  ${c.cyan}CLI${c.reset}    installed: ${c.bold}v${INSTALLED_VERSION}${c.reset}`);
  if (latest) {
    if (cliBehind) {
      console.log(`         latest:    ${c.yellow}v${latest}${c.reset} ${c.yellow}(behind)${c.reset}`);
    } else if (cliCmp > 0) {
      console.log(`         latest:    v${latest} ${c.dim}(you're ahead — dev build)${c.reset}`);
    } else {
      console.log(`         latest:    ${c.green}v${latest}${c.reset} ${c.green}(current)${c.reset}`);
    }
  } else {
    console.log(`         latest:    ${c.dim}could not check (offline?)${c.reset}`);
  }

  console.log();
  // Two distinct null cases vs. '0.0' (pre-0.4):
  //   null    → no .docguard.json at all → run init
  //   '0.0'   → file exists but missing the `version` field → migration eligible
  //   other   → real version string
  const labelForProject = projectSchema === null
    ? `${c.dim}(no .docguard.json found)${c.reset}`
    : projectSchema === '0.0'
      ? `${c.yellow}pre-0.4 (no version field)${c.reset}`
      : `${c.bold}v${projectSchema}${c.reset}`;
  console.log(`  ${c.cyan}Schema${c.reset} project:   ${labelForProject}`);
  if (projectSchema) {
    if (schemaBehind) {
      console.log(`         current:   ${c.yellow}v${CURRENT_SCHEMA_VERSION}${c.reset} ${c.yellow}(behind)${c.reset}`);
    } else if (schemaCmp > 0) {
      console.log(`         current:   v${CURRENT_SCHEMA_VERSION} ${c.dim}(project is ahead — newer CLI needed)${c.reset}`);
    } else {
      console.log(`         current:   ${c.green}v${CURRENT_SCHEMA_VERSION}${c.reset} ${c.green}(current)${c.reset}`);
    }
  } else {
    console.log(`         current:   v${CURRENT_SCHEMA_VERSION} ${c.dim}— run ${c.cyan}docguard init${c.dim} to create one${c.reset}`);
  }

  console.log();

  // ── Decide what to do ───────────────────────────────────────────────────
  const anythingBehind = cliBehind || schemaBehind;
  if (!anythingBehind) {
    console.log(`  ${c.green}✅ Everything is up to date.${c.reset}`);
    return;
  }

  // What needs doing
  console.log(`${c.bold}  Recommended actions:${c.reset}`);
  if (cliBehind) {
    console.log(`    ${c.yellow}•${c.reset} Upgrade CLI:    ${c.cyan}npm install -g docguard-cli@latest${c.reset}`);
  }
  if (schemaBehind) {
    console.log(`    ${c.yellow}•${c.reset} Migrate schema: ${c.cyan}docguard upgrade --apply${c.reset} ${c.dim}(or hand-edit .docguard.json)${c.reset}`);
  }
  console.log();

  // ── --check-only: exit 1 to fail CI ─────────────────────────────────────
  if (checkOnly) {
    console.log(`${c.red}Exit 1 — versions behind (--check-only mode).${c.reset}`);
    process.exit(1);
  }

  // ── --apply: actually run the migration ─────────────────────────────────
  if (apply) {
    console.log(`${c.bold}  Applying upgrades...${c.reset}\n`);

    if (cliBehind) {
      console.log(`  ${c.dim}Running:${c.reset} npm install -g docguard-cli@latest`);
      const r = applyCliUpgrade();
      if (r.status !== 0) {
        console.error(`  ${c.red}✗ CLI upgrade failed.${c.reset} Try with sudo, or check npm permissions.`);
        process.exit(1);
      }
      console.log(`  ${c.green}✓ CLI upgraded.${c.reset}`);
    }

    if (schemaBehind && projectSchema) {
      const cfgPath = resolve(projectDir, '.docguard.json');
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
      const { changed, newConfig } = migrateSchema(cfg, projectSchema);
      if (changed) {
        // v0.14-P4: --pr opens a PR for review instead of in-place editing.
        // Useful when the team wants a reviewable diff or has branch-protected
        // .docguard.json. Falls back to in-place if pre-flight fails.
        if (flags.pr) {
          console.log(`  ${c.dim}Opening PR with migrated config...${c.reset}`);
          const pr = openUpgradePR(projectDir, newConfig, projectSchema, newConfig.version);
          if (pr.ok) {
            console.log(`  ${c.green}✓ Schema migration PR opened:${c.reset} ${c.cyan}${pr.prUrl}${c.reset}`);
          } else {
            console.error(`  ${c.red}✗ PR creation failed:${c.reset} ${pr.error}`);
            console.log(`  ${c.dim}Tip: run without --pr to apply in place, or fix the underlying issue.${c.reset}`);
            process.exit(1);
          }
        } else {
          writeFileSync(cfgPath, JSON.stringify(newConfig, null, 2) + '\n', 'utf-8');
          console.log(`  ${c.green}✓ Schema migrated ${projectSchema} → ${newConfig.version}.${c.reset}`);
        }
      } else {
        console.log(`  ${c.dim}Schema migration was a no-op (no recipe registered yet for ${projectSchema} → ${CURRENT_SCHEMA_VERSION}).${c.reset}`);
      }
    }

    console.log(`\n  ${c.green}✅ Upgrade complete.${c.reset} Run ${c.cyan}docguard guard${c.reset} to verify.`);
  }
}

/**
 * Lightweight check for the post-guard nudge — returns a string when the
 * project is behind, null when it's current. Cheap to call; never throws.
 */
export function checkUpgradeStatus(projectDir) {
  const schema = readProjectSchemaVersion(projectDir);
  if (!schema) return null;
  if (compareVersions(schema, CURRENT_SCHEMA_VERSION) < 0) {
    // '0.0' is the internal sentinel for pre-0.4 schemas (no `version` field).
    // Surface that as a friendlier label so users don't see "Schema 0.0".
    const label = schema === '0.0' ? 'pre-0.4 (no version field)' : `v${schema}`;
    return `Schema ${label} is behind current v${CURRENT_SCHEMA_VERSION}. Run \`docguard upgrade --apply\` to migrate.`;
  }
  return null;
}
