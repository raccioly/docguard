/**
 * Document lifecycle retirement.
 *
 * Historical prose leaves the working tree so agents cannot mistake it for
 * current intent. Git remains the content store; a compact manifest records
 * why each path left and how to restore it.
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';
import { safeWrite } from '../writers/generate-io.mjs';
import { scanDocumentLifecycle } from '../scanners/document-lifecycle.mjs';
import { parseSpecId, readSpecRegistry } from '../scanners/spec-registry.mjs';
import {
  collectRequirementIdsFromContent,
  requirementPatterns,
} from '../shared-requirements.mjs';

const MANIFEST_PATH = '.docguard-archive.json';
const PROTECTED_PREFIXES = ['.git', '.local', '.docguard'];
const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.adoc']);

function git(projectDir, args) {
  const result = spawnSync('git', args, {
    cwd: projectDir,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(detail || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function repositoryRoot(projectDir) {
  const root = git(projectDir, ['rev-parse', '--show-toplevel']).trim();
  const requested = realpathSync(projectDir);
  if (realpathSync(root) !== requested) {
    throw new Error('Retirement must run from the repository root. Pass --dir <repository-root>.');
  }
  return requested;
}

function toPosix(path) {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function validateSelection(root, input) {
  if (!input || input.includes('\0')) throw new Error('Retirement paths must be non-empty.');
  const absolute = resolve(root, input);
  const rel = toPosix(relative(root, absolute));
  if (!rel || rel === '.' || rel === '..' || rel.startsWith('../')) {
    throw new Error(`Retirement path must stay inside the repository: ${input}`);
  }
  if (PROTECTED_PREFIXES.some(prefix => rel === prefix || rel.startsWith(`${prefix}/`))) {
    throw new Error(`Retirement refuses protected path: ${rel}`);
  }
  if (rel === MANIFEST_PATH) throw new Error(`Retirement refuses its recovery manifest: ${rel}`);
  if (!existsSync(absolute)) throw new Error(`Retirement path does not exist: ${rel}`);
  if (lstatSync(absolute).isSymbolicLink()) throw new Error(`Retirement refuses symlinks: ${rel}`);
  const resolved = realpathSync(absolute);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) {
    throw new Error(`Retirement path resolves outside the repository: ${rel}`);
  }
  return rel;
}

function trackedFiles(projectDir, selections) {
  const files = new Set();
  for (const selection of selections) {
    const output = git(projectDir, ['ls-files', '-z', '--', selection]);
    const matches = output.split('\0').filter(Boolean);
    if (matches.length === 0) throw new Error(`Retirement path is not tracked by Git: ${selection}`);
    for (const match of matches) files.add(toPosix(match));
  }
  return [...files].sort();
}

function assertSelectionsContainOnlyTrackedFiles(projectDir, selections) {
  for (const selection of selections) {
    const status = git(projectDir, [
      'status', '--porcelain=v1', '--untracked-files=all', '--ignored', '--', selection,
    ]);
    if (status.split('\n').some(line => line.startsWith('?? ') || line.startsWith('!! '))) {
      throw new Error(`Retirement selection contains untracked or ignored files: ${selection}`);
    }
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function requiredFiles(config) {
  const required = config?.requiredFiles || {};
  const values = [
    ...(Array.isArray(required.canonical) ? required.canonical : []),
    ...(Array.isArray(required.agentFile) ? required.agentFile : []),
    required.changelog,
    required.driftLog,
  ];
  return new Set(values.filter(value => typeof value === 'string').map(toPosix));
}

function assertArchivable(projectDir, files, config) {
  const protectedFiles = requiredFiles(config);
  for (const file of files) {
    if (!DOCUMENT_EXTENSIONS.has(extname(file).toLowerCase())) {
      throw new Error(`Retirement accepts documentation files only; refusing ${file}.`);
    }
    if (protectedFiles.has(file)) {
      throw new Error(`Retirement refuses required file ${file}; replace and reconfigure it first.`);
    }
    const absolute = resolve(projectDir, file);
    if (!existsSync(absolute)) throw new Error(`Retirement path disappeared: ${file}`);
    if (lstatSync(absolute).isSymbolicLink()) throw new Error(`Retirement refuses symlinks: ${file}`);
    const status = git(projectDir, ['status', '--porcelain=v1', '--', file]).trim();
    if (status) throw new Error(`Retirement requires a clean tracked file: ${file}`);
    const stage = git(projectDir, ['ls-files', '--stage', '--', file]).trim();
    if (stage.startsWith('160000 ')) throw new Error(`Retirement refuses Git submodules: ${file}`);
  }
}

function assertCleanTrackedDocument(projectDir, input, label) {
  const rel = validateSelection(projectDir, input);
  const files = trackedFiles(projectDir, [rel]);
  if (files.length !== 1 || files[0] !== rel || !DOCUMENT_EXTENSIONS.has(extname(rel).toLowerCase())) {
    throw new Error(`${label} must name one tracked documentation file: ${rel}`);
  }
  const status = git(projectDir, ['status', '--porcelain=v1', '--', rel]).trim();
  if (status) throw new Error(`${label} must be clean at the recorded source revision: ${rel}`);
  return rel;
}

function assertNoLiveBackreferences(projectDir, files) {
  const selected = new Set(files);
  const docs = trackedFiles(projectDir, ['*.md']);
  for (const doc of docs) {
    if (selected.has(doc)) continue;
    const absolute = resolve(projectDir, doc);
    if (!existsSync(absolute)) continue;
    let content;
    try { content = readFileSync(absolute, 'utf8'); } catch { continue; }
    const link = /!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g;
    let match;
    while ((match = link.exec(content)) !== null) {
      const raw = (match[1] || match[2] || '').split('#')[0].split('?')[0];
      if (!raw || raw.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
      let decoded = raw;
      try { decoded = decodeURIComponent(raw); } catch { /* use literal path */ }
      const target = toPosix(relative(projectDir, resolve(dirname(absolute), decoded)));
      if (!selected.has(target)) continue;
      const line = content.slice(0, match.index).split('\n').length;
      throw new Error(`Retirement refuses ${target}; live backreference remains at ${doc}:${line}.`);
    }
  }
}

