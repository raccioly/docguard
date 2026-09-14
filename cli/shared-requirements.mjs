/**
 * Requirement identity parsing shared by traceability and lifecycle recovery.
 * Only declaration-shaped Markdown counts; prose, comments, code fences, and
 * example sections cannot mint identities.
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
        }
      }
    }
  }
  return reqIds;
}
