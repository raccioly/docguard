/**
 * Generate IO — write-path helpers behind `docguard generate`: backup-then-
 * write file IO, canonical-doc registration in .docguard.json, standards
 * citation footers, and the surface-confidence heuristic.
 *
 * v0.29 split: extracted verbatim from cli/commands/generate.mjs — pure code
 * motion, zero behavior change.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/**
 * Create a .bak backup of an existing file before --force overwrites it.
 * Only backs up if the file exists and has content.
 */
export function backupFile(filePath) {
  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      if (content.trim().length > 0) {
        copyFileSync(filePath, filePath + '.bak');
      }
    } catch { /* backup failure is non-fatal */ }
  }
}

/**
 * Safe write — creates a .bak backup before overwriting existing files.
 * Call this instead of raw writeFileSync when generating docs.
 */
export function safeWrite(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  backupFile(filePath);
  writeFileSync(filePath, content, 'utf-8');
}

/**
 * B7 (field report): after generate emits canonical docs, register them in
 * `.docguard.json` requiredFiles.canonical so `guard` doesn't immediately flag
 * the generator's OWN output as an "orphaned" doc ("exists but not in your
 * requiredFiles"). Only ADDS (never removes/deletes), only docs-canonical/*.md
 * that actually exist on disk, and only when a config file already exists (init
 * owns config creation). Idempotent — a second run with nothing new is a no-op.
 * @returns {number} count of paths newly registered.
 */
export function registerGeneratedCanonicalDocs(projectDir, candidatePaths) {
  const cfgPath = resolve(projectDir, '.docguard.json');
  if (!existsSync(cfgPath)) return 0;
  let cfg;
  try { cfg = JSON.parse(readFileSync(cfgPath, 'utf-8')); } catch { return 0; }
  const canon = [...new Set(candidatePaths)].filter(p =>
    p.startsWith('docs-canonical/') && p.endsWith('.md') && existsSync(resolve(projectDir, p))
  );
  if (canon.length === 0) return 0;
  if (!cfg.requiredFiles || typeof cfg.requiredFiles !== 'object') cfg.requiredFiles = {};
  const existing = Array.isArray(cfg.requiredFiles.canonical) ? cfg.requiredFiles.canonical : [];
  const seen = new Set(existing);
  let added = 0;
  for (const p of canon) if (!seen.has(p)) { existing.push(p); seen.add(p); added++; }
  if (added === 0) return 0;
  cfg.requiredFiles.canonical = existing;
  try { writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8'); } catch { return 0; }
  return added;
}

/**
 * Standards citation map — each doc type maps to its governing industry standard.
 * Inspired by RAG-grounded standards alignment (Lopez et al., AITPG, IEEE TSE 2026).
 */
const STANDARDS_CITATIONS = {
  'ARCHITECTURE.md': {
    standard: 'arc42 Template + C4 Model',
    reference: 'Starke, G. & Brown, S. "arc42 — Architecture communication template." https://arc42.org | Brown, S. "The C4 Model for visualising software architecture." https://c4model.com',
    sections: '§1 Introduction, §2 Constraints, §3 Context, §4 Solution Strategy, §5 Building Blocks, §6 Runtime, §7 Deployment, §8 Crosscutting, §9 ADRs, §10 Quality, §11 Risks, §12 Glossary',
  },
  'DATA-MODEL.md': {
    standard: 'C4 Component Diagram + Entity-Relationship (Chen notation)',
    reference: 'Brown, S. "C4 Model — Component diagrams." https://c4model.com | Chen, P. "The Entity-Relationship Model." ACM TODS 1(1), 1976',
    sections: 'Entities, Relationships, ER Diagrams (Mermaid), Field-level definitions',
  },
  'TEST-SPEC.md': {
    standard: 'ISO/IEC/IEEE 29119-3:2022 — Test Documentation',
    reference: 'ISO/IEC/IEEE, "Software and systems engineering — Software testing — Part 3: Test documentation." International Standard, 2022',
    sections: 'Test Categories, Coverage Rules, Test Matrix, Tool Configuration',
  },
  'SECURITY.md': {
    standard: 'OWASP ASVS v4.0 + CWE Top 25',
    reference: 'OWASP Foundation, "Application Security Verification Standard v4.0." https://owasp.org/asvs | MITRE, "CWE Top 25." https://cwe.mitre.org/top25',
    sections: 'Authentication, Secrets Management, Access Control, Input Validation',
  },
  'ENVIRONMENT.md': {
    standard: '12-Factor App Methodology',
    reference: 'Wiggins, A. "The Twelve-Factor App." https://12factor.net',
    sections: 'Environment Variables, Config Separation, Setup Steps, Provider Configuration',
  },
  'API-REFERENCE.md': {
    standard: 'OpenAPI Specification 3.1',
    reference: 'OpenAPI Initiative, "OpenAPI Specification v3.1.0." https://spec.openapis.org/oas/v3.1.0',
    sections: 'Endpoints, Request/Response schemas, Authentication, Error codes',
  },
};

/**
 * Append a standards citation footer to generated doc content.
 * @param {string} content - The generated markdown content
 * @param {string} docName - The filename (e.g., 'ARCHITECTURE.md')
 * @returns {string} Content with citation footer appended
 */
export function appendStandardsCitation(content, docName) {
  const citation = STANDARDS_CITATIONS[docName];
  if (!citation) return content;

  const footer = `
---

## Standards Reference

> **Aligned with**: ${citation.standard}
>
> **Sections covered**: ${citation.sections}
>
> **Reference**: ${citation.reference}
>
> *Standards alignment inspired by RAG-grounded generation (Lopez et al., AITPG, IEEE TSE 2026).*
`;

  return content.trimEnd() + '\n' + footer;
}

/**
 * F1 (field report): web-shaped surface (HTTP endpoints, SDK deps, routes)
 * auto-extracted from a cli/library/unknown-kind project is often pattern-
 * matches in the project's OWN source (e.g. a scanner/linter whose code mentions
 * express, boto3, jwt as detection strings), not real usage. We do NOT suppress
 * it — that could hide a real surface (a false-green) — we flag it 'low'
 * confidence so the surface is verified before being documented. Web kinds
 * (webapp/api/service) stay 'normal'.
 */
export function surfaceConfidence(kind) {
  return ['webapp', 'api', 'service'].includes(kind) ? 'normal' : 'low';
}
