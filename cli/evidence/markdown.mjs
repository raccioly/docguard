/**
 * Exact, heading-scoped Markdown statement selection.
 * @implements docguard.evidence-scoped-verification#FR-006
 */

function normalizeHorizontal(value) {
  return String(value).replace(/[ \t]+/g, ' ').trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[ \t]+/g, '[ \\t]+');
}

function visibleLines(content) {
  const lines = String(content).split(/\r?\n/);
  let fence = null;
  return lines.map((text, index) => {
    const marker = text.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      const char = marker[1][0];
      if (!fence) fence = { char, length: marker[1].length };
      else if (fence.char === char && marker[1].length >= fence.length) fence = null;
      return { line: index + 1, text: '', hidden: true };
    }
    return { line: index + 1, text: fence ? '' : text, hidden: Boolean(fence) };
  });
}

function headings(lines) {
  const out = [];
  for (const row of lines) {
    const match = row.text.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (match) out.push({ level: match[1].length, text: normalizeHorizontal(match[2]), line: row.line });
  }
  return out;
}

export function selectMarkdownStatement(content, target, predicateKind) {
  const lines = visibleLines(content);
  const foundHeadings = headings(lines).filter(item => item.text === normalizeHorizontal(target.heading));
  if (foundHeadings.length === 0) return { status: 'inconclusive', reasonCode: 'heading-missing', message: `Heading “${target.heading}” was not found.` };
  if (foundHeadings.length > 1) return { status: 'inconclusive', reasonCode: 'heading-ambiguous', message: `Heading “${target.heading}” is not unique.` };
  const heading = foundHeadings[0];
  const allHeadings = headings(lines);
  const next = allHeadings.find(item => item.line > heading.line && item.level <= heading.level);
  const section = lines.filter(row => row.line > heading.line && (!next || row.line < next.line));
  const valueMode = predicateKind !== 'no-findings';
  const pieces = target.statement.split('{{value}}');
  const pattern = valueMode
    ? `${escapeRegex(pieces[0])}(.+?)${escapeRegex(pieces[1])}`
    : escapeRegex(target.statement);
  const matcher = new RegExp(pattern, 'g');
  const matches = [];
  for (const row of section) {
    const normalized = normalizeHorizontal(row.text);
    if (!normalized) continue;
    matcher.lastIndex = 0;
    let match;
    while ((match = matcher.exec(normalized))) {
      matches.push({ line: row.line, statement: normalizeHorizontal(match[0]), value: valueMode ? normalizeHorizontal(match[1]) : null });
      if (!match[0]) matcher.lastIndex++;
    }
  }
  if (matches.length === 0) return { status: 'inconclusive', reasonCode: 'statement-missing', message: 'The declared statement was not found in the selected heading.' };
  if (matches.length > 1) return { status: 'inconclusive', reasonCode: 'statement-ambiguous', message: 'The declared statement is not unique in the selected heading.' };
  return { status: 'ok', reasonCode: 'statement-selected', message: 'Markdown statement selected.', ...matches[0] };
}

export function parseDocumentValue(raw, predicate) {
  if (predicate.kind === 'count-equals') {
    if (!/^(?:0|[1-9][0-9]*)$/.test(raw)) return { ok: false, reasonCode: 'invalid-count', message: 'Document value is not a non-negative base-ten integer.' };
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) return { ok: false, reasonCode: 'unsafe-count', message: 'Document count exceeds the safe integer range.' };
    return { ok: true, value };
  }
  if (predicate.kind === 'set-equals') {
    const values = raw.split(predicate.separator).map(item => item.trim());
    if (values.some(item => !item)) return { ok: false, reasonCode: 'empty-set-item', message: 'Document set contains an empty item.' };
    if (new Set(values).size !== values.length) return { ok: false, reasonCode: 'duplicate-set-item', message: 'Document set contains duplicate items.' };
    return { ok: true, value: values };
  }
  if (predicate.valueType === 'string') return { ok: true, value: raw };
  if (predicate.valueType === 'number') {
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(raw)) return { ok: false, reasonCode: 'invalid-number', message: 'Document value is not a canonical JSON number.' };
    const value = Number(raw);
    if (!Number.isFinite(value)) return { ok: false, reasonCode: 'non-finite-number', message: 'Document number is not finite.' };
    return { ok: true, value };
  }
  if (predicate.valueType === 'boolean') {
    if (raw !== 'true' && raw !== 'false') return { ok: false, reasonCode: 'invalid-boolean', message: 'Document value must be true or false.' };
    return { ok: true, value: raw === 'true' };
  }
  if (predicate.valueType === 'null') {
    if (raw !== 'null') return { ok: false, reasonCode: 'invalid-null', message: 'Document value must be null.' };
    return { ok: true, value: null };
  }
  return { ok: false, reasonCode: 'unsupported-value-type', message: 'Predicate value type is unsupported.' };
}
