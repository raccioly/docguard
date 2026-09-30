/**
 * Python outlines for a set of files, each from the best tier available: the
 * `python3` AST tier where the file parses, the pattern tier otherwise.
 * Kept apart from py-outline.mjs so that module stays free of imports that
 * lead back to shared-source.mjs (which uses it for environment variables).
 *
 * @implements docguard.python-extraction#FR-001
 * @implements docguard.python-extraction#FR-005
 */
import { extractPythonFiles } from './py-ast.mjs';
import { outlineFromSource } from './py-outline.mjs';
import { readScannable, tierFor, summarizeTiers } from '../shared-source.mjs';

/**
 * Outlines for a batch of files: the AST tier where `python3` parses the file,
 * the pattern tier otherwise. Files the size/generated guard skips are omitted.
 *
 * @param {string[]} files absolute paths
 * @param {string} noun what the batch fell back for, in the tier reason
 * @returns {{ byFile: Map<string, {outline, tier, tierReason}>, scanTier: object }}
 */
export function loadPythonOutlines(files, noun = 'facts') {
  const ast = extractPythonFiles(files);
  const batchReason = ast === null ? `No usable python3 interpreter; ${noun} matched by pattern.` : null;
  const byFile = new Map();
  const tiers = [];
  for (const file of files) {
    const source = readScannable(file);
    if (source === null) continue;
    const parsed = ast && ast[file];
    const { tier, tierReason } = tierFor(file, parsed, batchReason);
    tiers.push({ tier, tierReason });
    let outline = parsed && parsed.ok && parsed.outline ? parsed.outline : null;
    if (!outline) {
      try { outline = outlineFromSource(source); } catch { outline = null; }
    }
    if (outline) byFile.set(file, { outline, tier, tierReason });
  }
  return { byFile, scanTier: summarizeTiers(tiers) };
}
