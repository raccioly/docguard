
import { DEFAULT_REQ_PATTERNS } from '../cli/validators/traceability.mjs';

function originalImplementation(content, patterns) {
  const reqIds = new Map();
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(lines[i])) !== null) {
        const reqId = match[0];
        if (!reqIds.has(reqId)) {
          reqIds.set(reqId, { line: i + 1 });
        }
      }
    }
  }
  return reqIds;
}

function optimizedImplementation(content, patterns) {
  const reqIds = new Map();

  const lineOffsets = [0];
  let pos = -1;
  while ((pos = content.indexOf('\n', pos + 1)) !== -1) {
    lineOffsets.push(pos + 1);
  }

  function getLineNumber(offset) {
    let low = 0;
    let high = lineOffsets.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lineOffsets[mid] <= offset) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return low;
  }

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const reqId = match[0];
      if (!reqIds.has(reqId)) {
        reqIds.set(reqId, { line: getLineNumber(match.index) });
      }
    }
  }
  return reqIds;
}

function combinedImplementation(content, patterns) {
  const reqIds = new Map();

  const lineOffsets = [0];
  let pos = -1;
  while ((pos = content.indexOf('\n', pos + 1)) !== -1) {
    lineOffsets.push(pos + 1);
  }

  function getLineNumber(offset) {
    let low = 0;
    let high = lineOffsets.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lineOffsets[mid] <= offset) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return low;
  }

  const combinedPattern = new RegExp(patterns.map(p => `(?:${p.source})`).join('|'), 'g');

  let match;
  while ((match = combinedPattern.exec(content)) !== null) {
    const reqId = match[0];
    if (!reqIds.has(reqId)) {
      reqIds.set(reqId, { line: getLineNumber(match.index) });
    }
  }
  return reqIds;
}

// Generate some test data
const numLines = 10000;
const lines = [];
for (let i = 0; i < numLines; i++) {
  if (i % 10 === 0) {
    lines.push(`This is a requirement REQ-${1000 + i} and another FR-${2000 + i}`);
  } else if (i % 33 === 0) {
      lines.push(`Spec Kit: SC-${3000 + i} and T${4000 + i}`);
  } else {
    lines.push(`Regular line of text that does not contain any requirement IDs ${i}`);
  }
}
const content = lines.join('\n');

const iterations = 100;

console.log(`Benchmarking ${iterations} iterations with ${numLines} lines...`);

// Warm up
originalImplementation(content, DEFAULT_REQ_PATTERNS);
optimizedImplementation(content, DEFAULT_REQ_PATTERNS);
combinedImplementation(content, DEFAULT_REQ_PATTERNS);

console.time('Original');
for (let i = 0; i < iterations; i++) {
  originalImplementation(content, DEFAULT_REQ_PATTERNS);
}
console.timeEnd('Original');

console.time('Optimized (No Split)');
for (let i = 0; i < iterations; i++) {
  optimizedImplementation(content, DEFAULT_REQ_PATTERNS);
}
console.timeEnd('Optimized (No Split)');

console.time('Optimized (Combined Regex)');
for (let i = 0; i < iterations; i++) {
  combinedImplementation(content, DEFAULT_REQ_PATTERNS);
}
console.timeEnd('Optimized (Combined Regex)');

// Verification
const res1 = originalImplementation(content, DEFAULT_REQ_PATTERNS);
const res2 = optimizedImplementation(content, DEFAULT_REQ_PATTERNS);
const res3 = combinedImplementation(content, DEFAULT_REQ_PATTERNS);

function verify(a, b, name) {
    if (a.size !== b.size) {
        console.error(`${name}: Size mismatch: ${a.size} vs ${b.size}`);
        return false;
    }
    for (let [id, val] of a) {
        if (!b.has(id) || b.get(id).line !== val.line) {
            console.error(`${name}: Mismatch for ${id}: original line ${val.line}, other line ${b.get(id)?.line}`);
            return false;
        }
    }
    return true;
}

if (verify(res1, res2, "No Split") && verify(res1, res3, "Combined")) {
    console.log("Verification passed!");
}