function assertNoCurrentRegisteredSpec(projectDir, files) {
  const loaded = readSpecRegistry(projectDir);
  if (loaded.error) throw new Error(`Retirement cannot verify spec lifecycle: ${loaded.error}`);
  if (!loaded.exists) return;
  for (const entry of loaded.value.specs) {
    const lifecycle = entry.reviewed?.lifecycle || entry.lifecycle;
    if (lifecycle?.context !== 'current') continue;
    const specDir = dirname(entry.path);
    const selected = files.find(path => path === entry.path || path.startsWith(`${specDir}/`));
    if (selected) {
      throw new Error(`Retirement refuses active registered spec ${entry.specId} (${selected}). Transition it through the docguard specs lifecycle before removing its artifacts.`);
    }
  }
}

function refExists(projectDir, ref) {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', ref], { cwd: projectDir });
  return result.status === 0;
}

function retentionRef(projectDir, explicit) {
  let ref = explicit?.trim() || null;
  if (!ref) {
    const remoteHead = spawnSync('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], {
      cwd: projectDir,
      encoding: 'utf8',
    });
    if (remoteHead.status === 0) ref = remoteHead.stdout.trim();
  }
  if (!ref && refExists(projectDir, 'refs/heads/main')) ref = 'refs/heads/main';
  if (!ref && refExists(projectDir, 'refs/heads/master')) ref = 'refs/heads/master';
  if (!ref) {
    throw new Error('Retirement needs a retained branch ref. Pass --retention-ref <ref> after pushing the source revision.');
  }
  git(projectDir, ['rev-parse', '--verify', ref]);
  const contains = spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', ref], { cwd: projectDir });
  if (contains.status !== 0) {
    throw new Error(`Retirement source HEAD is not retained by ${ref}; push or merge it before retirement.`);
  }
  return ref;
}

function loadManifest(projectDir) {
  const path = resolve(projectDir, MANIFEST_PATH);
  if (!existsSync(path)) return { schemaVersion: 1, strategy: 'git-history', entries: [] };
  let parsed;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch {
    throw new Error(`${MANIFEST_PATH} is not valid JSON.`);
  }
  if (parsed?.schemaVersion !== 1 || parsed?.strategy !== 'git-history' || !Array.isArray(parsed.entries)) {
    throw new Error(`${MANIFEST_PATH} does not use the supported schema.`);
  }
  return parsed;
}

