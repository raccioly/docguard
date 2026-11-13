/**
 * Case-first baseline comparison. Aggregate warning totals never compensate
 * for a newly missed defect, false positive, or supported-case abstention.
 * @implements docguard.precision-evidence-loop#FR-009
 * @implements docguard.precision-evidence-loop#FR-010
 * @implements docguard.release-trend-gate#FR-006
 */

function difference(current = [], baseline = []) {
  const before = new Set(baseline);
  return current.filter(value => !before.has(value));
}

/**
 * @param {object} baseline reviewed core
 * @param {object} candidate current core
 * @param {{ selectedIds?: string[] }} [options] IDs the candidate run selected (split / external filters).
 *   A baseline case outside the selection was not run, so it is listed as `outOfSelection` rather than
 *   reported as removed; a case inside the selection that is absent from the candidate is still a removal.
 */
export function compareBenchmarkCores(baseline, candidate, { selectedIds = null } = {}) {
  if (!baseline || !candidate || baseline.schemaVersion !== candidate.schemaVersion) {
    throw new Error('Benchmark cores must use the same schema version.');
  }
  if (selectedIds !== null && (!Array.isArray(selectedIds) || selectedIds.some(id => typeof id !== 'string'))) {
    throw new Error('selectedIds must be an array of case IDs.');
  }
  const selected = selectedIds === null ? null : new Set(selectedIds);
  const previous = new Map((baseline.cases || []).map(item => [item.id, item]));
  const current = new Map((candidate.cases || []).map(item => [item.id, item]));
  const regressions = [];
  const outOfSelection = [];
  for (const [id, before] of previous) {
    if (selected && !selected.has(id)) {
      outOfSelection.push(id);
      continue;
    }
    const after = current.get(id);
    if (!after) {
      regressions.push({ id, kind: 'case-removed', detail: 'A baseline case is absent from the candidate.' });
      continue;
    }
    const definitionFields = ['sourceRevision', 'configDigest', 'classification', 'parserTier', 'scope', 'expected', 'forbidden'];
    const changedFields = definitionFields.filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
    if (changedFields.length) {
      regressions.push({
        id,
        kind: 'case-evidence-changed',
        fields: changedFields,
        detail: 'Reviewed source, configuration, classification, scope, or labels changed; adjudicate and replace the baseline explicitly.',
      });
    }
    for (const identity of difference(after.missing, before.missing)) {
      regressions.push({ id, kind: 'new-false-negative', identity });
    }
    for (const identity of difference(after.unexpected, before.unexpected)) {
      regressions.push({ id, kind: 'new-false-positive', identity });
    }
    if (!before.abstained && after.abstained && ['defect', 'clean_control'].includes(after.classification)) {
      regressions.push({ id, kind: 'new-supported-abstention' });
    }
    if (before.classification !== 'unsupported_syntax' && after.classification === 'unsupported_syntax') {
      regressions.push({ id, kind: 'new-unsupported-classification' });
    }
  }
  return {
    status: regressions.length ? 'FAIL' : 'PASS',
    regressions: regressions.sort(byRegression),
    addedCases: [...current.keys()].filter(id => !previous.has(id)).sort(),
    outOfSelection: outOfSelection.sort(),
  };
}

const byRegression = (a, b) => `${a.id}:${a.kind}:${a.identity || ''}`.localeCompare(`${b.id}:${b.kind}:${b.identity || ''}`);

/** `Benchmark-Rebaselined: <case id> — <reason>` lines; the separator is an em dash, en dash or hyphen. */
function parseRebaselineDeclarations(text = '') {
  const declarations = new Map();
  for (const match of String(text).matchAll(/^Benchmark-Rebaselined:[ \t]*(\S*)(.*)$/gm)) {
    const rest = match[2].trim().match(/^[\u2014\u2013-]{1,2}\s*(.*)$/);
    declarations.set(match[1], rest ? rest[1].trim() : '');
  }
  return declarations;
}

/**
 * A release's CHANGELOG section may declare that a case's reviewed evidence was
 * corrected on purpose. The declaration moves only that case's
 * `case-evidence-changed` regression into `rebaselined`; an outcome change for the
 * same case still fails, a declaration with nothing to acknowledge fails as stale,
 * and one without a reason fails. Pure: the input comparison is not modified.
 */
export function acknowledgeRebaselinedCases(comparison, text = '') {
  const declarations = parseRebaselineDeclarations(text);
  if (!declarations.size) return comparison;
  const regressions = [];
  const rebaselined = [];
  const used = new Set();
  for (const regression of comparison.regressions) {
    const reason = regression.kind === 'case-evidence-changed' ? declarations.get(regression.id) : undefined;
    if (reason) {
      used.add(regression.id);
      rebaselined.push({ id: regression.id, fields: regression.fields, reason });
    } else {
      regressions.push(regression);
    }
  }
  for (const [id, reason] of declarations) {
    if (!reason) {
      regressions.push({ id, kind: 'rebaseline-declaration-without-reason', detail: 'A Benchmark-Rebaselined line needs a reason after the case ID: "Benchmark-Rebaselined: <case id> \u2014 <reason>".' });
    } else if (!used.has(id)) {
      regressions.push({ id, kind: 'stale-rebaseline-declaration', detail: 'The release notes declare this case rebaselined, but it has no reviewed-evidence change against the baseline; remove the line.' });
    }
  }
  regressions.sort(byRegression);
  return {
    ...comparison,
    status: regressions.length ? 'FAIL' : 'PASS',
    regressions,
    rebaselined: rebaselined.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function compareRuntimeObservations(baseline, candidate) {
  if (JSON.stringify(baseline?.environment) !== JSON.stringify(candidate?.environment)) {
    return { comparable: false, reason: 'Runtime environments differ.', regressions: [] };
  }
  const baselineProtocol = baseline?.comparisonProtocol;
  const candidateProtocol = candidate?.comparisonProtocol;
  const controlled = baselineProtocol?.controlled === true
    && candidateProtocol?.controlled === true
    && baselineProtocol.sessionId
    && baselineProtocol.sessionId === candidateProtocol.sessionId
    && baselineProtocol.sampleCount >= 5
    && candidateProtocol.sampleCount >= 5;
  if (!controlled) {
    return {
      comparable: false,
      reason: 'Persisted runtime snapshots are observational; regression claims require at least five controlled samples from the same comparison session.',
      regressions: [],
    };
  }
  const previous = new Map((baseline.cases || []).map(item => [item.id, item]));
  const regressions = [];
  for (const item of candidate.cases || []) {
    const before = previous.get(item.id);
    if (!before) continue;
    for (const phase of ['coldMs', 'warmMs']) {
      if (before[phase] > 0 && item[phase] > before[phase] * 1.2) {
        regressions.push({ id: item.id, phase, baselineMs: before[phase], candidateMs: item[phase] });
      }
    }
  }
  return { comparable: true, regressions };
}
