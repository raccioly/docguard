/**
 * API-Doc-Smells validator (APS001 Bloated, APS002 Lazy) — v0.31.0.
 *
 * Research: the API-documentation-smell taxonomy (Bloated, Excess Structural
 * Info, Tangled, Fragmented, Lazy) with a 1,000-unit benchmark. The two smells
 * with strong DETERMINISTIC detectors are Bloated (F1 0.90) and Lazy (F1 0.95),
 * keyed on documentation length relative to the surface documented — no ML.
 * The three semantic smells need BERT and are deliberately left to staged agent
 * judgment (verify --semantic), matching DocGuard's split.
 *
 * We apply the length signals per "API documentation unit" = a markdown section
 * whose HEADING is a code signature (an HTTP endpoint `GET /path`, a function
 * `foo(...)`, or a backticked symbol). Prose-only sections are ignored — that's
 * doc-quality.mjs's job (passive voice, readability); this is API-surface-specific.
 *
 *   Lazy   — a documented endpoint/method with (almost) no explanation: ≤ N
 *            prose words of body. "Documented in name only."
 *   Bloated— a single unit that is grossly over-documented: ≥ M words.
 *
 * All findings confidence:'low' / soft — a nudge to right-size the doc.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { mkFinding, resultFromFindings } from '../findings.mjs';

const HEADING = /^(#{1,6})\s+(.*)$/;
// A heading that documents an API/code unit — NOT a prose section heading.
// Precision (corpus-tuned): markdown headings routinely read "Some Words
// (parenthetical note)", which naively looks like a call. A real signature has
// NO space before `(` AND a code-shaped identifier (camelCase / snake_case /
// dotted). This kills FPs like "Remediation Log (2026-03-17)", "Unit Tests
// (vitest)", "4.1 Enrollment (Base Record)".
const HTTP_SIG = /^`?\s*(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\/?`?\S/i;
const FUNC_SIG = /(?:^|[\s`.])([A-Za-z_][A-Za-z0-9_]*)\((?:\)|[^)]*\))/; // identifier(...) no space
const CODEY = /[a-z][A-Z]|_|\./;                     // camel/snake/dotted → code-shaped
const BACKTICK_SIG = /^`[^`\s][^`]*`\s*$/;           // heading is exactly a `symbol`
function isSignatureHeading(text) {
  const t = text.trim();
  if (HTTP_SIG.test(t)) return true;
  if (BACKTICK_SIG.test(t)) return true;
  const fm = t.match(FUNC_SIG);
  if (fm && (CODEY.test(fm[1]) || /\(\s*\)/.test(t))) return true; // codey name OR empty-arg call foo()
  return false;
}

// Prose words in a body, EXCLUDING fenced code blocks (a big code sample isn't
// "explanation", so a unit with only code counts as Lazy).
function proseWordCount(bodyLines) {
  let inFence = false;
  let words = 0;
  for (const line of bodyLines) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.trim().match(/[A-Za-z0-9][A-Za-z0-9'-]*/g);
    if (m) words += m.length;
  }
  return words;
}
function totalWordCount(bodyLines) {
  let words = 0;
  for (const line of bodyLines) {
    const m = line.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g);
    if (m) words += m.length;
  }
  return words;
}

// Split markdown into signature-headed units: { heading, level, line, body[] }.
function extractUnits(content) {
  const lines = content.split('\n');
  const units = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const hm = lines[i].match(HEADING);
    if (hm) {
      // close current unit at the next heading of same-or-higher level
      if (cur && hm[1].length <= cur.level) { units.push(cur); cur = null; }
      if (!cur && isSignatureHeading(hm[2])) {
        cur = { heading: hm[2].trim(), level: hm[1].length, line: i + 1, body: [] };
        continue;
      }
      if (cur) { cur.body.push(lines[i]); }
      continue;
    }
    if (cur) cur.body.push(lines[i]);
  }
  if (cur) units.push(cur);
  return units;
}

export function validateApiDocSmells(projectDir, config = {}) {
  const cfg = config.apiDocSmells || {};
  const lazyMax = Number.isInteger(cfg.lazyMaxWords) ? cfg.lazyMaxWords : 6;
  const bloatedMin = Number.isInteger(cfg.bloatedMinWords) ? cfg.bloatedMinWords : 300;

  const docsDir = resolve(projectDir, 'docs-canonical');
  if (!existsSync(docsDir)) {
    return resultFromFindings([], { passed: 0, total: 0, applicable: false });
  }
  let docFiles = [];
  try { docFiles = readdirSync(docsDir).filter(f => f.endsWith('.md')); } catch { /* skip */ }

  const findings = [];
  let unitCount = 0;
  for (const f of docFiles) {
    let content;
    try { content = readFileSync(resolve(docsDir, f), 'utf-8'); } catch { continue; }
    const units = extractUnits(content);
    for (const u of units) {
      unitCount++;
      const prose = proseWordCount(u.body);
      const total = totalWordCount(u.body);
      if (prose <= lazyMax) {
        findings.push(mkFinding({
          code: 'APS002',
          validator: 'api-doc-smells',
          severity: 'warn',
          confidence: 'low',
          message: `${f}: "${u.heading.slice(0, 60)}" is documented in name only (${prose} words of explanation) — Lazy API doc.`,
          location: { file: f, line: u.line },
          suggestion: { summary: `Describe what "${u.heading.slice(0, 40)}" does, its params, return, and errors — not just its signature.` },
        }));
      } else if (total >= bloatedMin) {
        findings.push(mkFinding({
          code: 'APS001',
          validator: 'api-doc-smells',
          severity: 'warn',
          confidence: 'low',
          message: `${f}: "${u.heading.slice(0, 60)}" is ${total} words for one unit — Bloated API doc; trim to the essential contract.`,
          location: { file: f, line: u.line },
          suggestion: { summary: `Split or trim "${u.heading.slice(0, 40)}" — move examples/edge-cases elsewhere and keep the core contract.` },
        }));
      }
    }
  }

  return resultFromFindings(findings, {
    passed: unitCount - findings.length,
    total: unitCount,
    applicable: unitCount > 0,
  });
}