function writeArchive(projectDir, config, flags) {
  if (!flags.paths?.length) throw new Error('Retire --write requires at least one --path <file-or-directory>.');
  if (!flags.reason?.trim()) throw new Error('Retire --write requires --reason <why-this-is-no-longer-current>.');

  const selections = flags.paths.map(path => validateSelection(projectDir, path));
  const supersededBy = flags.supersededBy
    ? assertCleanTrackedDocument(projectDir, flags.supersededBy, 'Replacement')
    : null;
  const evidence = (flags.evidencePaths || []).map(path =>
    assertCleanTrackedDocument(projectDir, path, 'Evidence'));
  assertSelectionsContainOnlyTrackedFiles(projectDir, selections);
  const files = trackedFiles(projectDir, selections);
  if (supersededBy) {
    git(projectDir, ['ls-files', '--error-unmatch', '--', supersededBy]);
    if (files.includes(supersededBy)) throw new Error('A replacement document cannot be archived in the same operation.');
  }
  const selectedEvidence = evidence.find(path => files.includes(path));
  if (selectedEvidence) throw new Error(`Evidence cannot be retired in the same operation: ${selectedEvidence}`);
  assertArchivable(projectDir, files, config);
  assertNoCurrentRegisteredSpec(projectDir, files);
  assertNoLiveBackreferences(projectDir, files);

  const commit = git(projectDir, ['rev-parse', 'HEAD']).trim();
  const retainedBy = retentionRef(projectDir, flags.retentionRef);
  const objectFormat = git(projectDir, ['rev-parse', '--show-object-format']).trim();
  const archivedAt = new Date().toISOString();
  const manifest = loadManifest(projectDir);
  const patterns = requirementPatterns(config);
  const specIdsByDirectory = new Map();
  for (const path of files) {
    if (basename(path).toLowerCase() !== 'spec.md') continue;
    const specId = parseSpecId(readFileSync(resolve(projectDir, path), 'utf8'));
    if (specId) specIdsByDirectory.set(dirname(path), specId);
  }
  const entries = files.map(path => {
    const content = readFileSync(resolve(projectDir, path), 'utf8');
    const requirementIds = [...new Set(
      [...collectRequirementIdsFromContent(content, path, patterns).values()]
        .map(definition => definition.id),
    )].sort();
    return {
      path,
      archivedAt,
      archivedFrom: commit,
      blob: git(projectDir, ['rev-parse', `HEAD:${path}`]).trim(),
      reason: flags.reason.trim(),
      ...(specIdsByDirectory.get(dirname(path)) ? { specId: specIdsByDirectory.get(dirname(path)) } : {}),
      ...(supersededBy ? { supersededBy } : {}),
      ...(evidence.length > 0 ? { evidence } : {}),
      ...(requirementIds.length > 0 ? { requirementIds } : {}),
      retentionRef: retainedBy,
      objectFormat,
      recoverability: 'verified',
      restore: `git restore --source=${shellQuote(commit)} -- ${shellQuote(path)}`,
    };
  });

  const next = { ...manifest, entries: [...manifest.entries, ...entries] };
  assertArchivable(projectDir, files, config);
  const removed = [];
  try {
    for (const file of files) {
      unlinkSync(resolve(projectDir, file));
      removed.push(file);
    }
    safeWrite(resolve(projectDir, MANIFEST_PATH), `${JSON.stringify(next, null, 2)}\n`);
  } catch (error) {
    if (removed.length > 0) {
      spawnSync('git', ['restore', `--source=${commit}`, '--', ...removed], { cwd: projectDir });
    }
    throw error;
  }

  const directories = [...new Set(files.map(dirname))]
    .filter(path => path !== '.')
    .sort((a, b) => b.length - a.length);
  for (const directory of directories) {
    try { rmSync(resolve(projectDir, directory)); } catch { /* non-empty directories remain */ }
  }
  return { status: 'ARCHIVED', strategy: 'git-history', manifest: MANIFEST_PATH, entries };
}

function printText(result) {
  if (result.status === 'ARCHIVED') {
    console.log(`Retired ${result.entries.length} tracked file(s) from the working tree.`);
    console.log(`Manifest: ${result.manifest}`);
    for (const entry of result.entries) console.log(`  ${entry.path}`);
    return;
  }
  console.log('DocGuard Retirement Plan');
  console.log('Strategy: Git history + compact manifest (obsolete prose is not copied).');
  if (result.candidates.length === 0) {
    console.log('No lifecycle candidates found.');
  } else {
    for (const candidate of result.candidates) {
      console.log(`  [${candidate.confidence}] ${candidate.path} — ${candidate.reason}`);
    }
  }
  console.log('Review candidates, then retire explicitly with --write --path <path> --reason <reason>.');
}

export function runArchive(projectDir, config, flags = {}) {
  try {
    const root = repositoryRoot(projectDir);
    const result = flags.write
      ? writeArchive(root, config, flags)
      : {
          status: 'PLAN',
          strategy: 'git-history',
          manifest: MANIFEST_PATH,
          ...scanDocumentLifecycle(root, config),
        };
    if (result.status === 'PLAN' && result.coverage.status !== 'complete') {
      throw new Error(result.coverage.error || `Lifecycle scan is ${result.coverage.status}.`);
    }
    if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
    else printText(result);
    if (flags.check && result.status === 'PLAN') {
      const blocking = result.candidates.filter(candidate => candidate.confidence === 'high');
      if (blocking.length > 0 || (flags.failOnWarning && result.candidates.length > 0)) process.exitCode = 2;
    }
    return result;
  } catch (error) {
    const result = { status: 'ERROR', error: error.message };
    if (flags.format === 'json') console.log(JSON.stringify(result, null, 2));
    else console.error(`Retirement failed: ${error.message}`);
    process.exitCode = 1;
    return result;
  }
}
