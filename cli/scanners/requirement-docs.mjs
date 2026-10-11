/**
 * Where requirement identities are declared, and the identities themselves.
 *
 * Moved out of the Traceability validator (specs/070-requirement-anchors) so
 * the requirement-anchors scanner reads the same declarations without a
 * scanner importing a validator (Constitution IV). Behavior is unchanged:
 * canonical docs, root REQUIREMENTS.md / spec.md / README.md, configured
 * requirement docs, and Spec Kit spec.md files.
 *
 * @implements docguard.requirement-anchors#FR-014
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { listCanonicalDocs } from '../shared-ignore.mjs';
import { DEFAULT_REQ_PATTERNS, collectRequirementIdsFromContent } from '../shared-requirements.mjs';
import { parseSpecId } from './spec-registry.mjs';

export function collectRequirementIds(projectDir, config, patterns = DEFAULT_REQ_PATTERNS) {
  const reqIds = new Map(); // reqId → { file, line }
  const docSearchPaths = getRequirementDocPaths(projectDir, config);

  for (const docPath of docSearchPaths) {
    if (!existsSync(docPath)) continue;

    const docName = relative(projectDir, docPath).replaceAll("\\", "/");
    const content = readFileSync(docPath, 'utf-8');
    const specId = parseSpecId(content);
    for (const [key, definition] of collectRequirementIdsFromContent(content, docName, patterns)) {
      if (!reqIds.has(key)) reqIds.set(key, { ...definition, specId });
    }
  }

  return reqIds;
}

export function getRequirementDocPaths(projectDir, config) {
  const paths = [];

  // docs-canonical/ directory — recursive. Consumer re-derives the display
  // path via relative(projectDir, docPath), so nested docs already report
  // their real path with no further change needed there.
  for (const doc of listCanonicalDocs(projectDir, { config })) paths.push(doc.abs);

  // Root-level docs
  const rootDocs = ['REQUIREMENTS.md', 'spec.md', 'README.md'];
  for (const doc of rootDocs) {
    const p = resolve(projectDir, doc);
    if (existsSync(p)) paths.push(p);
  }

  // User-configured requirement docs
  const configDocs = [...(config.requiredFiles?.canonical || []), ...(config.traceability?.requirementDocs || [])];
  for (const doc of configDocs) {
    const p = resolve(projectDir, doc);
    const rel = relative(projectDir, p);
    if (rel === '..' || rel.startsWith('../') || rel.split(/[\\/]/).includes('.local')) continue;
    try {
      if (statSync(p).isFile() && !paths.includes(p)) paths.push(p);
      else if (statSync(p).isDirectory()) {
        for (const entry of listCanonicalDocs(projectDir, { dirName: doc, config: {} })) {
          if (!paths.includes(entry.abs)) paths.push(entry.abs);
        }
      }
    } catch { /* Structural validators own missing or unreadable doc paths. */ }
  }

  // Spec Kit artifacts: .specify/specs/*/spec.md (v3+) and specs/*/spec.md (legacy)
  const specKitDirs = [
    resolve(projectDir, '.specify', 'specs'),  // v3+ standard
    resolve(projectDir, 'specs'),               // legacy
  ];
  for (const specsDir of specKitDirs) {
    if (existsSync(specsDir)) {
      try {
        for (const feature of readdirSync(specsDir)) {
          const specPath = join(specsDir, feature, 'spec.md');
          if (existsSync(specPath) && !paths.includes(specPath)) paths.push(specPath);
        }
      } catch { /* ignore */ }
    }
  }

  return paths;
}
