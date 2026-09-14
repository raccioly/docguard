/**
 * Null-safe benchmark metrics. Counts are facts; ratios are null when the
 * corpus has no evidence for their denominator.
 * @implements docguard.precision-evidence-loop#FR-007
 */

const measured = item => ['defect', 'clean_control'].includes(item.classification);

function emptyCounts() {
  return {
    cases: 0, repositories: 0, truePositives: 0, falsePositives: 0,
    falseNegatives: 0, abstainedSupportedCases: 0, unsupportedCases: 0,
    repairs: { accepted: 0, rejected: 0, notEvaluated: 0 },
  };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(6));
}

function finalize(counts, repositories) {
  const precisionDenominator = counts.truePositives + counts.falsePositives;
  const recallDenominator = counts.truePositives + counts.falseNegatives;
  return {
    ...counts,
    repositories: repositories.size,
    precision: ratio(counts.truePositives, precisionDenominator),
    recall: ratio(counts.truePositives, recallDenominator),
    falsePositivesPerRepository: ratio(counts.falsePositives, repositories.size),
    abstentionRate: ratio(counts.abstainedSupportedCases, counts.cases),
    unsupportedRate: ratio(counts.unsupportedCases, counts.cases + counts.unsupportedCases),
    acceptedRepairRate: ratio(counts.repairs.accepted, counts.repairs.accepted + counts.repairs.rejected),
  };
}

function summarize(cases) {
  const counts = emptyCounts();
  const repositories = new Set();
  for (const item of cases) {
    if (item.classification === 'unsupported_syntax') counts.unsupportedCases++;
    if (!measured(item)) continue;
    counts.cases++;
    repositories.add(item.repositoryGroup);
    counts.truePositives += item.actual.filter(identity => item.expected.includes(identity)).length;
    counts.falsePositives += item.unexpected.length;
    counts.falseNegatives += item.missing.length;
    if (item.abstained) counts.abstainedSupportedCases++;
    if (item.repairOutcome === 'accepted') counts.repairs.accepted++;
    else if (item.repairOutcome === 'rejected') counts.repairs.rejected++;
    else counts.repairs.notEvaluated++;
  }
  return finalize(counts, repositories);
}

function grouped(cases, key) {
  const groups = new Map();
  for (const item of cases) {
    const value = key(item);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  }
  return Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, items]) => [name, summarize(items)]));
}

export function calculateMetrics(cases) {
  const normalized = cases.map(item => ({ ...item, repairOutcome: item.repairOutcome || 'not_evaluated' }));
  return {
    aggregate: summarize(normalized),
    byRepository: grouped(normalized, item => item.repositoryGroup),
    byDetector: grouped(normalized, item => item.scope.validatorKey),
    byParserTier: grouped(normalized, item => item.parserTier),
  };
}
