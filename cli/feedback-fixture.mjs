/**
 * Strict, privacy-bounded feedback fixtures and deterministic reduction.
 * @implements docguard.precision-evidence-loop#FR-011
 * @implements docguard.precision-evidence-loop#FR-013
 * @implements docguard.precision-evidence-loop#FR-014
 * @implements docguard.precision-evidence-loop#FR-015
 * @implements docguard.precision-evidence-loop#FR-016
 */

import { createHash } from 'node:crypto';
import { extname, isAbsolute } from 'node:path';

export const FEEDBACK_SCHEMA_URL = 'https://raccioly.github.io/docguard/schemas/docguard-feedback-fixture.schema.json';
const CLASSIFICATIONS = new Set(['false_positive', 'false_negative', 'unsupported_syntax', 'ambiguous', 'policy_disagreement']);
const PARSER_TIERS = new Set(['js-ast', 'py-ast', 'regex-fallback', 'fallback-language', 'mixed', 'not-applicable']);
const PREDICATES = new Set(['finding_present', 'finding_absent', 'validator_unsupported']);
const ROOT_KEYS = new Set(['$schema', 'schemaVersion', 'classification', 'detector', 'parserTier', 'config', 'expectedIdentity', 'interestingness', 'fixture', 'oppositeControl', 'provenance', 'contribution']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function exactKeys(value, keys, label) {
  const unknown = Object.keys(value).filter(key => !keys.has(key));
  if (unknown.length) throw new Error(`${label} has unknown field(s): ${unknown.join(', ')}.`);
}

function safePath(value, label) {
  if (typeof value !== 'string' || !value || value.includes('\\') || isAbsolute(value)) throw new Error(`${label} must be a POSIX relative path.`);
  const parts = value.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || ['.git', '.local'].includes(part.toLowerCase()))) {
    throw new Error(`${label} enters a protected or escaping path.`);
  }
  return value;
}

