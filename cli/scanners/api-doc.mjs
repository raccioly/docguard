/**
 * API Documentation Parser
 *
 * Extracts API endpoints from a canonical API doc (API-REFERENCE.md) robustly,
 * and provides normalized comparison primitives shared by `docguard diff` and
 * the API-Surface guard validator.
 *
 * Handles two documentation styles:
 *   1. Headings:    `#### GET /api/admin/users`  (method + path, backticks optional)
 *   2. Table rows:  | `GET` | `/api/admin/users` | ... |
 *
 * Normalization makes comparison reliable:
 *   - method split into its own field, upper-cased
 *   - path params unified: `:id` ≡ `{id}` → `{}` placeholder
 *   - trailing slashes, backticks, and table pipes stripped
 *   - query strings / fragments removed
 *
 * Zero NPM dependencies — pure Node.js built-ins only.
 */

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);

/**
 * Normalize an API path for comparison.
 * Strips decoration and collapses ALL dynamic-segment syntaxes to a single `{}`
 * placeholder so an endpoint documented one way matches the same endpoint
 * emitted another way:
 *   Express/colon   `/users/:id`            → `/users/{}`
 *   OpenAPI/brace   `/users/{id}`           → `/users/{}`
 *   Next.js bracket `/users/[id]`           → `/users/{}`
 *   catch-all       `/auth/[...nextauth]`, `/auth/:nextauth*` → `/auth/{}`
 *   optional c-all  `/shop/[[...filters]]`  → `/shop/{}`
 * Without the bracket rule, a doc written in Next.js `[id]` syntax never matched
 * the code-scan's `:id`, so every dynamic route double-fired as both
 * "documented-but-absent" and "undocumented" (field test: hugocross_revamp).
 * @param {string} raw
 * @returns {string} normalized path (e.g. "/api/users/{}") or '' if not a path
 */
export function normalizePath(raw) {
  if (!raw) return '';
  let p = String(raw).trim();
  // strip surrounding backticks / pipes / quotes / whitespace
  p = p.replace(/^[|`'"\s]+/, '').replace(/[|`'"\s]+$/, '');
  // cut query string / fragment
  p = p.split(/[?#]/)[0];
  if (!p.startsWith('/')) return '';
  // collapse every param syntax to {}: Next.js [id]/[...slug]/[[...slug]],
  // OpenAPI {param}, and colon :param (incl. catch-all :param*).
  p = p
    .replace(/\[{1,2}[^\]]*\]{1,2}/g, '{}')
    .replace(/\{[^}/]+\}/g, '{}')
    .replace(/:[^/]+/g, '{}');
  // strip trailing slash (but keep root "/")
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
}

/** Build a canonical comparison key for an endpoint. */
export function endpointKey(method, path) {
  return `${String(method).toUpperCase()} ${normalizePath(path)}`;
}

/**
 * Parse endpoints documented in an API reference markdown string.
 * @param {string} content
 * @returns {Array<{ method: string, path: string, key: string }>}
 */
export function parseApiReferenceDoc(content) {
  if (!content) return [];
  const found = new Map(); // key → { method, path, key }

  const addEndpoint = (method, rawPath) => {
    const m = String(method).toUpperCase();
    if (!HTTP_METHODS.has(m)) return;
    const path = normalizePath(rawPath);
    if (!path || path.length < 2) return;
    const key = `${m} ${path}`;
    if (!found.has(key)) found.set(key, { method: m, path, key });
  };

  const lines = content.split('\n');

  // Style 1: headings — "#### GET `/api/...`" (method + path, backticks optional)
  const headingRe = /^#{2,6}\s+`?(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)`?\s+`?(\/[^\s`|]+)`?/i;

  // Style 2: table rows — "| `GET` | `/api/...` | ... |"
  for (const line of lines) {
    const h = line.match(headingRe);
    if (h) {
      addEndpoint(h[1], h[2]);
      continue;
    }

    if (line.includes('|')) {
      const cells = line.split('|').map(s => s.trim()).filter(s => s.length > 0);
      if (cells.length >= 2) {
        const c0 = cells[0].replace(/`/g, '').trim().toUpperCase();
        if (HTTP_METHODS.has(c0)) {
          // path is the next cell that looks like a route
          for (let i = 1; i < cells.length; i++) {
            const cand = cells[i].replace(/`/g, '').trim();
            if (cand.startsWith('/')) { addEndpoint(c0, cand); break; }
          }
        }
      }
    }
  }

  return [...found.values()];
}

/**
 * Compare a documented endpoint set against an actual endpoint set.
 * @param {Array<{method,path}>} documented
 * @param {Array<{method,path}>} actual
 * @returns {{ documentedButAbsent: object[], presentButUndocumented: object[], matched: object[] }}
 */
export function compareEndpoints(documented, actual) {
  const docMap = new Map();
  for (const e of documented) docMap.set(endpointKey(e.method, e.path), e);
  const actMap = new Map();
  for (const e of actual) actMap.set(endpointKey(e.method, e.path), e);

  const documentedButAbsent = [];
  const matched = [];
  for (const [key, e] of docMap) {
    if (actMap.has(key)) matched.push(e);
    else documentedButAbsent.push(e);
  }
  const presentButUndocumented = [];
  for (const [key, e] of actMap) {
    if (!docMap.has(key)) presentButUndocumented.push(e);
  }

  return { documentedButAbsent, presentButUndocumented, matched };
}
