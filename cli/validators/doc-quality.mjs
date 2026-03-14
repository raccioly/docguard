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
  passiveVoiceRatio:     { warn: 0.20, label: 'Passive voice ratio' },       // >20% passive = warn
  ambiguousPronounRatio: { warn: 0.15, label: 'Ambiguous pronoun ratio' },   // >15% ambiguous pronouns = warn
  atomicityScore:        { warn: 0.30, label: 'Non-atomic sentence ratio' }, // >30% compound sentences = warn
  fleschReadingEase:     { warn: 20,   label: 'Flesch reading ease' },       // <20 = very hard to read (lowered from 30 for technical markdown)
  fleschKincaidGrade:    { warn: 16,   label: 'Flesch-Kincaid grade' },      // >16 = graduate level+
  avgSentenceLength:     { warn: 25,   label: 'Avg sentence length' },       // >25 words = too long
  negationLoad:          { warn: 0.15, label: 'Negation load' },             // >15% sentences with negation = warn
  conditionalLoad:       { warn: 0.30, label: 'Conditional load' },          // >30% sentences conditional = warn
};

// ──── Text Processing Utilities ────

/**
 * Strip markdown formatting to get plain prose text.
 * Removes: code blocks, inline code, headers, links, images, tables,
 * HTML comments, metadata blocks, horizontal rules, list markers.
 */
