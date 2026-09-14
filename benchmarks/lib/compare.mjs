/**
 * Case-first baseline comparison. Aggregate warning totals never compensate
 * for a newly missed defect, false positive, or supported-case abstention.
 * @implements docguard.precision-evidence-loop#FR-009
 * @implements docguard.precision-evidence-loop#FR-010
 */

function difference(current = [], baseline = []) {
  const before = new Set(baseline);
  return current.filter(value => !before.has(value));
}

export function compareBenchmarkCores(baseline, candidate) {
  if (!baseline || !candidate || baseline.schemaVersion !== candidate.schemaVersion) {
    throw new Error('Benchmark cores must use the same schema version.');
  }
  const previous = new Map((baseline.cases || []).map(item => [item.id, item]));
  const current = new Map((candidate.cases || []).map(item => [item.id, item]));
  const regressions = [];
  for (const [id, before] of previous) {
    const after = current.get(id);
    if (!after) {
      regressions.push({ id, kind: 'case-removed', detail: 'A baseline case is absent from the candidate.' });
      continue;
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
    regressions: regressions.sort((a, b) => `${a.id}:${a.kind}:${a.identity || ''}`.localeCompare(`${b.id}:${b.kind}:${b.identity || ''}`)),
    addedCases: [...current.keys()].filter(id => !previous.has(id)).sort(),
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
