/**
 * Combine the guard verdict and optional CI policy into one readiness result.
 * @implements docguard.adoption-workflow-integrity#FR-009 {scope=symbol}
 *
 * Structural maturity remains an independent 0-100 measure. It can explain
 * the quality of the documentation system, but it cannot override a failed
 * guard check or a configured CI gate.
 */
export function buildReadinessAssessment(guardData, scoreData, options = {}) {
  const blockingFindings = finiteCount(guardData?.effectiveErrors, guardData?.errors);
  const advisoryFindings = finiteCount(guardData?.effectiveWarnings, guardData?.warnings);
  const guardStatus = normalizeGuardStatus(guardData?.status, blockingFindings, advisoryFindings);

  const threshold = Number.isFinite(options.threshold) ? options.threshold : null;
  const thresholdConfigured = options.thresholdConfigured ?? (threshold !== null && threshold > 0);
  const thresholdMet = thresholdConfigured
    ? Boolean(options.thresholdMet ?? (threshold !== null && scoreData.score >= threshold))
    : true;
  const warningsBlockCI = Boolean(options.failOnWarning) && guardStatus === 'WARN';
  // docguard.verdict-contract#FR-011: a check that could not decide blocks
  // only when the pipeline asked for every check to decide.
  const undecided = (guardData?.validators || []).filter(v => v.verdict === 'inconclusive' || v.verdict === 'blocked');
  const inconclusiveBlocksCI = Boolean(options.failOnInconclusive) && undecided.length > 0;

  const reasons = [];
  if (guardStatus === 'FAIL') reasons.push('GUARD_FAILED');
  if (guardStatus === 'UNKNOWN') reasons.push('GUARD_STATUS_UNKNOWN');
  if (!thresholdMet) reasons.push('CI_THRESHOLD_NOT_MET');
  if (warningsBlockCI) reasons.push('CI_WARNINGS_BLOCKED');
  else if (guardStatus === 'WARN') reasons.push('GUARD_WARNINGS');
  if (inconclusiveBlocksCI) reasons.push('CI_INCONCLUSIVE_BLOCKED');

  let status;
  if (guardStatus === 'FAIL' || guardStatus === 'UNKNOWN' || !thresholdMet || warningsBlockCI || inconclusiveBlocksCI) status = 'BLOCKED';
  else if (guardStatus === 'WARN') status = 'ATTENTION';
  else status = 'READY';

  const assessment = {
    status,
    reasons,
    guardStatus,
    blockingFindings,
    advisoryFindings,
    ...(inconclusiveBlocksCI ? { undecidedChecks: undecided.map(v => ({ key: v.key, verdict: v.verdict, reason: v.applicability?.reason || null })) } : {}),
    structuralMaturity: {
      score: scoreData.score,
      grade: scoreData.grade,
      scoreKind: scoreData.scoreKind || 'structural-maturity',
    },
    threshold: {
      configured: thresholdConfigured,
      value: thresholdConfigured ? threshold : null,
      met: thresholdMet,
    },
  };

  return { ...assessment, summary: summarizeAssessment(assessment) };
}

function finiteCount(primary, fallback) {
  if (Number.isFinite(primary)) return primary;
  return Number.isFinite(fallback) ? fallback : 0;
}

function normalizeGuardStatus(value, blockingFindings, advisoryFindings) {
  const status = typeof value === 'string' ? value.toUpperCase() : '';
  if (status === 'FAIL' || blockingFindings > 0) return 'FAIL';
  if (status === 'WARN' || advisoryFindings > 0) return 'WARN';
  if (status === 'PASS') return 'PASS';
  return 'UNKNOWN';
}

function summarizeAssessment(assessment) {
  const clauses = [];

  if (assessment.guardStatus === 'FAIL') {
    clauses.push(`guard failed with ${formatCount(assessment.blockingFindings, 'blocking finding')}`);
  } else if (assessment.guardStatus === 'UNKNOWN') {
    clauses.push('guard status is unavailable');
  } else if (assessment.reasons.includes('CI_WARNINGS_BLOCKED')) {
    clauses.push(`${formatCount(assessment.advisoryFindings, 'guard warning')} configured to block CI`);
  } else if (assessment.guardStatus === 'WARN') {
    clauses.push(`guard reported ${formatCount(assessment.advisoryFindings, 'advisory warning')}`);
  } else {
    clauses.push('guard passed');
  }

  if (assessment.reasons.includes('CI_INCONCLUSIVE_BLOCKED')) {
    clauses.push(`${formatCount(assessment.undecidedChecks.length, 'check')} could not decide (${assessment.undecidedChecks.map(c => c.key).join(', ')}), configured to block CI`);
  }

  if (assessment.reasons.includes('CI_THRESHOLD_NOT_MET')) {
    const threshold = assessment.threshold.value === null ? 'the configured value' : assessment.threshold.value;
    clauses.push(`Structural Maturity ${assessment.structuralMaturity.score}/100 is below CI threshold ${threshold}`);
  } else {
    clauses.push(`Structural Maturity is ${assessment.structuralMaturity.score}/100 (${assessment.structuralMaturity.grade})`);
  }

  return clauses.join('; ') + '.';
}

function formatCount(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
