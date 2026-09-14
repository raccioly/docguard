/**
 * @req docguard.language-repository-coverage#FR-012
 * @req docguard.language-repository-coverage#FR-013
 * @req docguard.language-repository-coverage#FR-014
 * @req docguard.language-repository-coverage#SC-004
 * @req specs/009-language-repository-coverage/spec.md#FR-016
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { safeWrite } from '../cli/writers/generate-io.mjs';
import { detectRepositoryRootGuidance, renderRepositoryRootGuidance } from '../cli/repository-root.mjs';

const cli = fileURLToPath(new URL('../cli/docguard.mjs', import.meta.url));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-root-guidance-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function packageAt(path, value = {}) {
  safeWrite(join(path, 'package.json'), JSON.stringify({ name: 'fixture', ...value }));
}

function initGit(path) {
  execFileSync('git', ['init', '-q'], { cwd: path });
}

test('selects the nearest ancestor DocGuard configuration without changing scope', t => {
  const root = fixture(t);
  const child = join(root, 'apps/service');
  safeWrite(join(root, '.docguard.json'), '{}');
  packageAt(child, { name: 'service' });
  const guidance = detectRepositoryRootGuidance(child, { argv: ['guard'] });
  assert.equal(guidance.suggestedDir, root);
  assert.equal(guidance.selectedDir, child);
  assert.equal(guidance.reason, 'ancestor_docguard_config');
  assert.equal(guidance.automaticScopeChange, false);
  assert.equal(guidance.rerun, `docguard guard --dir ${root}`);
});

test('recognizes npm workspace paths and quoted rerun arguments', t => {
  const root = fixture(t);
  const child = join(root, 'packages/web app');
  packageAt(root, { name: 'root', private: true, workspaces: ['packages/*'] });
  packageAt(child, { name: 'web-app' });
  const guidance = detectRepositoryRootGuidance(child, { argv: ['specs', 'complete', '--reason', 'reviewed outcome'] });
  assert.equal(guidance.reason, 'npm_workspace');
  assert.equal(guidance.packagePath, 'packages/web app');
  assert.match(guidance.rerun, /--reason 'reviewed outcome'/);
  assert.match(guidance.rerun, new RegExp(`--dir '${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'|--dir ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('honors pnpm includes, exclusions, and pnpm precedence', t => {
  const root = fixture(t);
  const included = join(root, 'components/ui');
  const excluded = join(root, 'components/test/fixture');
  packageAt(root, { workspaces: ['fallback/*'] });
  packageAt(included);
  packageAt(excluded);
  safeWrite(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'components/**'\n  - '!**/test/**'\n");
  assert.equal(detectRepositoryRootGuidance(included)?.reason, 'pnpm_workspace');
  assert.equal(detectRepositoryRootGuidance(excluded), null);

  safeWrite(join(root, 'pnpm-workspace.yaml'), 'catalog:\n  react: 19.0.0\n');
  const fallback = join(root, 'fallback/pkg');
  packageAt(fallback);
  assert.equal(detectRepositoryRootGuidance(fallback), null, 'pnpm does not read package.json workspaces');
});

test('suppresses guidance for explicit selection, nested config, Git-only roots, and nested repositories', t => {
  const root = fixture(t);
  const child = join(root, 'packages/app');
  packageAt(root, { workspaces: ['packages/*'] });
  packageAt(child);
  assert.equal(detectRepositoryRootGuidance(child, { explicitDir: true }), null);
  safeWrite(join(child, '.docguard.json'), '{}');
  assert.equal(detectRepositoryRootGuidance(child), null);

  rmSync(join(child, '.docguard.json'));
  packageAt(root, { workspaces: undefined });
  initGit(root);
  assert.equal(detectRepositoryRootGuidance(child), null, 'a Git root alone is context, not ownership');

  safeWrite(join(root, '.docguard.json'), '{}');
  initGit(child);
  safeWrite(join(child, 'src/index.js'), 'export {};\n');
  assert.equal(detectRepositoryRootGuidance(join(child, 'src')), null, 'do not cross a nested Git boundary');
});

test('CLI preserves JSON stdout and emits structured stderr guidance', t => {
  const root = fixture(t);
  const child = join(root, 'packages/app');
  packageAt(root, { name: 'root', private: true, workspaces: ['packages/*'] });
  packageAt(child, { name: 'child' });
  safeWrite(join(child, 'src/index.js'), 'export const child = true;\n');
  const result = spawnSync(process.execPath, [cli, 'generate', '--plan', '--format', 'json'], {
    cwd: child, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).project, 'child', 'the selected package remains the scan root');
  const diagnostic = JSON.parse(result.stderr.trim());
  assert.equal(diagnostic.type, 'docguard.repository-root-guidance');
  assert.equal(diagnostic.repositoryRootGuidance.suggestedDir, realpathSync(root));
  assert.equal(diagnostic.repositoryRootGuidance.automaticScopeChange, false);
});

test('CLI human guidance gives an exact rerun and explicit --dir suppresses it', t => {
  const root = fixture(t);
  const child = join(root, 'packages/app');
  packageAt(root, { name: 'root', workspaces: ['packages/*'] });
  packageAt(child, { name: 'child' });
  const human = spawnSync(process.execPath, [cli, 'score'], { cwd: child, encoding: 'utf8', timeout: 15000 });
  const physicalRoot = realpathSync(root);
  assert.match(human.stderr, new RegExp(`Re-run for repository scope: docguard score --dir ${physicalRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  const explicit = spawnSync(process.execPath, [cli, 'score', '--format', 'json', '--dir', child], {
    cwd: root, encoding: 'utf8', timeout: 15000,
  });
  assert.doesNotMatch(explicit.stderr, /repository-root-guidance|Re-run for repository scope/);
  assert.doesNotThrow(() => JSON.parse(explicit.stdout));
});

test('structured rendering is a single JSON diagnostic', () => {
  const value = { selectedDir: '/a', suggestedDir: '/b', reason: 'npm_workspace', evidence: 'package.json#workspaces', packagePath: 'p', gitRoot: null, rerun: 'docguard guard --dir /b', automaticScopeChange: false };
  const rendered = JSON.parse(renderRepositoryRootGuidance(value, { machine: true }));
  assert.equal(rendered.type, 'docguard.repository-root-guidance');
  assert.deepEqual(rendered.repositoryRootGuidance, value);
});
