#!/usr/bin/env node

/**
 * Synchronize every active release surface with package.json.
 *
 * The allowlist is deliberate: release metadata and copyable install templates
 * must move together, while historical references in changelogs, roadmaps, and
 * completed specifications must remain untouched.
 */

import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeWrite } from '../../cli/writers/generate-io.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

function replaceRequired(content, pattern, replacement, label, expected = 1) {
  let count = 0;
  const next = content.replace(pattern, (...args) => {
    count++;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  if (count !== expected) {
    throw new Error(`${label}: expected ${expected} version field${expected === 1 ? '' : 's'}, found ${count}`);
  }
  return next;
}

function stageText(staged, root, relPath, transform) {
  const fullPath = resolve(root, relPath);
  if (!existsSync(fullPath)) throw new Error(`${relPath}: required release surface is missing`);
  const current = readFileSync(fullPath, 'utf8');
  staged.set(fullPath, transform(current));
}

function stageJson(staged, root, relPath, transform) {
  stageText(staged, root, relPath, content => {
    let value;
    try { value = JSON.parse(content); } catch (error) {
      throw new Error(`${relPath}: invalid JSON: ${error.message}`);
    }
    transform(value);
    return `${JSON.stringify(value, null, 2)}\n`;
  });
}

function writeWithoutReleaseBackup(filePath, content) {
  const previous = readFileSync(filePath, 'utf8');
  if (previous === content) return false;
  safeWrite(filePath, content);
  // Git is the durable backup for these tracked release surfaces. Remove the
  // temporary .bak only after safeWrite succeeds so it cannot enter a release.
  const backup = `${filePath}.bak`;
  if (existsSync(backup)) unlinkSync(backup);
  return true;
}

export function syncReleaseVersion(root = process.cwd()) {
  const packagePath = resolve(root, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const version = pkg.version;
  if (!STABLE_VERSION.test(version || '')) {
    throw new Error(`package.json: expected a stable x.y.z version, got ${JSON.stringify(version)}`);
  }

  const staged = new Map();

  stageText(staged, root, 'pyproject.toml', content => replaceRequired(
    content,
    /(\[project\][\s\S]*?^version\s*=\s*")[^"\n]+(")/m,
    (_match, before, after) => `${before}${version}${after}`,
    'pyproject.toml [project].version',
  ));

  stageJson(staged, root, 'server.json', server => {
    if (!Array.isArray(server.packages)) throw new Error('server.json: packages must be an array');
    const npmPackages = server.packages.filter(item => item?.registryType === 'npm' && item?.identifier === pkg.name);
    if (npmPackages.length !== 1) {
      throw new Error(`server.json: expected one npm package for ${pkg.name}, found ${npmPackages.length}`);
    }
    server.version = version;
    npmPackages[0].version = version;
  });

  stageText(staged, root, 'extensions/spec-kit-docguard/extension.yml', content => replaceRequired(
    content,
    /^  version:\s*["'][^"'\n]+["']/m,
    `  version: "${version}"`,
    'extensions/spec-kit-docguard/extension.yml extension.version',
  ));

  for (const relPath of [
    'templates/ci/github-actions.yml',
    'extensions/spec-kit-docguard/templates/github-workflows/docguard-guard.yml',
  ]) {
    stageText(staged, root, relPath, content => replaceRequired(
      content,
      /docguard-cli@\d+\.\d+\.\d+/g,
      `docguard-cli@${version}`,
      `${relPath} DocGuard CLI pin`,
    ));
  }

  const skillsRoot = resolve(root, 'extensions/spec-kit-docguard/skills');
  if (!existsSync(skillsRoot)) throw new Error('extensions/spec-kit-docguard/skills: required release surface is missing');
  const skillFiles = readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(skillsRoot, entry.name, 'SKILL.md'))
    .filter(existsSync)
    .sort();
  if (skillFiles.length === 0) throw new Error('extensions/spec-kit-docguard/skills: no SKILL.md files found');

  for (const fullPath of skillFiles) {
    const relPath = relative(root, fullPath);
    const current = readFileSync(fullPath, 'utf8');
    let next = replaceRequired(
      current,
      /^  version:\s*\d+\.\d+\.\d+$/m,
      `  version: ${version}`,
      `${relPath} metadata.version`,
    );
    next = replaceRequired(
      next,
      /<!-- docguard:version:\s*\d+\.\d+\.\d+ -->/g,
      `<!-- docguard:version: ${version} -->`,
      `${relPath} docguard version marker`,
    );
    staged.set(fullPath, next);
  }

  // All parsing and cardinality checks finish before the first write. A missing
  // or duplicated field therefore leaves every release surface untouched.
  const changed = [];
  for (const [filePath, content] of staged) {
    if (writeWithoutReleaseBackup(filePath, content)) changed.push(relative(root, filePath));
  }
  return { version, changed };
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    const result = syncReleaseVersion();
    console.log(`Synchronized ${result.changed.length} release surfaces to v${result.version}.`);
  } catch (error) {
    console.error(`Release version sync failed: ${error.message}`);
    process.exitCode = 1;
  }
}
