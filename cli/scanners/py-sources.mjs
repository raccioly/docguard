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

// Pattern-tier outlines, by path and content, for the life of the process:
// routes and models each ask for the same files in one run.
const _outlines = new Map(); // path → { source, outline }
const _MAX_CACHED = 20000;

function patternOutline(file, source) {
  const hit = _outlines.get(file);
  if (hit && hit.source === source) return hit.outline;
  let outline;
  try { outline = outlineFromSource(source); } catch { outline = null; }
  if (_outlines.size >= _MAX_CACHED) _outlines.clear();
  _outlines.set(file, { source, outline });
  return outline;
}

/**
 * Outlines for a batch of files: the AST tier where `python3` parses the file,
 * the pattern tier otherwise. Files the size/generated guard skips are omitted,
 * and so are files whose text fails `wanted` (a cheap pre-filter, so a scan
 * that needs only model files does not start an interpreter for the rest).
 *
 * @param {string[]} files absolute paths
 * @param {string} noun what the batch fell back for, in the tier reason
 * @param {(source: string) => boolean} [wanted]
 * @returns {{ byFile: Map<string, {outline, tier, tierReason}>, scanTier: object }}
 */
export function loadPythonOutlines(files, noun = 'facts', wanted = null) {
  const sources = new Map();
  for (const file of files) {
    const source = readScannable(file);
    if (source === null || (wanted && !wanted(source))) continue;
    sources.set(file, source);
  }
  const ast = extractPythonFiles([...sources.keys()]);
  const batchReason = ast === null ? `No usable python3 interpreter; ${noun} matched by pattern.` : null;
  const byFile = new Map();
  const tiers = [];
  for (const [file, source] of sources) {
    const parsed = ast && ast[file];
    const { tier, tierReason } = tierFor(file, parsed, batchReason);
    tiers.push({ tier, tierReason });
    const outline = parsed && parsed.ok && parsed.outline ? parsed.outline : patternOutline(file, source);
    if (outline) byFile.set(file, { outline, tier, tierReason });
  }
  return { byFile, scanTier: summarizeTiers(tiers) };
}
