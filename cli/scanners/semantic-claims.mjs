/**
 * Semantic claim extractor (LLM field report #5).
 *
 * The highest-value class of doc bug is SEMANTIC: a documented number/enum/limit
 * that no longer matches the code — DLP retention "30 days" vs code 730, a status
 * enum "PENDING/IDLE" vs "WAITING", "100/min" vs "500 req/s", "29+ roles" vs 44,
 * "4 GSIs" vs 6. Regex/AST can't judge these (the doc value and the code value
 * are both just numbers), so they slip through every deterministic validator.
 *
 * DocGuard is zero-dependency and does NOT call an LLM itself. So this is an
 * EXTRACTOR: it surfaces the verifiable claims — value, unit, doc:line, section,
 * and the nearest cited code path — as a structured task list. The agent running
 * `docguard verify --semantic` does the actual comparison against the code. This
 * mirrors the `docguard agent` task-graph: deterministic discovery, LLM judgment.
 *
 * Precision over recall: a number is only a claim when it carries a recognized
 * unit (days/ms/req-s/GSIs/roles/…); an enum only when it's a list of 2+
 * UPPER_SNAKE tokens in a status/state/enum context. Bare version strings, dates,
 * and prose numbers are ignored.
 *
 * Zero npm dependencies — pure Node.js built-ins.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadIgnorePatterns } from '../shared.mjs';

// Numbers are only claims when adjacent to a recognized unit.
const NUMBER_PATTERNS = [
  { kind: 'duration', re: /\b(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?)\b/gi },
  { kind: 'rate',     re: /\b(\d+)\s*(?:\/|\bper\b|\breq(?:uests?)?\s*\/?)\s*(s|sec|seconds?|min|minutes?|hours?|h)\b/gi },
  // Field report #6: the noun list IS the precision mechanism — a number is only
  // a claim when it sits next to a recognized "registered-unit" noun. The gap that
  // shipped a wrong "16 extractors" past every check was simply that "extractors"
  // (and its domain-collection siblings) weren't in this list. Added the common
  // pluggable-architecture nouns. Deliberately NOT added: generic prose nouns that
  // collide with running-text numbers (steps, items, checks, modules, services).
  { kind: 'count',    re: /\b(\d+)\s*\+?\s*(GSIs?|LSIs?|indexes|indices|roles?|permissions?|scopes?|tables?|queues?|topics?|buckets?|endpoints?|routes?|validators?|columns?|fields?|shards?|partitions?|replicas?|retries|workers?|threads?|connections?|extractors?|plugins?|detectors?|scanners?|analyzers?|collectors?|commands?|subcommands?|rules?|hooks?|providers?|adapters?|handlers?|middlewares?|transformers?|processors?|generators?|parsers?|exporters?|importers?|integrations?|formatters?|linters?|agents?|skills?)\b/gi },
];

// A list of 2+ UPPER_SNAKE tokens separated by / , | or "or" — an enum claim,
// but only when the line or its heading reads like a status/state/enum context.
const ENUM_LIST_RE = /\b[A-Z][A-Z0-9_]{2,}(?:\s*(?:\/|,|\||\bor\b)\s*[A-Z][A-Z0-9_]{2,}){1,}\b/g;
const ENUM_CONTEXT_RE = /\b(status|state|enum|values?|one of|phase|stage|transitions?)\b/i;

// A code path mentioned in or near the claim — the agent's starting point.
const CITED_CODE_RE = /`?([\w./-]+\.(?:ts|tsx|js|mjs|cjs|jsx|py|go|rs|java|kt|rb|php|sql|yaml|yml|json))`?(?::(\d+))?/;

const MAX_CLAIMS = 80;

/** Canonical docs + the root docs where limits/counts commonly live. */
function claimSourceDocs(projectDir) {
  // Honor .docguardignore: a doc the user explicitly excluded from validation
  // (e.g. a historical audit full of point-in-time counts) must not feed the
  // "unverified claims" pool either — it inflated the count and buried the
  // claims that ARE actionable (bug-212).
  const isIgnored = loadIgnorePatterns(projectDir);
  const docs = [];
  const canonical = resolve(projectDir, 'docs-canonical');
  if (existsSync(canonical)) {
    try {
      for (const f of readdirSync(canonical)) {
        if (f.toLowerCase().endsWith('.md') && !isIgnored(`docs-canonical/${f}`)) {
          docs.push(`docs-canonical/${f}`);
        }
      }
    } catch { /* ignore */ }
  }
  for (const root of ['README.md', 'AGENTS.md']) {
    if (existsSync(resolve(projectDir, root)) && !isIgnored(root)) docs.push(root);
  }
  return docs;
}

