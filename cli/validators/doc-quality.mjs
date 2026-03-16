/**
 * Doc Quality Validator — Measures documentation writing quality
 *
 * Implements 8 deterministic metrics inspired by IEEE 830/ISO 29148 and the
 * "understanding" project (github.com/Testimonial/understanding).
 * Credit: Metric formulas and weighting system inspired by the Understanding
 *         project's 31-metric quality framework for requirements quality.
 *
 * Metrics implemented:
 *   Structure:   Passive Voice Ratio, Ambiguous Pronoun Ratio, Atomicity Score
 *   Readability: Flesch Reading Ease, Flesch-Kincaid Grade Level
 *   Cognitive:   Sentence Length, Negation Load, Conditional Load
 *
 * v0.9.3 — Prose-Only Extraction Engine:
 *   Instead of stripping markdown and measuring residue (which treats table
 *   cells as "long sentences"), this version extracts ONLY actual prose
 *   paragraphs. Docs that are mostly tables/code skip readability scoring.
 *
 * Optional: If `understanding` CLI is installed, runs a full 31-metric deep scan.
 *
 * Zero dependencies — pure Node.js built-ins only.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { execSync } from 'node:child_process';

// ──── Metric Thresholds ────
// These define "good" vs "warning" boundaries for each metric.
// Values are based on IEEE 830 best practices and readability research.

const THRESHOLDS = {
  passiveVoiceRatio:     { warn: 0.25, label: 'Passive voice ratio' },       // >25% passive = warn
  ambiguousPronounRatio: { warn: 0.15, label: 'Ambiguous pronoun ratio' },   // >15% ambiguous pronouns = warn
  atomicityScore:        { warn: 0.35, label: 'Non-atomic sentence ratio' }, // >35% compound sentences = warn
  fleschReadingEase:     { warn: 5,    label: 'Flesch reading ease' },       // <5 = truly unreadable prose (tech docs typically score 10-30)
  fleschKincaidGrade:    { warn: 22,   label: 'Flesch-Kincaid grade' },      // >22 = PhD level+ (tech docs typically 14-20)
  avgSentenceLength:     { warn: 30,   label: 'Avg sentence length' },       // >30 words = too long
  negationLoad:          { warn: 0.20, label: 'Negation load' },             // >20% sentences with negation = warn
  conditionalLoad:       { warn: 0.30, label: 'Conditional load' },          // >30% sentences conditional = warn
};

// Minimum prose words required for readability scoring.
// Docs with less than this are reference docs (tables, code) — skip readability.
const MIN_PROSE_WORDS = 50;

// ──── Technical Vocabulary ────
// Terms the target audience knows. Treated as 2-syllable words for Flesch scoring
// so they don't artificially inflate difficulty.

const TECH_VOCAB = new Set([
  // Infrastructure & databases
  'dynamodb', 'redis', 'postgres', 'postgresql', 'mongodb', 'mysql', 'sqlite',
  'kubernetes', 'docker', 'dockerfile', 'nginx', 'apache', 'cloudfront',
  'cloudwatch', 'elasticsearch', 'opensearch', 'terraform', 'ansible',
  'memcached', 'cassandra', 'rabbitmq', 'kafka',
  // Frameworks & languages
  'typescript', 'javascript', 'python', 'fastify', 'express', 'nextjs',
  'webpack', 'vite', 'vitest', 'playwright', 'cypress', 'mocha',
  'nestjs', 'angular', 'svelte', 'nuxtjs', 'gatsby', 'remix',
  // Protocols & patterns
  'websocket', 'websockets', 'middleware', 'microservice', 'microservices',
  'graphql', 'restful', 'oauth', 'openapi', 'webhook', 'webhooks',
  'grpc', 'protobuf', 'pubsub',
  // AWS services
  'lambda', 'cognito', 'amplify', 'apprunner', 'cloudformation',
  'apigateway', 'secretsmanager', 'parameterstore', 'eventbridge',
  'fargate', 'elasticache', 'sagemaker',
  // Common developer terms
  'namespace', 'endpoint', 'endpoints', 'timestamp', 'timestamps',
  'boolean', 'callback', 'callbacks', 'codebase', 'monorepo',
  'frontend', 'backend', 'fullstack', 'changelog', 'localhost',
  'hostname', 'username', 'eslint', 'prettier', 'rollup',
  'authentication', 'authorization', 'infrastructure', 'serialization',
  'deserialization', 'middleware', 'polymorphism', 'abstraction',
]);

// ──── Prose Extraction Engine ────

/**
 * Extract only prose paragraphs from markdown content.
 *
 * Instead of stripping markdown and measuring residue (where table cells
 * become "146-word sentences"), this identifies actual prose — blocks of
 * text that form readable sentences — and returns only those.
 *
 * A line qualifies as prose if it:
 *   - Is not inside a code block / HTML comment
 *   - Is not a table row, header, horizontal rule, or metadata
 *   - Has ≥55% alphabetic characters (filters out paths/URLs/symbol-heavy lines)
 *   - Has ≥5 words (fragments aren't prose)
 */
