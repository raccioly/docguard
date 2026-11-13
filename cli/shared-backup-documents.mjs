/**
 * Backup documents (specs/100-file-kinds FR-013): a document named like a
 * backup copy (`ARCHITECTURE.md.bak`, `SECURITY copy.md`, `API (1).md`,
 * `DATA-old.md`) inside a documentation directory. The kind rule
 * (`fileKind`, `backup`) takes such a file out of every document check; this
 * lists them so the project can delete the leftover, ignore it, or say it is a
 * real document (`fileKinds.own`).
 *
 * Only the file NAME makes a leftover. A document under an archive folder
 * (`docs/archive/`) also leaves the document role, but an archive is usually
 * kept on purpose, so it is listed under `files.kinds.excluded.backup` and is
 * never warned about.
 *
 * Reads the project's tracked files, so a laptop and CI agree; without usable
 * git it walks the tree.
 *
 * @implements docguard.file-kinds#FR-013
 */
import { basename } from 'node:path';
import { fileKind, inDocumentationDirectory, NOT_OWN_KINDS } from './shared-file-kind.mjs';
import { listTrackedFiles } from './shared-git.mjs';
import { relPosix, shouldIgnore, walkFiles } from './shared-ignore.mjs';

/** Project files, POSIX and relative: the tracked ones, or the walked tree outside git. */
function projectFiles(projectDir) {
  const tracked = listTrackedFiles(projectDir);
  if (tracked) return tracked;
  const files = [];
  walkFiles(projectDir, full => { files.push(relPosix(projectDir, full)); }, { nestedCheckouts: true });
  return files.sort();
}

/**
 * @param {string} projectDir
 * @param {object} [config]
 * @param {string[]} [files] project-relative paths (default: the project's files)
 * @returns {{ path: string, by: 'name'|'folder' }[]} documents inside a documentation directory that
 *   `fileKind` calls `backup`, by file name or by archive folder, in path order. `.docguardignore`, `ignore`
 *   and `fileKinds.own` leave a path out.
 */
export function backupDocuments(projectDir, config = {}, files = projectFiles(projectDir)) {
  const out = [];
  for (const path of files) {
    if (!inDocumentationDirectory(path)) continue;
    if (shouldIgnore(path, config)) continue;
    // A backup inside a template, fixture or test project (`tests/fixtures/app/docs/X.md.bak`) is part of that
    // copy, not a leftover of this project.
    if (fileKind(path, config, { kinds: NOT_OWN_KINDS.filter(k => k !== 'backup' && k !== 'nested-checkout') }).kind !== 'own') continue;
    const kind = fileKind(path, config, { kinds: ['backup'] });
    if (kind.kind !== 'backup') continue;
    out.push({ path, by: kind.segment === basename(path) ? 'name' : 'folder' });
  }
  return out;
}

/** The leftovers worth a warning: backup-NAMED documents. */
export function backupLeftovers(projectDir, config = {}, files) {
  return backupDocuments(projectDir, config, files).filter(d => d.by === 'name').map(d => d.path);
}
