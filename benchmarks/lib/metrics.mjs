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
    defectCases: 0, cleanControlCases: 0, cleanControlCasesWithFindings: 0,
    repairs: { accepted: 0, rejected: 0, notEvaluated: 0 },
    // Adjudicated disagreements: a user challenged a finding, the maintainers
    // reviewed it, and the detector was left as designed. Counted, never
    // folded into a ratio (FR-003 keeps them out of every denominator).
    //
    // Both directions would be dishonest. Scoring one as a false positive
    // would let a user who dislikes a rule drive its measured precision down;
    // scoring it as a true positive would let a maintainer launder
    // disagreement into validation. Neither is a measurement. What was wrong
    // before is that the disagreement simply VANISHED — the corpus could only
    // ever record a false positive that had already been fixed, so precision
    // 1.0 was the pipeline's fixed point rather than an observation.
    adjudicated: { policyDisagreements: 0, ambiguous: 0 },
  };
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(6));
}

export function wilsonInterval(successes, total, z = 1.96) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total < 0 || successes < 0 || successes > total) {
    throw new Error('Wilson interval requires integer successes within a non-negative total.');
  }
  if (total === 0) return null;
  const probability = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (probability + z2 / (2 * total)) / denominator;
  const margin = z * Math.sqrt((probability * (1 - probability) + z2 / (4 * total)) / total) / denominator;
  return { lower: Number(Math.max(0, center - margin).toFixed(6)), upper: Number(Math.min(1, center + margin).toFixed(6)) };
}

function finalize(counts, repositories) {
  const precisionDenominator = counts.truePositives + counts.falsePositives;
  const recallDenominator = counts.truePositives + counts.falseNegatives;
  const repairDenominator = counts.repairs.accepted + counts.repairs.rejected;
  const cleanAccuracy = wilsonInterval(counts.cleanControlCases - counts.cleanControlCasesWithFindings, counts.cleanControlCases);
  return {
    ...counts,
    repositories: repositories.size,
    precision: ratio(counts.truePositives, precisionDenominator),
    recall: ratio(counts.truePositives, recallDenominator),
    falsePositivesPerRepository: ratio(counts.falsePositives, repositories.size),
    abstentionRate: ratio(counts.abstainedSupportedCases, counts.cases),
    unsupportedRate: ratio(counts.unsupportedCases, counts.cases + counts.unsupportedCases),
    acceptedRepairRate: ratio(counts.repairs.accepted, repairDenominator),
    confidence95: {
      method: 'Wilson score interval, z=1.96',
      precision: wilsonInterval(counts.truePositives, precisionDenominator),
      recall: wilsonInterval(counts.truePositives, recallDenominator),
      falsePositiveCaseRate: cleanAccuracy ? {
        lower: Number((1 - cleanAccuracy.upper).toFixed(6)),
        upper: Number((1 - cleanAccuracy.lower).toFixed(6)),
      } : null,
      acceptedRepairRate: wilsonInterval(counts.repairs.accepted, repairDenominator),
    },
  };
}

function summarize(cases) {
  const counts = emptyCounts();
  const repositories = new Set();
  for (const item of cases) {
    if (item.classification === 'unsupported_syntax') counts.unsupportedCases++;
    if (item.classification === 'policy_disagreement') counts.adjudicated.policyDisagreements++;
    if (item.classification === 'ambiguous') counts.adjudicated.ambiguous++;
    if (!measured(item)) continue;
    counts.cases++;
    repositories.add(item.repositoryGroup);
    if (item.classification === 'defect') counts.defectCases++;
    if (item.classification === 'clean_control') {
      counts.cleanControlCases++;
      if (item.unexpected.length > 0) counts.cleanControlCasesWithFindings++;
    }
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
