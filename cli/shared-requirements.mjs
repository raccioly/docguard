/**
 * Requirement identity parsing shared by traceability and lifecycle recovery.
 * Only declaration-shaped Markdown counts; prose, comments, code fences, and
 * example sections cannot mint identities.
 *
 * Each identity carries `text`, the declaration line (what the TF-IDF test
 * hint and preflight overlap detection read), and `block`, every line of the
 * requirement: a list item with its nested bullets and indented continuation,
 * a heading through the next heading, a table row, or a paragraph. A
 * requirement fingerprint hashes the block, so an edit to its third line is
 * seen (docguard.requirement-anchors#FR-014).
 * @implements docguard.requirement-anchors#FR-014
 */

export const DEFAULT_REQ_PATTERNS = [
  /\b(REQ)-(\d{2,4})\b/g,
  /\b(FR)-(\d{2,4})\b/g,
  /\b(NFR)-(\d{2,4})\b/g,
  /\b(US)-(\d{2,4})\b/g,
  /\b(STORY)-(\d{2,4})\b/g,
  /\b(AC)-(\d{2,4})\b/g,
  /\b(UC)-(\d{2,4})\b/g,
  /\b(SYS)-(\d{2,4})\b/g,
  /\b(ARCH)-(\d{2,4})\b/g,
  /\b(MOD)-(\d{2,4})\b/g,
  /\b(SC)-(\d{2,4})\b/g,
  /(?<=\[[ xX]\]\s|@(?:req|task|covers)\s)(T)(\d{3,4})\b/g,
];

export function requirementPatterns(config = {}) {
  const customPattern = config.traceability?.requirementPattern;
  return customPattern
    ? [new RegExp(customPattern, 'g')]
    : DEFAULT_REQ_PATTERNS;
}

/**
 * Return path-qualified identities from one Markdown artifact.
 * @returns {Map<string, {id:string, file:string, line:number, text:string}>}
 */
export function collectRequirementIdsFromContent(content, docName, patterns = DEFAULT_REQ_PATTERNS) {
  const reqIds = new Map();
  const hasMatch = patterns.some(pattern => {
    pattern.lastIndex = 0;
    return pattern.test(content);
  });
  if (!hasMatch) return reqIds;

  const lines = content.split('\n');
  const declarations = [];
  let fence = null;
  let exampleLevel = null;
  let inComment = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (/^(?: {4}|\t)/.test(line) && !fence && !inComment) continue;
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length
        && line.slice(marker[0].length).trim() === '') fence = null;
      continue;
    }
    if (marker) { fence = marker[1]; continue; }
    line = line.replace(/<!--[\s\S]*?-->/g, '');
    if (inComment) {
      const close = line.indexOf('-->');
      if (close < 0) continue;
      line = line.slice(close + 3);
      inComment = false;
    }
    const open = line.indexOf('<!--');
    if (open >= 0) { line = line.slice(0, open); inComment = true; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.*)/);
    if (heading) {
      if (exampleLevel !== null && heading[1].length <= exampleLevel) exampleLevel = null;
      if (exampleLevel === null && /^(?:(?:requirement|task)[ -]+)?(?:examples?|ID[ -]+(?:formats?|syntax|examples?)|(?:formats?|syntax)[ -]+(?:of[ -]+)?IDs?)\b/i.test(heading[2])) {
        exampleLevel = heading[1].length;
      }
    }
    if (exampleLevel !== null) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const prefix = line.slice(0, match.index);
        if (!/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|\|\s*)?[\s*`_]*$/.test(prefix)) {
          if (!match[0].length) pattern.lastIndex++;
          continue;
        }
        const reqId = match[0];
        if (!reqId.length) { pattern.lastIndex++; continue; }
        const key = `${docName}#${reqId}`;
        if (!reqIds.has(key)) {
          reqIds.set(key, { id: reqId, file: docName, line: i + 1, text: line.trim() });
          declarations.push({ key, index: i, prefix });
        }
      }
    }
  }
  if (declarations.length) attachBlocks(lines, declarations, reqIds);
  return reqIds;
}

/** Which raw lines sit inside a fenced code block. */
function fencedLines(lines) {
  const inFence = new Array(lines.length).fill(false);
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      inFence[i] = true;
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length
        && lines[i].slice(marker[0].length).trim() === '') fence = null;
    } else if (marker) { fence = marker[1]; inFence[i] = true; }
  }
  return inFence;
}

function attachBlocks(lines, declarations, reqIds) {
  const inFence = fencedLines(lines);
  const declared = new Set(declarations.map(d => d.index));
  for (const { key, index, prefix } of declarations) {
    const list = prefix.match(/^(\s*)(?:[-*+]|\d+[.)])\s/);
    const kind = /^\s{0,3}#{1,6}\s/.test(prefix) ? 'heading'
      : /^\s{0,3}\|/.test(prefix) ? 'table'
        : list ? 'list' : 'plain';
    const indent = list ? list[1].length : 0;
    let end = index;
    for (let j = index + 1; j < lines.length && kind !== 'table'; j++) {
      const raw = lines[j];
      if (declared.has(j)) break;
      if (!inFence[j] && /^\s{0,3}#{1,6}\s/.test(raw)) break;
      const blank = raw.trim() === '';
      if (kind === 'plain' && blank) break;
      if (kind === 'list' && !blank && !inFence[j] && raw.match(/^\s*/)[0].length <= indent) break;
      if (!blank) end = j;
    }
    reqIds.get(key).block = lines.slice(index, end + 1).join('\n');
  }
}