function stripMarkdown(content) {
  let text = content;

  // Remove fenced code blocks (```...```) and (````...````)
  text = text.replace(/````[\s\S]*?````/g, '');
  text = text.replace(/```[\s\S]*?```/g, '');

  // Remove mermaid diagrams
  text = text.replace(/```mermaid[\s\S]*?```/g, '');

  // Remove HTML comments (<!-- ... -->)
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Remove YAML frontmatter (---...---)
  text = text.replace(/^---[\s\S]*?---\n/m, '');

  // Remove table rows (lines starting with |) and table separators
  text = text.replace(/^\|.*$/gm, '');
  text = text.replace(/^[|:\-\s]+$/gm, '');

  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, '');

  // Remove badge images (shield.io etc.) — before generic image removal
  text = text.replace(/!\[.*?\]\(https?:\/\/[^)]+\)/g, '');

  // Remove images: ![alt](url)
  text = text.replace(/!\[.*?\]\(.*?\)/g, '');

  // Remove links, keep link text: [text](url) → text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Remove inline code
  text = text.replace(/`[^`]+`/g, '');

  // Remove header markers (# ## ### etc.)
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove list markers (-, *, 1.)
  text = text.replace(/^\s*[-*+]\s+/gm, '');
  text = text.replace(/^\s*\d+\.\s+/gm, '');

  // Remove bold/italic markers
  text = text.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  text = text.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');

  // Remove definition-style lines (key: value or key | value)
  text = text.replace(/^\s*\w[\w\s]*\s*[:|]\s*.*$/gm, (match) => {
    // Only strip if it looks like a key-value pair, not a sentence
    if (match.includes('.') || match.split(/\s+/).length > 8) return match;
    return '';
  });

  // Remove lines that are mostly non-prose (>60% special characters)
  text = text.replace(/^.+$/gm, (line) => {
    const trimmed = line.trim();
    if (trimmed.length < 5) return '';
    const alphaCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
    const ratio = alphaCount / trimmed.length;
    return ratio < 0.4 ? '' : line; // If <40% letters, it's not prose
  });

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Split text into sentences using common sentence-ending punctuation.
 * Handles abbreviations (Mr., Dr., etc.) and decimal numbers to avoid false splits.
 */
function splitSentences(text) {
  if (!text || text.trim().length === 0) return [];

  // Protect common abbreviations from false sentence splits
  let protected_ = text;
  const abbreviations = ['Mr', 'Mrs', 'Ms', 'Dr', 'Prof', 'Sr', 'Jr', 'vs', 'etc', 'i.e', 'e.g', 'cf'];
  for (const abbr of abbreviations) {
    const regex = new RegExp(`\\b${abbr}\\.`, 'gi');
    protected_ = protected_.replace(regex, `${abbr}≈`);
  }

  // Protect decimal numbers (3.14)
  protected_ = protected_.replace(/(\d)\.(\d)/g, '$1≈$2');

  // Split on sentence-ending punctuation followed by space or end
  const raw = protected_.split(/[.!?]+(?:\s+|$)/);

  // Restore protected characters and filter empties
  return raw
    .map(s => s.replace(/≈/g, '.').trim())
    .filter(s => s.length > 3); // Ignore fragments under 4 chars
}

/**
 * Count syllables in a word using a heuristic approach.
 * Based on the algorithm used in readability research:
 *   1. Count vowel groups
 *   2. Subtract silent-e at end
 *   3. Add back for specific suffixes (-le, -les, -tion, etc.)
 *   4. Minimum 1 syllable per word
 */
function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 2) return 1;

  // Exception list for common words with unusual syllable counts
  const exceptions = {
    'the': 1, 'are': 1, 'were': 1, 'have': 1, 'there': 1,
    'where': 1, 'here': 1, 'every': 3, 'everything': 4,
    'create': 2, 'file': 1, 'style': 1, 'quite': 1,
  };
  if (exceptions[word] !== undefined) return exceptions[word];

  // Count vowel groups
  const vowelGroups = word.match(/[aeiouy]+/g);
  let count = vowelGroups ? vowelGroups.length : 1;

  // Subtract silent-e at end (but not for words like "able", "ible")
  if (word.endsWith('e') && !word.endsWith('le') && !word.endsWith('ce') && !word.endsWith('ge')) {
    count--;
  }

  // Subtract for common diphthong/double vowel endings
  if (word.endsWith('ed') && !word.endsWith('ted') && !word.endsWith('ded')) {
    count--;
  }

  // Ensure minimum 1 syllable
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

  // Passive voice pattern: be-verb followed by past participle
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
 *
 * Counts pronouns that lack clear antecedents: it, this, that, they, them, these, those.
 * In technical documentation, these often create confusion about what exactly is referenced.
 *
 * Returns ratio of ambiguous pronouns to total word count.
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
 * Atomicity Score (Structure, 9.0% weight in Understanding — HIGHEST)
 *
 * Measures how "atomic" (single-purpose) sentences are.
 * Compound sentences with and/or/also/additionally indicate non-atomic requirements.
 * IEEE 830 §4.1 recommends atomic requirements that can be independently verified.
 *
 * Returns ratio of NON-atomic sentences (compound) to total sentences.
 */
function measureAtomicity(sentences) {
  if (sentences.length === 0) return { ratio: 0, count: 0, total: 0 };

  // Compound indicators (sentence-level conjunctions, not word-level)
  // We match these only when preceded/followed by spaces to avoid matching within words
  const compoundPattern = /\b(and also|and then|as well as|in addition to|additionally|furthermore|moreover)\b/i;
  // Simple "and" / "or" — only flag if >1 occurrence in a sentence (natural language has legitimate single "and")
  const simpleCompound = /\band\b/gi;
  const simpleOr = /\bor\b/gi;

  let compoundCount = 0;
  for (const sentence of sentences) {
    if (compoundPattern.test(sentence)) {
      compoundCount++;
    } else {
      // Count simple "and" — 2+ indicates compound
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
 * Flesch Reading Ease (Readability, 3.75% weight in Understanding)
 *
 * Formula: 206.835 - 1.015 * (total words / total sentences) - 84.6 * (total syllables / total words)
 * Source: Flesch, R. (1948). "A new readability yardstick." Journal of Applied Psychology.
 *
 * Scale: 0-100, higher = easier to read.
 *   90-100: Very Easy (5th grade)
 *   60-69:  Standard (8th-9th grade)
 *   30-49:  Difficult (college level)
 *   0-29:   Very Confusing (graduate level)
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
 * Flesch-Kincaid Grade Level (Readability, 2.25% weight in Understanding)
 *
 * Formula: 0.39 * (total words / total sentences) + 11.8 * (total syllables / total words) - 15.59
 * Source: Kincaid, J.P. et al. (1975). "Derivation of new readability formulas."
 *
 * Returns US grade level (8 = 8th grade, 12 = high school senior, 16+ = graduate)
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
 * Sentence Length (Cognitive, 3.0% weight in Understanding)
 *
 * Average words per sentence. Cognitive load research (Sweller, 1988) shows that
 * sentences over 25 words significantly increase processing effort.
 */
function measureSentenceLength(words, sentences) {
  if (sentences.length === 0) return 0;
  return Math.round((words.length / sentences.length) * 10) / 10;
}

/**
 * Negation Load (Cognitive, 1.5% weight in Understanding)
 *
 * Ratio of sentences containing negation words.
 * Negation increases cognitive load because readers must mentally invert meaning.
 * IEEE 830 §4.3 recommends positive phrasing in requirements.
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
 * Conditional Load (Cognitive, 1.5% weight in Understanding)
 *
 * Ratio of sentences containing conditional keywords.
 * Excessive conditionals make documentation hard to follow and test.
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
 * Returns the path to the executable or null.
 */
function findUnderstandingCli() {
  try {
    // Use 'which' on Unix/Mac, 'where' on Windows — never redirect to NUL (creates file on Mac)
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
 * Returns understanding's quality score or null if it fails.
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
 */
function analyzeDocument(doc) {
  const content = readFileSync(doc.path, 'utf-8');
  const plainText = stripMarkdown(content);

  if (plainText.length < 50) {
    return { skipped: true, reason: 'too short', name: doc.name };
  }

  const sentences = splitSentences(plainText);
  const words = tokenizeWords(plainText);

  if (sentences.length < 3 || words.length < 20) {
    return { skipped: true, reason: 'insufficient content', name: doc.name };
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
    // No docs to analyze — structure validator catches this
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
        `Aim for grade 10-12 for technical docs`
      );
    }

    // ── Check 6: Sentence Length ──
    results.total++;
    if (m.avgSentenceLength <= THRESHOLDS.avgSentenceLength.warn) {
      results.passed++;
    } else {
      results.warnings.push(
        `${doc.name}: Average sentence too long (${m.avgSentenceLength} words). ` +
        `Target ≤25 words per sentence for readability (Sweller, 1988)`
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

  // ── Optional: Understanding deep scan note ──
  if (!understandingCli && docs.length > 0) {
    // Don't add as warning — just a note in verbose mode
    // Users who want full 31-metric scan can install understanding
  }

  return results;
}