function extractProse(content) {
  const lines = content.split('\n');
  const proseLines = [];
  let inCodeBlock = false;
  let inHtmlComment = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Track code block boundaries (``` and ````)
    if (/^`{3,}/.test(line)) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Track multi-line HTML comments
    if (line.includes('<!--') && !line.includes('-->')) {
      inHtmlComment = true;
      continue;
    }
    if (inHtmlComment) {
      if (line.includes('-->')) inHtmlComment = false;
      continue;
    }

    // Skip non-prose line types
    if (line.startsWith('|')) continue;                     // Table rows
    if (line.startsWith('#')) continue;                     // Headers
    if (line.startsWith('!')) continue;                     // Images
    if (/^[-*_]{3,}\s*$/.test(line)) continue;             // Horizontal rules
    if (/^[|:\-\s]+$/.test(line)) continue;                // Table separators
    if (/^<!--.*-->$/.test(line)) continue;                // Inline HTML comments
    if (/^<[^>]+>/.test(line)) continue;                   // HTML tags
    if (/^---\s*$/.test(line)) continue;                   // YAML frontmatter
    if (line.length === 0) continue;                        // Empty lines

    // Clean the line: extract text from markdown formatting
    let cleaned = line;
    cleaned = cleaned.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');   // Links → text only
    cleaned = cleaned.replace(/`[^`]+`/g, '');                     // Remove inline code
    cleaned = cleaned.replace(/!\[.*?\]\(.*?\)/g, '');             // Remove images
    cleaned = cleaned.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');   // Bold/italic → text
    cleaned = cleaned.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');     // Underline emphasis
    cleaned = cleaned.replace(/^[-*+]\s+/, '');                    // List markers
    cleaned = cleaned.replace(/^\d+\.\s+/, '');                    // Numbered list markers
    cleaned = cleaned.trim();

    if (cleaned.length < 15) continue;

    // Prose heuristic: check alphabetic ratio and word count
    const alphaCount = (cleaned.match(/[a-zA-Z]/g) || []).length;
    const alphaRatio = alphaCount / cleaned.length;
    const wordCount = cleaned.split(/\s+/).length;

    // A prose line needs ≥55% letters and ≥5 words
    if (alphaRatio >= 0.55 && wordCount >= 5) {
      proseLines.push(cleaned);
    }
  }

  return proseLines.join('\n');
}

/**
 * Split text into sentences with markdown-aware boundary detection.
 *
 * Protects against false splits from:
 *   - File paths (src/services/auth.ts → the dot isn't a sentence boundary)
 *   - Version numbers (v0.9.2, Node.js 18)
 *   - URLs (https://example.com)
 *   - Common abbreviations (e.g., i.e., etc., vs.)
 *   - Technical dotted names (package.json, .env.local)
 */
function splitSentences(text) {
  if (!text || text.trim().length === 0) return [];

  let protected_ = text;

  // Protect dotted filenames (package.json, .env.local, auth.ts)
  protected_ = protected_.replace(/[\w.-]+\.[a-z]{1,4}(?=[\s,;:)\]|]|$)/gi, (m) => m.replace(/\./g, '≈'));

  // Protect version numbers (v0.9.2, 1.2.3)
  protected_ = protected_.replace(/\bv?\d+\.\d+(?:\.\d+)*\b/g, (m) => m.replace(/\./g, '≈'));

  // Protect URLs
  protected_ = protected_.replace(/https?:\/\/[^\s)]+/g, (m) => m.replace(/\./g, '≈'));

  // Protect common abbreviations
  const abbreviations = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'vs', 'etc', 'approx', 'incl'];
  for (const abbr of abbreviations) {
    const regex = new RegExp(`\\b${abbr}\\.`, 'gi');
    protected_ = protected_.replace(regex, (m) => m.replace(/\./g, '≈'));
  }

  // Protect e.g. and i.e. specifically (have dots in the abbreviation itself)
  protected_ = protected_.replace(/\be\.g\./gi, 'e≈g≈');
  protected_ = protected_.replace(/\bi\.e\./gi, 'i≈e≈');

  // Protect Node.js, Vue.js, etc.
  protected_ = protected_.replace(/\b(\w+)\.js\b/gi, '$1≈js');

  // Protect decimal numbers (3.14)
  protected_ = protected_.replace(/(\d)\.(\d)/g, '$1≈$2');

  // Split on sentence-ending punctuation followed by whitespace/newline/end
  const raw = protected_.split(/[.!?]+(?:\s+|\n|$)/);

  // Restore protected characters and filter empties/fragments
  return raw
    .map(s => s.replace(/≈/g, '.').trim())
    .filter(s => {
      if (s.length < 10) return false;
      return s.split(/\s+/).length >= 3;  // At least 3 words
    });
}

/**
 * Count syllables with technical vocabulary normalization.
 *
 * Technical terms (DynamoDB, WebSocket, middleware) are normalized to
 * 2 syllables. The target audience knows these terms — they don't make
 * the text harder to read.
 */
function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 2) return 1;

  // Technical vocabulary → 2 syllables (known terms)
  if (TECH_VOCAB.has(word)) return 2;

  const exceptions = {
    'the': 1, 'are': 1, 'were': 1, 'have': 1, 'there': 1,
    'where': 1, 'here': 1, 'every': 3, 'everything': 4,
    'create': 2, 'file': 1, 'style': 1, 'quite': 1,
  };
  if (exceptions[word] !== undefined) return exceptions[word];

  // Count vowel groups
  const vowelGroups = word.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;

  // Subtract silent-e at end (but not -le, -ce, -ge)
  if (word.endsWith('e') && !word.endsWith('le') && !word.endsWith('ce') && !word.endsWith('ge')) {
    count--;
  }

  // Subtract for common past-tense endings
  if (word.endsWith('ed') && !word.endsWith('ted') && !word.endsWith('ded')) {
    count--;
  }

  return Math.max(1, count);
}

/**
 * Tokenize text into words. Strips punctuation, lowercases.
 */
function tokenizeWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
}

// ──── Metric Implementations ────

/**
 * Passive Voice Ratio (Structure, 4.5% weight in Understanding)
 *
 * Detects passive voice constructions: be-verb + past participle.
 * Pattern: (is|was|were|been|being|are|be) + word ending in -ed/-en/-t
 *
 * Returns ratio of sentences containing passive voice to total sentences.
 */
function measurePassiveVoice(sentences) {
  if (sentences.length === 0) return { ratio: 0, count: 0, total: 0 };

  const passivePattern = /\b(is|was|were|been|being|are|be|am)\s+([\w]+\s+)?([\w]*(?:ed|en|wn|lt|nt|pt|ft|zed))\b/i;

  let passiveCount = 0;
  for (const sentence of sentences) {
    if (passivePattern.test(sentence)) {
      passiveCount++;
    }
  }

  return {
    ratio: sentences.length > 0 ? passiveCount / sentences.length : 0,
    count: passiveCount,
    total: sentences.length,
  };
}

/**
 * Ambiguous Pronoun Ratio (Structure, 3.0% weight in Understanding)
 */
function measureAmbiguousPronouns(words) {
  if (words.length === 0) return { ratio: 0, count: 0, total: 0 };

  const ambiguousPronouns = new Set([
    'it', 'this', 'that', 'they', 'them', 'these', 'those',
    'its', 'their', 'theirs',
  ]);

  let ambiguousCount = 0;
  for (const word of words) {
    if (ambiguousPronouns.has(word.toLowerCase())) {
      ambiguousCount++;
    }
  }

  return {
    ratio: words.length > 0 ? ambiguousCount / words.length : 0,
    count: ambiguousCount,
    total: words.length,
  };
}

/**
 * Atomicity Score (Structure, 9.0% weight — HIGHEST in Understanding)
 */
function measureAtomicity(sentences) {
  if (sentences.length === 0) return { ratio: 0, count: 0, total: 0 };

  const compoundPattern = /\b(and also|and then|as well as|in addition to|additionally|furthermore|moreover)\b/i;
  const simpleCompound = /\band\b/gi;

  let compoundCount = 0;
  for (const sentence of sentences) {
    if (compoundPattern.test(sentence)) {
      compoundCount++;
    } else {
      const andMatches = sentence.match(simpleCompound);
      if (andMatches && andMatches.length >= 2) {
        compoundCount++;
      }
    }
  }

  return {
    ratio: sentences.length > 0 ? compoundCount / sentences.length : 0,
    count: compoundCount,
    total: sentences.length,
  };
}

/**
 * Flesch Reading Ease (Readability)
 * Formula: 206.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words)
 */
function measureFleschReadingEase(words, sentences) {
  if (words.length === 0 || sentences.length === 0) return 0;

  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const score = 206.835
    - 1.015 * (words.length / sentences.length)
    - 84.6 * (totalSyllables / words.length);

  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

/**
 * Flesch-Kincaid Grade Level (Readability)
 * Formula: 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
 */
function measureFleschKincaidGrade(words, sentences) {
  if (words.length === 0 || sentences.length === 0) return 0;

  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const grade = 0.39 * (words.length / sentences.length)
    + 11.8 * (totalSyllables / words.length)
    - 15.59;

  return Math.max(0, Math.round(grade * 10) / 10);
}

/**
 * Sentence Length (Cognitive)
 */
function measureSentenceLength(words, sentences) {
  if (sentences.length === 0) return 0;
  return Math.round((words.length / sentences.length) * 10) / 10;
}

/**
 * Negation Load (Cognitive)
 */
function measureNegationLoad(sentences) {
  if (sentences.length === 0) return { ratio: 0, count: 0, total: 0 };

  const negationPattern = /\b(not|no|never|none|neither|nor|cannot|can't|don't|doesn't|didn't|won't|wouldn't|shouldn't|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't)\b/i;

  let negationCount = 0;
  for (const sentence of sentences) {
    if (negationPattern.test(sentence)) {
      negationCount++;
    }
  }

  return {
    ratio: sentences.length > 0 ? negationCount / sentences.length : 0,
    count: negationCount,
    total: sentences.length,
  };
}

/**
 * Conditional Load (Cognitive)
 */
function measureConditionalLoad(sentences) {
  if (sentences.length === 0) return { ratio: 0, count: 0, total: 0 };

  const conditionalPattern = /\b(if|unless|when|whenever|otherwise|except|provided that|assuming|in case|as long as|only if|until)\b/i;

  let conditionalCount = 0;
  for (const sentence of sentences) {
    if (conditionalPattern.test(sentence)) {
      conditionalCount++;
    }
  }

  return {
    ratio: sentences.length > 0 ? conditionalCount / sentences.length : 0,
    count: conditionalCount,
    total: sentences.length,
  };
}

// ──── Score Interpretation ────

function getReadabilityLabel(score) {
  if (score >= 90) return 'Very Easy';
  if (score >= 70) return 'Easy';
  if (score >= 60) return 'Standard';
  if (score >= 50) return 'Fairly Difficult';
  if (score >= 30) return 'Difficult';
  if (score >= 15) return 'Hard — Technical';
  return 'Very Confusing';
}

function getGradeLabel(grade) {
  if (grade <= 6) return '6th grade';
  if (grade <= 8) return '8th grade';
  if (grade <= 10) return '10th grade';
  if (grade <= 12) return 'high school';
  if (grade <= 16) return 'college';
  return 'graduate+';
}

// ──── Understanding CLI Integration ────

/**
 * Check if the `understanding` CLI is available on the system.
 */
function findUnderstandingCli() {
  try {
    const cmd = process.platform === 'win32' ? 'where understanding' : 'which understanding';
    const result = execSync(`${cmd} 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Run the `understanding` CLI on a file and parse results.
 */
function runUnderstandingDeepScan(filePath) {
  try {
    const result = execSync(`understanding analyze "${filePath}" --enhanced --json 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 10000,
    });
    return JSON.parse(result);
  } catch {
    return null;
  }
}

// ──── Main Validator ────

/**
 * Collect all markdown files in docs-canonical/ directory.
 */
function getCanonicalDocs(projectDir) {
  const docsDir = resolve(projectDir, 'docs-canonical');
  const docs = [];

  if (!existsSync(docsDir)) return docs;

  try {
    const entries = readdirSync(docsDir);
    for (const entry of entries) {
      if (extname(entry).toLowerCase() === '.md') {
        docs.push({
          name: entry,
          path: join(docsDir, entry),
        });
      }
    }
  } catch {
    // Directory read failed silently
  }

  // Also check README.md at project root
  const readmePath = resolve(projectDir, 'README.md');
  if (existsSync(readmePath)) {
    docs.push({ name: 'README.md', path: readmePath });
  }

  return docs;
}

/**
 * Analyze a single document and return per-metric results.
 *
 * Uses extractProse() instead of stripMarkdown() — only actual prose
 * paragraphs are scored. Documents that are mostly tables/code/reference
 * material are skipped for readability (they'd score 0/100 unfairly).
 */
function analyzeDocument(doc) {
  const content = readFileSync(doc.path, 'utf-8');
  const proseText = extractProse(content);

  const sentences = splitSentences(proseText);
  const words = tokenizeWords(proseText);

  // Skip if insufficient prose content
  // Reference docs (mostly tables, code, lists) shouldn't be scored for readability
  if (words.length < MIN_PROSE_WORDS || sentences.length < 3) {
    return { skipped: true, reason: 'insufficient prose (reference document)', name: doc.name };
  }

  const passive = measurePassiveVoice(sentences);
  const ambiguous = measureAmbiguousPronouns(words);
  const atomicity = measureAtomicity(sentences);
  const fleschEase = measureFleschReadingEase(words, sentences);
  const fleschGrade = measureFleschKincaidGrade(words, sentences);
  const avgSentLen = measureSentenceLength(words, sentences);
  const negation = measureNegationLoad(sentences);
  const conditional = measureConditionalLoad(sentences);

  return {
    skipped: false,
    name: doc.name,
    sentences: sentences.length,
    words: words.length,
    metrics: {
      passiveVoiceRatio: passive.ratio,
      ambiguousPronounRatio: ambiguous.ratio,
      atomicityScore: atomicity.ratio,
      fleschReadingEase: fleschEase,
      fleschKincaidGrade: fleschGrade,
      avgSentenceLength: avgSentLen,
      negationLoad: negation.ratio,
      conditionalLoad: conditional.ratio,
    },
    details: { passive, ambiguous, atomicity, negation, conditional },
  };
}

/**
 * Main validator entry point.
 *
 * Scans all canonical docs, runs 8 metrics on each, and reports
 * per-doc findings as warnings when thresholds are exceeded.
 */
export function validateDocQuality(projectDir, config) {
  const results = { errors: [], warnings: [], passed: 0, total: 0 };

  const docs = getCanonicalDocs(projectDir);
  if (docs.length === 0) {
    return results;
  }

  // Check for optional understanding CLI
  const understandingCli = findUnderstandingCli();
  const useDeepScan = config.docQuality?.deepScan !== false && understandingCli;

  for (const doc of docs) {
    if (!existsSync(doc.path)) continue;

    const analysis = analyzeDocument(doc);
    if (analysis.skipped) continue;

    const m = analysis.metrics;

    // ── Check 1: Passive Voice ──
    results.total++;
    if (m.passiveVoiceRatio <= THRESHOLDS.passiveVoiceRatio.warn) {
      results.passed++;
    } else {
      results.warnings.push(
        `${doc.name}: High passive voice ratio (${(m.passiveVoiceRatio * 100).toFixed(0)}% of sentences). ` +
        `Use active voice for clarity. Found ${analysis.details.passive.count}/${analysis.details.passive.total} passive sentences`
      );
    }

    // ── Check 2: Ambiguous Pronouns ──
    results.total++;
    if (m.ambiguousPronounRatio <= THRESHOLDS.ambiguousPronounRatio.warn) {
      results.passed++;
    } else {
      results.warnings.push(
        `${doc.name}: High ambiguous pronoun ratio (${(m.ambiguousPronounRatio * 100).toFixed(1)}%). ` +
        `Replace "it/this/that/they" with specific nouns for clarity`
      );
    }

    // ── Check 3: Atomicity ──
    results.total++;
    if (m.atomicityScore <= THRESHOLDS.atomicityScore.warn) {
      results.passed++;
    } else {
      results.warnings.push(
        `${doc.name}: Low atomicity (${(m.atomicityScore * 100).toFixed(0)}% compound sentences). ` +
        `Split compound sentences for easier verification (IEEE 830 §4.1)`
      );
    }

    // ── Check 4: Flesch Reading Ease ──
    results.total++;
    if (m.fleschReadingEase >= THRESHOLDS.fleschReadingEase.warn) {
      results.passed++;
    } else {
      results.warnings.push(
        `${doc.name}: Very low readability (Flesch score: ${m.fleschReadingEase}/100 — ${getReadabilityLabel(m.fleschReadingEase)}). ` +
        `Shorten sentences and use simpler words`
      );
    }

    // ── Check 5: Flesch-Kincaid Grade ──
    results.total++;
    if (m.fleschKincaidGrade <= THRESHOLDS.fleschKincaidGrade.warn) {
      results.passed++;
    } else {
      results.warnings.push(
        `${doc.name}: Reading level too high (grade ${m.fleschKincaidGrade} — ${getGradeLabel(m.fleschKincaidGrade)}). ` +
        `Aim for grade 12-16 for technical docs`
      );
    }

    // ── Check 6: Sentence Length ──
    results.total++;
    if (m.avgSentenceLength <= THRESHOLDS.avgSentenceLength.warn) {
      results.passed++;
    } else {
      results.warnings.push(
        `${doc.name}: Average sentence too long (${m.avgSentenceLength} words). ` +
        `Target ≤30 words per sentence for readability`
      );
    }

    // ── Check 7: Negation Load ──
    results.total++;
    if (m.negationLoad <= THRESHOLDS.negationLoad.warn) {
      results.passed++;
    } else {
      results.warnings.push(
        `${doc.name}: High negation load (${(m.negationLoad * 100).toFixed(0)}% of sentences use negation). ` +
        `Rephrase in positive terms: "must not fail" → "must succeed" (IEEE 830 §4.3)`
      );
    }

    // ── Check 8: Conditional Load ──
    results.total++;
    if (m.conditionalLoad <= THRESHOLDS.conditionalLoad.warn) {
      results.passed++;
    } else {
      results.warnings.push(
        `${doc.name}: High conditional load (${(m.conditionalLoad * 100).toFixed(0)}% of sentences are conditional). ` +
        `Simplify by splitting conditionals into separate requirements`
      );
    }
  }

  return results;
}