function validateConfig(value, label = 'config', depth = 0) {
  if (depth > 6) throw new Error(`${label} is too deeply nested.`);
  if (value === null || typeof value === 'boolean' || Number.isFinite(value)) return;
  if (typeof value === 'string') {
    if (value.length > 10_000 || value.includes('\0') || isAbsolute(value) || /(?:^|[/\\])\.\.(?:[/\\]|$)/.test(value) || value.includes('.local') || value.includes('.git')) {
      throw new Error(`${label} contains an unsafe value.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error(`${label} is too large.`);
    value.forEach((item, index) => validateConfig(item, `${label}[${index}]`, depth + 1));
    return;
  }
  object(value, label);
  const keys = Object.keys(value);
  if (keys.length > 100 || keys.some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error(`${label} has unsafe keys.`);
  for (const key of keys) validateConfig(value[key], `${label}.${key}`, depth + 1);
}

function parseFiles(value, label) {
  const holder = object(value, label);
  exactKeys(holder, new Set(['files']), label);
  if (!Array.isArray(holder.files) || holder.files.length < 1 || holder.files.length > 16) throw new Error(`${label}.files requires 1-16 files.`);
  let bytes = 0;
  const seen = new Set();
  const files = holder.files.map((entry, index) => {
    object(entry, `${label}.files[${index}]`);
    exactKeys(entry, new Set(['path', 'content']), `${label}.files[${index}]`);
    const path = safePath(entry.path, `${label}.files[${index}].path`);
    if (seen.has(path)) throw new Error(`${label}.files contains duplicate path ${path}.`);
    seen.add(path);
    if (typeof entry.content !== 'string' || entry.content.includes('\0')) throw new Error(`${label}.files[${index}].content must be text.`);
    bytes += Buffer.byteLength(entry.content);
    return { path, content: entry.content };
  });
  if (bytes > 131_072) throw new Error(`${label} exceeds 128 KiB.`);
  return { files };
}

function parseContribution(value) {
  if (value === undefined) return null;
  const contribution = object(value, 'contribution');
  exactKeys(contribution, new Set(['testOnly', 'scopeDocumented', 'benchmarkDelta']), 'contribution');
  const delta = object(contribution.benchmarkDelta, 'contribution.benchmarkDelta');
  exactKeys(delta, new Set(['falsePositives', 'falseNegatives', 'unsupportedCases', 'abstainedSupportedCases']), 'contribution.benchmarkDelta');
  for (const [key, count] of Object.entries(delta)) {
    if (!Number.isInteger(count) || count < 0) throw new Error(`contribution.benchmarkDelta.${key} must be a non-negative integer.`);
  }
  return { testOnly: contribution.testOnly === true, scopeDocumented: contribution.scopeDocumented === true, benchmarkDelta: delta };
}

export function parseFeedbackFixture(value) {
  const root = object(value, 'feedback fixture');
  exactKeys(root, ROOT_KEYS, 'feedback fixture');
  if (root.$schema !== FEEDBACK_SCHEMA_URL || root.schemaVersion !== 1) throw new Error('Feedback fixture uses an unsupported schema contract.');
  if (!CLASSIFICATIONS.has(root.classification)) throw new Error('feedback fixture classification is invalid.');
  if (!PARSER_TIERS.has(root.parserTier)) throw new Error('feedback fixture parserTier is invalid.');
  const detector = object(root.detector, 'detector');
  exactKeys(detector, new Set(['code', 'validator']), 'detector');
  if (!/^[A-Z]{3}\d{3}$/.test(detector.code) || !/^[A-Za-z][A-Za-z0-9]{1,63}$/.test(detector.validator)) throw new Error('detector code or validator is invalid.');
  const match = String(root.expectedIdentity || '').match(/^([A-Z]{3}\d{3})@(.+)$/);
  if (!match || match[1] !== detector.code) throw new Error('expectedIdentity must use the detector code.');
  const expectedPath = safePath(match[2], 'expectedIdentity path');
  const interestingness = object(root.interestingness, 'interestingness');
  exactKeys(interestingness, new Set(['predicate']), 'interestingness');
  if (!PREDICATES.has(interestingness.predicate)) throw new Error('interestingness.predicate is invalid.');
  const fixture = parseFiles(root.fixture, 'fixture');
  const oppositeControl = parseFiles(root.oppositeControl, 'oppositeControl');
  const fixturePaths = fixture.files.map(file => file.path).sort();
  const controlPaths = oppositeControl.files.map(file => file.path).sort();
  if (JSON.stringify(fixturePaths) !== JSON.stringify(controlPaths) || !fixturePaths.includes(expectedPath)) {
    throw new Error('fixture and oppositeControl must share paths and include the expectedIdentity path.');
  }
  const provenance = object(root.provenance, 'provenance');
  exactKeys(provenance, new Set(['synthetic', 'redactionAttested']), 'provenance');
  if (provenance.synthetic !== true || provenance.redactionAttested !== true) throw new Error('Synthetic provenance and reviewed redaction must both be attested.');
  validateConfig(root.config);
  return {
    $schema: FEEDBACK_SCHEMA_URL, schemaVersion: 1, classification: root.classification,
    detector: { code: detector.code, validator: detector.validator }, parserTier: root.parserTier,
    config: root.config, expectedIdentity: `${detector.code}@${expectedPath}`,
    interestingness: { predicate: interestingness.predicate }, fixture, oppositeControl,
    provenance: { synthetic: true, redactionAttested: true }, contribution: parseContribution(root.contribution),
  };
}

function shape(files) {
  return files.map(file => {
    const normalized = file.content
      .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, ' STRING ')
      .replace(/\b\d+(?:\.\d+)?\b/g, ' NUMBER ')
      .replace(/\b[A-Za-z_$][\w$]*\b/g, ' ID ')
      .replace(/\s+/g, ' ').trim();
    return `${extname(file.path).toLowerCase()}:${normalized}`;
  }).sort().join('|');
}

export function feedbackDuplicateIdentity(manifest) {
  const input = [manifest.detector.code, manifest.classification, manifest.parserTier, shape(manifest.fixture.files)].join('|');
  return `dgf-${createHash('sha256').update(input).digest('hex').slice(0, 16)}`;
}

export function feedbackFindingIdentity(finding) {
  const raw = typeof finding.location === 'string' ? finding.location : finding.location?.file || '<project>';
  return `${finding.code}@${raw.replace(/:\d+(?::\d+)?$/, '').replaceAll('\\', '/')}`;
}

export function feedbackSearchUrls(manifest, issuesBase = 'https://github.com/raccioly/docguard/issues') {
  const repository = issuesBase.replace(/^https:\/\/github\.com\//, '').replace(/\/issues.*$/, '');
  const identity = feedbackDuplicateIdentity(manifest);
  const build = state => `https://github.com/search?q=${encodeURIComponent(`repo:${repository} "${identity}" state:${state}`)}&type=issues`;
  return { identity, all: build('open').replace(encodeURIComponent(' state:open'), ''), open: build('open'), closed: build('closed') };
}

export function reduceFixtureDeterministically(manifest, interesting, maxAttempts = 100) {
  let current = structuredClone(manifest);
  let attempts = 0;
  if (!interesting(current)) return { status: 'NOT_REPRODUCED', attempts, manifest: current };
  for (let fileIndex = 0; fileIndex < current.fixture.files.length && attempts < maxAttempts; fileIndex++) {
    let changed = true;
    while (changed && attempts < maxAttempts) {
      changed = false;
      const lines = current.fixture.files[fileIndex].content.split('\n');
      if (lines.length <= 1) break;
      for (let line = 0; line < lines.length && attempts < maxAttempts; line++) {
        const candidate = structuredClone(current);
        candidate.fixture.files[fileIndex].content = lines.filter((_, index) => index !== line).join('\n');
        attempts++;
        if (interesting(candidate)) { current = candidate; changed = true; break; }
      }
    }
  }
  return { status: attempts >= maxAttempts ? 'REDUCED_LIMIT' : 'REDUCED', attempts, manifest: current };
}

export function assertContributionReady(manifest) {
  if (!['false_positive', 'false_negative', 'unsupported_syntax'].includes(manifest.classification)) {
    throw new Error('Ambiguous and policy-disagreement fixtures require adjudication before a test contribution.');
  }
  if (!manifest.contribution?.testOnly || !manifest.contribution.scopeDocumented) {
    throw new Error('Contribution requires testOnly and scopeDocumented attestations plus benchmarkDelta.');
  }
  return true;
}

export function buildTestOnlyContribution(manifest) {
  assertContributionReady(manifest);
  const encoded = JSON.stringify(manifest);
  return `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';\nimport { dirname, join } from 'node:path';\nimport { tmpdir } from 'node:os';\nimport { runGuardInternal } from '../cli/commands/guard.mjs';\nimport { feedbackFindingIdentity } from '../cli/feedback-fixture.mjs';\n\nconst manifest = ${encoded};\nfunction run(files) {\n  const root = mkdtempSync(join(tmpdir(), 'docguard-contribution-'));\n  try {\n    for (const file of files) { const target = join(root, file.path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, file.content); }\n    return runGuardInternal(root, manifest.config);\n  } finally { rmSync(root, { recursive: true, force: true }); }\n}\n\ntest('${manifest.detector.code} ${manifest.classification} synthetic reproduction (${feedbackDuplicateIdentity(manifest)})', () => {\n  const fixture = run(manifest.fixture.files);\n  const control = run(manifest.oppositeControl.files);\n  const fixtureHas = fixture.findings.some(finding => feedbackFindingIdentity(finding) === manifest.expectedIdentity);\n  const controlHas = control.findings.some(finding => feedbackFindingIdentity(finding) === manifest.expectedIdentity);\n  const fixtureApplicability = fixture.validators.find(item => item.key === manifest.detector.validator)?.applicability?.status;\n  const controlApplicability = control.validators.find(item => item.key === manifest.detector.validator)?.applicability?.status;\n  ${manifest.classification === 'false_positive' ? 'assert.equal(fixtureHas, false); assert.equal(controlHas, true);' : manifest.classification === 'false_negative' ? 'assert.equal(fixtureHas, true); assert.equal(controlHas, false);' : `assert.notEqual(fixtureApplicability, 'unsupported'); assert.equal(controlApplicability, 'checked'); assert.equal(controlHas, false);`}\n});\n`;
}
