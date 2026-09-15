/**
 * Bounded, non-executable Python container-literal inspection.
 * Counts syntactic top-level entries without importing Python or project code.
 * @implements docguard.evidence-scoped-verification#FR-002
 * @implements docguard.adoption-workflow-integrity#FR-011
 */

export const PYTHON_LITERAL_LIMITS = Object.freeze({
  sourceCharacters: 1_048_576,
  tokens: 100_000,
  nesting: 64,
  entries: 20_000,
});

export const PYTHON_SYMBOL_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const OPEN_TO_CLOSE = new Map([['[', ']'], ['(', ')'], ['{', '}']]);
const CLOSE_TO_OPEN = new Map([...OPEN_TO_CLOSE].map(([open, close]) => [close, open]));
const ASSIGNMENT_OPERATORS = new Set(['=', '+=', '-=', '*=', '/=', '//=', '%=', '@=', '&=', '|=', '^=', '>>=', '<<=', '**=']);
const STRING_PREFIX = /^[rRuUbBfF]$/;

const result = (status, reasonCode, message, extra = {}) => ({ status, reasonCode, message, ...extra });

function stringStart(source, index) {
  if (source[index] === "'" || source[index] === '"') return { quoteIndex: index };
  if (index > 0 && /[A-Za-z0-9_]/.test(source[index - 1])) return null;
  let cursor = index;
  while (cursor < source.length && cursor - index < 3 && STRING_PREFIX.test(source[cursor])) cursor++;
  if (cursor === index || (source[cursor] !== "'" && source[cursor] !== '"')) return null;
  return { quoteIndex: cursor };
}

function consumeString(source, start) {
  const found = stringStart(source, start);
  if (!found) return null;
  const quote = source[found.quoteIndex];
  const triple = source.slice(found.quoteIndex, found.quoteIndex + 3) === quote.repeat(3);
  let cursor = found.quoteIndex + (triple ? 3 : 1);
  while (cursor < source.length) {
    if (triple && source.slice(cursor, cursor + 3) === quote.repeat(3)) return cursor + 3;
    if (!triple && source[cursor] === quote) return cursor + 1;
    if (source[cursor] === '\\') {
      cursor += Math.min(2, source.length - cursor);
      continue;
    }
    if (!triple && (source[cursor] === '\n' || source[cursor] === '\r')) return -1;
    cursor++;
  }
  return -1;
}

function operatorAt(source, index) {
  for (const width of [3, 2]) {
    const candidate = source.slice(index, index + width);
    if (ASSIGNMENT_OPERATORS.has(candidate) || ['**', '//', ':=', '==', '!=', '<=', '>=', '<<', '>>', '->'].includes(candidate)) {
      return candidate;
    }
  }
  return source[index];
}