/** True if a line is inside a fenced code block (toggled by the caller). */
function findCitedCode(lines, idx) {
  // Search the claim line first, then the immediately adjacent lines. A tight
  // window avoids cross-attributing a path from an unrelated nearby claim (e.g.
  // a rate limit grabbing the retention doc's cited file three lines up).
  for (let d = 0; d <= 1; d++) {
    for (const j of d === 0 ? [idx] : [idx - d, idx + d]) {
      if (j < 0 || j >= lines.length) continue;
      const m = CITED_CODE_RE.exec(lines[j]);
      if (m) return m[2] ? `${m[1]}:${m[2]}` : m[1];
    }
  }
  return null;
}

/**
 * Extract semantic claims from a project's canonical docs.
 * @returns {Array<{ doc, line, section, kind, subkind, value, unit, text, citedCode }>}
 */
export function extractSemanticClaims(projectDir, config = {}) {
  const claims = [];
  const seen = new Set();

  for (const doc of claimSourceDocs(projectDir)) {
    let content;
    try { content = readFileSync(resolve(projectDir, doc), 'utf-8'); } catch { continue; }
    const lines = content.split('\n');
    let section = '';
    let inFence = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue; // numbers in code samples are examples, not claims
      const h = line.match(/^#{1,6}\s+(.*)$/);
      if (h) { section = h[1].trim(); continue; }

      const lineNo = i + 1;
      const push = (claim) => {
        const key = `${doc}:${lineNo}:${claim.kind}:${claim.value}:${claim.unit || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        claims.push({ doc, line: lineNo, section, citedCode: findCitedCode(lines, i), text: line.trim().slice(0, 200), ...claim });
      };

      for (const { kind, re } of NUMBER_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          push({ kind: 'number', subkind: kind, value: m[1], unit: m[2].toLowerCase() });
        }
      }

      if (ENUM_CONTEXT_RE.test(line) || ENUM_CONTEXT_RE.test(section)) {
        ENUM_LIST_RE.lastIndex = 0;
        let m;
        while ((m = ENUM_LIST_RE.exec(line)) !== null) {
          // Skip all-caps acronym runs joined by slash that are really one token.
          const values = m[0].split(/\s*(?:\/|,|\||\bor\b)\s*/).filter(Boolean);
          if (values.length >= 2) push({ kind: 'enum', subkind: 'enum-list', value: values.join('/'), unit: null });
        }
      }

      if (claims.length >= MAX_CLAIMS) return claims;
    }
  }
  return claims;
}

/**
 * Turn extracted claims into agent-executable verification tasks (one per claim).
 * Pure — reused by the command and any task-graph consumer.
 */
export function buildSemanticVerifyTasks(claims) {
  return claims.map((c, i) => {
    const where = c.citedCode ? ` Start at the cited code: ${c.citedCode}.` : ' No code path is cited nearby — grep the codebase for the relevant constant/config.';
    const what = c.kind === 'enum'
      ? `the enum/status set "${c.value}"`
      : `the ${c.subkind} value ${c.value}${c.unit ? ` ${c.unit}` : ''}`;
    return {
      id: `verify.semantic.${i + 1}`,
      doc: c.doc,
      line: c.line,
      section: c.section,
      kind: c.kind,
      value: c.value,
      unit: c.unit,
      citedCode: c.citedCode,
      claim: c.text,
      instruction: `Verify ${what} documented in ${c.doc}:${c.line}${c.section ? ` (section "${c.section}")` : ''} against the code.${where} If the code disagrees, the doc (or the code) is wrong — report the mismatch with both values.`,
      confidence: 'requires-human',
    };
  });
}
