/**
 * API-REFERENCE.md Writer — deterministic, structural edits only.
 *
 * Used by `docguard fix --write` to MECHANICALLY remove endpoints that are
 * documented but no longer exist in the actual API surface. This performs NO
 * content rewriting (that needs an LLM) — it only deletes the structural pieces
 * that document a now-absent endpoint:
 *   1. its summary-table row:   | `GET` | `/api/...` | ... |
 *   2. its detail block:        #### GET `/api/...`  … up to the next heading
 *
 * Pure string transform — idempotent, no disk I/O here.
 *
 * Zero NPM dependencies — pure Node.js built-ins only.
 */

import { normalizePath, endpointKey } from '../scanners/api-doc.mjs';

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
const HEADING_RE = /^#{1,6}\s/;
// An endpoint detail heading: "#### GET `/path`" (backticks optional, any level).
const ENDPOINT_HEADING_RE = /^#{2,6}\s+`?(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)`?\s+`?(\/[^\s`|]+)`?/i;

/** True if the doc is DocGuard-generated (safe for `--write` to edit). */
export function hasGeneratedMarker(content) {
  return /<!--\s*docguard:generated\s+true\s*-->/i.test(content || '');
}

/**
 * If a markdown line is an API summary-table row, return its endpoint key.
 * Row shape: | `GET` | `/api/...` | ... |
 */
function tableRowKey(line) {
  if (!line.includes('|')) return null;
  const cells = line.split('|').map(s => s.trim()).filter(s => s.length > 0);
  if (cells.length < 2) return null;
  const method = cells[0].replace(/`/g, '').trim().toUpperCase();
  if (!HTTP_METHODS.has(method)) return null;
  for (let i = 1; i < cells.length; i++) {
    const cand = cells[i].replace(/`/g, '').trim();
    if (cand.startsWith('/')) return endpointKey(method, cand);
  }
  return null;
}

/** If a line is an endpoint detail heading, return its endpoint key. */
function headingKey(line) {
  const m = line.match(ENDPOINT_HEADING_RE);
  if (!m) return null;
  return endpointKey(m[1], m[2]);
}

/**
 * Remove the table row(s) and detail block(s) for the given endpoints.
 *
 * @param {string} content - API-REFERENCE.md content
 * @param {Array<{method:string,path:string}>} endpoints - endpoints to remove
 * @returns {{ content: string, removed: string[] }} new content + removed keys
 */
export function removeEndpoints(content, endpoints) {
  const targets = new Set((endpoints || []).map(e => endpointKey(e.method, e.path)));
  if (targets.size === 0) return { content, removed: [] };

  const lines = content.split('\n');
  const out = [];
  const removed = new Set();
  let skippingBlock = false;

  for (const line of lines) {
    const isHeading = HEADING_RE.test(line);

    if (isHeading) {
      // Any heading terminates a block we were skipping.
      const hk = headingKey(line);
      if (hk && targets.has(hk)) {
        // Start (or continue into a new) skipped detail block.
        skippingBlock = true;
        removed.add(hk);
        continue; // drop the heading line itself
      }
      // A non-target heading ends skipping and is kept.
      skippingBlock = false;
      out.push(line);
      continue;
    }

    if (skippingBlock) continue; // inside a removed detail block

    // Not skipping: drop a matching summary-table row.
    const rk = tableRowKey(line);
    if (rk && targets.has(rk)) {
      removed.add(rk);
      continue;
    }

    out.push(line);
  }

  return { content: out.join('\n'), removed: [...removed] };
}

export { normalizePath };