function tokenize(source) {
  if (typeof source !== 'string') return result('inconclusive', 'python-source-not-text', 'Python source is not text.');
  if (source.length > PYTHON_LITERAL_LIMITS.sourceCharacters) {
    return result('inconclusive', 'python-source-budget', `Python source exceeds the ${PYTHON_LITERAL_LIMITS.sourceCharacters}-character parser budget.`);
  }

  const tokens = [];
  const brackets = [];
  let cursor = 0;
  let statement = 0;
  let logicalStart = true;
  let lineIndent = 0;
  let atLineStart = true;

  const push = (value, type = 'operator') => {
    if (tokens.length >= PYTHON_LITERAL_LIMITS.tokens) throw new Error('python-token-budget');
    tokens.push({ value, type, statement, statementStart: logicalStart && lineIndent === 0 && brackets.length === 0 });
    logicalStart = false;
  };

  try {
    while (cursor < source.length) {
      const char = source[cursor];
      if (cursor === 0 && char === '\uFEFF') {
        cursor++;
        continue;
      }
      if (char === ' ' || char === '\t' || char === '\f') {
        if (atLineStart) lineIndent++;
        cursor++;
        continue;
      }
      if (char === '\r' || char === '\n') {
        if (char === '\r' && source[cursor + 1] === '\n') cursor++;
        cursor++;
        atLineStart = true;
        lineIndent = 0;
        if (brackets.length === 0) {
          statement++;
          logicalStart = true;
        }
        continue;
      }
      atLineStart = false;
      if (char === '#') {
        while (cursor < source.length && source[cursor] !== '\n' && source[cursor] !== '\r') cursor++;
        continue;
      }
      if (char === '\\' && (source[cursor + 1] === '\n' || source[cursor + 1] === '\r')) {
        cursor++;
        if (source[cursor] === '\r' && source[cursor + 1] === '\n') cursor++;
        cursor++;
        atLineStart = true;
        lineIndent = 0;
        continue;
      }
      const stringEnd = consumeString(source, cursor);
      if (stringEnd !== null) {
        if (stringEnd < 0) return result('inconclusive', 'python-unterminated-string', 'Python source contains an unterminated string.');
        push('<string>', 'atom');
        cursor = stringEnd;
        continue;
      }
      if (/[A-Za-z_]/.test(char)) {
        let end = cursor + 1;
        while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end++;
        push(source.slice(cursor, end), 'name');
        cursor = end;
        continue;
      }
      if (OPEN_TO_CLOSE.has(char)) {
        push(char, 'punctuation');
        brackets.push(char);
        if (brackets.length > PYTHON_LITERAL_LIMITS.nesting) throw new Error('python-nesting-budget');
        cursor++;
        continue;
      }
      if (CLOSE_TO_OPEN.has(char)) {
        if (brackets.pop() !== CLOSE_TO_OPEN.get(char)) return result('inconclusive', 'python-unbalanced-brackets', 'Python source contains unbalanced brackets.');
        push(char, 'punctuation');
        cursor++;
        continue;
      }
      if (char === ';' && brackets.length === 0) {
        statement++;
        logicalStart = true;
        cursor++;
        continue;
      }
      if (char === ',' || char === ':') {
        push(char, 'punctuation');
        cursor++;
        continue;
      }
      if (/[-+*/%@&|^<>=!~.]/.test(char)) {
        const operator = operatorAt(source, cursor);
        push(operator);
        cursor += operator.length;
        continue;
      }
      let end = cursor + 1;
      while (end < source.length && !/[\s#'"A-Za-z_\[\](){};,:\\\-+*/%@&|^<>=!~.]/.test(source[end])) end++;
      push(source.slice(cursor, end), 'atom');
      cursor = end;
    }
  } catch (error) {
    if (error.message === 'python-token-budget') {
      return result('inconclusive', error.message, `Python source exceeds the ${PYTHON_LITERAL_LIMITS.tokens}-token parser budget.`);
    }
    if (error.message === 'python-nesting-budget') {
      return result('unsupported', error.message, `Python literal exceeds the ${PYTHON_LITERAL_LIMITS.nesting}-level nesting budget.`);
    }
    throw error;
  }
  if (brackets.length) return result('inconclusive', 'python-unbalanced-brackets', 'Python source contains unbalanced brackets.');
  return result('ok', 'python-tokenized', 'Python source tokenized.', { tokens });
}

function assignmentOperatorIndex(tokens) {
  const stack = [];
  for (let index = 1; index < tokens.length; index++) {
    const token = tokens[index].value;
    if (OPEN_TO_CLOSE.has(token)) stack.push(token);
    else if (CLOSE_TO_OPEN.has(token)) stack.pop();
    else if (stack.length === 0 && ASSIGNMENT_OPERATORS.has(token)) return index;
  }
  return -1;
}

function countEntries(tokens, opener) {
  if (!tokens.length) return result('ok', 'python-literal-counted', 'Python container literal counted.', { value: 0 });
  const stack = [];
  let entries = 0;
  let segmentHasToken = false;
  let segmentStartsWithUnpack = false;
  let sawTopLevelComma = false;

  for (const token of tokens) {
    const value = token.value;
    if (OPEN_TO_CLOSE.has(value)) {
      stack.push(value);
      segmentHasToken = true;
      continue;
    }
    if (CLOSE_TO_OPEN.has(value)) {
      if (stack.pop() !== CLOSE_TO_OPEN.get(value)) return result('inconclusive', 'python-unbalanced-literal', 'Python literal contains unbalanced brackets.');
      segmentHasToken = true;
      continue;
    }
    if (stack.length > 0) {
      segmentHasToken = true;
      continue;
    }
    if (value === 'for' || value === 'lambda') {
      return result('unsupported', 'python-dynamic-literal', 'Python comprehensions and lambda expressions are unsupported evidence sources.');
    }
    if (!segmentHasToken && (value === '*' || value === '**')) segmentStartsWithUnpack = true;
    if (segmentStartsWithUnpack) return result('unsupported', 'python-unpacked-literal', 'Python literal unpacking is unsupported evidence syntax.');
    if (value === ',') {
      if (!segmentHasToken) return result('inconclusive', 'python-empty-literal-entry', 'Python literal contains an empty entry.');
      entries++;
      if (entries > PYTHON_LITERAL_LIMITS.entries) {
        return result('unsupported', 'python-entry-budget', `Python literal exceeds the ${PYTHON_LITERAL_LIMITS.entries}-entry budget.`);
      }
      segmentHasToken = false;
      segmentStartsWithUnpack = false;
      sawTopLevelComma = true;
      continue;
    }
    segmentHasToken = true;
  }
  if (stack.length) return result('inconclusive', 'python-unbalanced-literal', 'Python literal contains unbalanced brackets.');
  if (segmentHasToken) entries++;
  if (opener === '(' && entries > 0 && !sawTopLevelComma) {
    return result('unsupported', 'python-not-tuple-literal', 'Parenthesized Python expressions require a trailing comma to be tuple evidence.');
  }
  if (entries > PYTHON_LITERAL_LIMITS.entries) {
    return result('unsupported', 'python-entry-budget', `Python literal exceeds the ${PYTHON_LITERAL_LIMITS.entries}-entry budget.`);
  }
  return result('ok', 'python-literal-counted', 'Python container literal counted.', { value: entries });
}

function inspectAssignment(tokens) {
  const operatorIndex = assignmentOperatorIndex(tokens);
  if (operatorIndex < 0) return null;
  if (tokens[operatorIndex].value !== '=') {
    return result('unsupported', 'python-augmented-assignment', 'Python evidence symbol uses an unsupported assignment operator.');
  }
  const left = tokens.slice(1, operatorIndex);
  if (left.length && (left[0].value !== ':' || left.length === 1)) {
    return result('unsupported', 'python-assignment-target', 'Python evidence must assign directly to one module-level symbol.');
  }
  const right = tokens.slice(operatorIndex + 1);
  const opener = right[0]?.value;
  if (!OPEN_TO_CLOSE.has(opener)) {
    return result('unsupported', 'python-nonliteral-assignment', 'Python evidence symbol must be assigned a list, tuple, set, or dictionary literal.');
  }
  const stack = [];
  let closingIndex = -1;
  for (let index = 0; index < right.length; index++) {
    const value = right[index].value;
    if (OPEN_TO_CLOSE.has(value)) stack.push(value);
    else if (CLOSE_TO_OPEN.has(value)) {
      if (stack.pop() !== CLOSE_TO_OPEN.get(value)) return result('inconclusive', 'python-unbalanced-literal', 'Python literal contains unbalanced brackets.');
      if (stack.length === 0) {
        closingIndex = index;
        break;
      }
    }
  }
  if (closingIndex < 0) return result('inconclusive', 'python-unbalanced-literal', 'Python literal is not closed.');
  if (closingIndex !== right.length - 1) {
    return result('unsupported', 'python-trailing-expression', 'Python evidence literal has a chained, conditional, or concatenated expression.');
  }
  return countEntries(right.slice(1, closingIndex), opener);
}

/** Count entries in one uniquely assigned module-level Python container literal. */
export function countPythonLiteralEntries(source, symbol) {
  if (!PYTHON_SYMBOL_RE.test(symbol || '')) {
    return result('unsupported', 'python-symbol-unsupported', 'Python evidence symbol must be an ASCII identifier containing at most 128 characters.');
  }
  const scanned = tokenize(source);
  if (scanned.status !== 'ok') return scanned;
  const statements = new Map();
  for (const token of scanned.tokens) {
    if (!statements.has(token.statement)) statements.set(token.statement, []);
    statements.get(token.statement).push(token);
  }
  const assignments = [];
  for (const tokens of statements.values()) {
    if (!tokens[0]?.statementStart || tokens[0].type !== 'name' || tokens[0].value !== symbol) continue;
    const inspected = inspectAssignment(tokens);
    if (inspected) assignments.push(inspected);
  }
  if (assignments.length === 0) {
    return result('inconclusive', 'python-symbol-unassigned', `Python symbol ${symbol} has no supported module-level assignment.`);
  }
  if (assignments.length !== 1) {
    return result('inconclusive', 'python-symbol-ambiguous', `Python symbol ${symbol} has multiple module-level assignments.`);
  }
  return assignments[0];
}
