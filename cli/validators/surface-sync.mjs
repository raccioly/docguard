/**
 * Surface-Sync Validator — item-level drift detection for enumerable surfaces.
 *
 * Complements canonical-sync (which checks NUMERIC count claims) by checking
 * that each individual ITEM in a code-derived list is actually documented as
 * a list entry in the target markdown file(s). Catches the "demo command
 * exists in code, the count matches, but it's missing from the README's
 * command table" class of drift — invisible to count-based checks.
 *
 * Why this exists: canonical-sync was passing 3/3 on a docguard repo whose
 * README's command table omitted `demo` entirely. The count matched ("14
 * commands" = 14 user-facing commands in --help) but the table only listed
 * 13 of them. Without an item-level check, a doc can be silently wrong while
 * every count-based validator celebrates. That's exactly the credibility hit
 * the user reported.
 *
 * How it works: for each configured surface (commands, validators, slash
 * commands, templates, anything enumerable), we:
 *   1. Discover the code-truth set from a glob pattern + basename extractor
 *   2. For each target doc, parse all markdown tables and bullet lists,
 *      collecting backticked tokens that look like identifiers from the
 *      FIRST column / item position only (not arbitrary prose mentions)
 *   3. Diff the two sets and warn on items present in code but absent from
 *      the doc, OR present in the doc but missing from code (likely
 *      removed / renamed)
 *
 * Scoped to list contexts on purpose: scanning every backtick would produce
 * false positives every time someone wrote `--verbose` or `process.env.X`
 * in prose. A table row or bullet item is a deliberate inventory signal —
 * docguard treats those as the doc's authoritative list, ignores the rest.
 *
 * Default: N/A. The validator is OFF unless the project's .docguard.json
 * declares at least one surface under `validators.surfaceSync.surfaces`.
 * This keeps the upgrade path safe for projects that don't opt in.
 *
 * Config shape (in .docguard.json):
 *   {
 *     "validators": { "surfaceSync": true },
 *     "surfaceSync": {
 *       "surfaces": [
 *         {
 *           "name": "commands",
 *           "glob": "cli/commands/*.mjs",
 *           "extract": "basename-no-ext",  // "basename" or "basename-no-ext"
 *           "ignore": ["setup", "impact"],  // known aliases / non-public items
 *           "docs": ["README.md"]
 *         }
 *       ]
 *     }
 *   }
 *
 * Severity: MEDIUM. Wrong-list drift is real but rarely a build-breaker —
 * users can still read the doc and discover the missing surface via --help.
 * Demoting to LOW makes drift invisible; promoting to HIGH would conflict
 * with the existing reality that many projects ship slightly-stale READMEs.
 *
 * Zero NPM runtime dependencies — pure Node.js built-ins only.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename, extname, relative, dirname } from 'node:path';

/**
 * Expand a simple glob (only supports `*` at the leaf segment level —
 * sufficient for `cli/commands/*.mjs`, `templates/*.md.template`, etc.).
 * Recursive `**` is NOT supported by design — surface lists live in
 * known shallow directories; deep recursion would be a configuration
 * smell, not a feature.
 */
function expandGlob(projectDir, glob) {
  const slash = glob.lastIndexOf('/');
  const dir = slash >= 0 ? glob.slice(0, slash) : '.';
  const pattern = slash >= 0 ? glob.slice(slash + 1) : glob;
  const absDir = resolve(projectDir, dir);
  if (!existsSync(absDir)) return [];

  // Convert glob to regex: escape regex specials, then `*` → `.*`
  const rx = new RegExp('^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*') + '$');

  try {
    return readdirSync(absDir)
      .filter(name => rx.test(name))
      .map(name => join(absDir, name))
      .filter(full => {
        try { return statSync(full).isFile(); } catch { return false; }
      });
  } catch {
    return [];
  }
}

/**
 * Extract the surface name from a file path according to the configured rule.
 * `basename`        → keep the full filename: `guard.mjs`
 * `basename-no-ext` → strip the single trailing extension: `guard`
 *
 * `basename-no-ext` strips ONLY the last extension on purpose. For files like
 * `ARCHITECTURE.md.template`, `basename-no-ext` returns `ARCHITECTURE.md` —
 * which is the canonical doc name the template generates. If the user wants
 * the bare `ARCHITECTURE`, they can use a custom extractor (not yet supported).
 */
function applyExtractor(filePath, extractor) {
  const base = basename(filePath);
  if (extractor === 'basename') return base;
  if (extractor === 'basename-no-ext') {
    const ext = extname(base);
    return ext ? base.slice(0, -ext.length) : base;
  }
  // Unknown extractor → fall back to bare basename. Don't throw — a future
  // CLI version might introduce more extractors, and we want old configs to
  // degrade gracefully rather than crash a guard run.
  return base;
}

/**
 * Slice a markdown document down to a single section, identified by a heading
 * substring match (case-insensitive). The slice runs from that heading to the
 * next heading of equal or higher level (so a `##` section ends at the next
 * `##` or `#`, but `###` subsections are included).
 *
 * Returns the original `content` if `heading` is falsy. Returns an empty string
 * if the heading isn't found — callers treat that as "section absent, no
 * documented tokens here," which surfaces as a "missing-from-doc" warning for
 * every code item (correctly: the section the user said to scope to does not
 * exist in this doc).
 */
function sliceSection(content, heading) {
  if (!heading) return content;
  const lines = content.split('\n');
  const needle = String(heading).toLowerCase().replace(/^#+\s*/, '').trim();
  if (!needle) return content;

  // Find the start: any heading line whose text (after stripping `#`s) contains
  // the configured heading. Substring match keeps the config tolerant of
  // emoji prefixes and trailing decorations in the actual document.
  let startIdx = -1;
  let startLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) continue;
    const headingText = m[2].toLowerCase();
    if (headingText.includes(needle)) {
      startIdx = i;
      startLevel = m[1].length;
      break;
    }
  }
  if (startIdx === -1) return '';

  // Find the end: next heading of <= startLevel depth.
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= startLevel) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
}

/**
 * Parse a markdown file (or a slice of one) and return the set of tokens
 * found in "list contexts" — table rows (first column) and bullet items.
 * Backtick-wrapped only. This deliberately ignores backticks in prose,
 * code blocks, and headings.
 *
 * Code blocks (```...```) are stripped first so that a fenced shell example
 * like `npx docguard-cli demo` cannot inflate the documented set with the
 * `demo` token. Tables and bullets remain the only authoritative inventory.
 */
function extractDocumentedTokens(content) {
  const tokens = new Set();
  // Strip fenced code blocks — shell examples, json snippets, mermaid blocks,
  // and any inline reference inside them is NOT a list entry.
  const stripped = content.replace(/```[\s\S]*?```/g, '');

  // Normalize a captured token. Strips a leading `docguard ` or `/` (common
  // doc conventions for command tables and slash-command lists), reduces
  // multi-word forms to the first token, and lower-cases — downstream
  // comparison is case-insensitive so README's `**API-Surface**` matches
  // code-truth `api-surface`.
  const normalize = (raw) => {
    if (!raw) return '';
    const cleaned = String(raw).trim()
      .replace(/^docguard\s+/i, '')
      .replace(/^\//, '');
    const firstToken = cleaned.split(/\s+/)[0];
    return firstToken.toLowerCase();
  };

  // Pattern A: backticked token in a list context.
  //   - Start of a table row:                 `| `name` | … |`
  //   - Numbered-cell table row:              `| 1 | `name` | … |`
  //   - Bullet list item:                     `- `name` …`
  // Restricting to these contexts keeps prose backticks out of the
  // documented set; a backticked `--verbose` mid-paragraph is not a list
  // entry and must not inflate the set.
  const backtickListRe =
    /(?:^\s*\|\s*(?:\d+\s*\|\s*)?|^\s*[-*+]\s+)`([^`\n]+)`/gim;
  let m;
  while ((m = backtickListRe.exec(stripped)) !== null) {
    const t = normalize(m[1]);
    if (t) tokens.add(t);
  }

  // Pattern B: bolded token in a table row. Matches the validators-style
  // tables that use `| N | **Name** | description |` — backticks alone
  // miss every entry in those tables. Restricted to lines starting with
  // `|` so prose-level **bold** is not pulled in.
  const boldRowRe = /^\s*\|.*?\*\*([^*\n]+)\*\*/gim;
  while ((m = boldRowRe.exec(stripped)) !== null) {
    const t = normalize(m[1]);
    if (t) tokens.add(t);
  }

  return tokens;
}

/**
 * Validate surface drift for a single surface against its target docs.
 * Returns warnings, fixes, passed count, and total count.
 */
function checkSurface(projectDir, surface) {
  const out = { warnings: [], fixes: [], passed: 0, total: 0 };
  const name = surface.name || 'unnamed';
  const extractor = surface.extract || 'basename-no-ext';
  const ignore = new Set(surface.ignore || []);
  const docs = Array.isArray(surface.docs) && surface.docs.length > 0
    ? surface.docs
    : ['README.md'];

  // Discover code-truth set from glob.
  if (!surface.glob || typeof surface.glob !== 'string') {
    out.warnings.push(
      `surfaceSync: surface "${name}" has no \`glob\` — skipping. Add a glob like "cli/commands/*.mjs".`
    );
    return out;
  }
  const files = expandGlob(projectDir, surface.glob);
  // Lower-case code-truth to keep comparison case-insensitive — README
  // commonly uses display-cased identifiers (`**API-Surface**`, `Freshness`)
  // while file basenames are lowercase (`api-surface.mjs`). The `ignore`
  // list is matched against the case-folded form, so users can write
  // either `["Setup"]` or `["setup"]` and it works.
  const ignoreLower = new Set([...ignore].map(s => String(s).toLowerCase()));
  const codeTruth = new Set(
    files
      .map(f => applyExtractor(f, extractor).toLowerCase())
      .filter(token => !ignoreLower.has(token))
  );
  if (codeTruth.size === 0) {
    // No items discovered — surface is N/A for this project. Don't warn
    // (the user has explicitly enabled the surface, but the glob found
    // nothing — maybe they renamed a directory; surface up the info but
    // do NOT escalate into a check failure).
    return out;
  }

  // For each target doc, compute documented set and diff.
  for (const docRel of docs) {
    const docPath = resolve(projectDir, docRel);
    if (!existsSync(docPath)) {
      // Doc doesn't exist — silently skip; another validator (structure)
      // covers missing-doc cases.
      continue;
    }

    let content;
    try {
      content = readFileSync(docPath, 'utf-8');
    } catch {
      continue;
    }

    // Optional section scope: restrict scanning to a single heading's body.
    // Without this, every backticked first-column token in the doc is
    // pooled into one "documented" set — and a commands surface ends up
    // matching against the validators table too, producing cross-table
    // false positives. Section-scoping is the user's per-surface override
    // when one doc lists multiple surfaces.
    const scope = surface.section
      ? sliceSection(content, surface.section)
      : content;

    const documented = extractDocumentedTokens(scope);
    out.total++;

    const missingFromDoc = [...codeTruth].filter(t => !documented.has(t));
    // missingFromCode tells you about items the doc lists that don't exist
    // in code — usually removed or renamed surfaces. Filter through `ignore`
    // too so deprecation aliases listed in the doc don't fire warnings.
    const missingFromCode = [...documented]
      .filter(t => !codeTruth.has(t) && !ignoreLower.has(t))
      // Only consider tokens that match the surface naming convention to
      // avoid pulling in unrelated backticked items from a different table
      // that happens to be in the same doc.
      .filter(t => surfaceNameLooksValid(t));

    if (missingFromDoc.length === 0 && missingFromCode.length === 0) {
      out.passed++;
      continue;
    }

    const parts = [];
    if (missingFromDoc.length > 0) {
      const shown = missingFromDoc.slice(0, 8).map(t => `\`${t}\``).join(', ');
      const extra = missingFromDoc.length - 8;
      const tail = extra > 0 ? ` (+${extra} more)` : '';
      parts.push(`${missingFromDoc.length} in code but missing from ${docRel}: ${shown}${tail}`);
    }
    if (missingFromCode.length > 0) {
      const shown = missingFromCode.slice(0, 8).map(t => `\`${t}\``).join(', ');
      const extra = missingFromCode.length - 8;
      const tail = extra > 0 ? ` (+${extra} more)` : '';
      parts.push(`${missingFromCode.length} listed in ${docRel} but not found in code: ${shown}${tail}`);
    }
    out.warnings.push(`Surface "${name}" drift: ${parts.join('; ')}`);
  }

  return out;
}

/**
 * Loose sanity filter for tokens before reporting them as "missing from code".
 * Real surface names are short identifiers; if a regex catches something
 * that looks like prose, drop it silently.
 */
function surfaceNameLooksValid(t) {
  return typeof t === 'string'
    && t.length >= 2
    && t.length <= 64
    && /^[a-z][a-z0-9_.-]*$/i.test(t);
}

/**
 * Public entry point. Returns N/A when no surfaces are configured — by
 * design, this validator is opt-in. Projects that don't declare surfaces
 * see zero noise.
 */
export function validateSurfaceSync(projectDir, config) {
  const surfaceCfg = (config && config.surfaceSync && Array.isArray(config.surfaceSync.surfaces))
    ? config.surfaceSync.surfaces
    : [];

  const result = { errors: [], warnings: [], fixes: [], passed: 0, total: 0 };

  if (surfaceCfg.length === 0) {
    // No surfaces configured → N/A. The validator infrastructure surfaces
    // this as "nothing to validate" rather than a fail.
    return result;
  }

  for (const surface of surfaceCfg) {
    const r = checkSurface(projectDir, surface);
    result.warnings.push(...r.warnings);
    result.fixes.push(...r.fixes);
    result.passed += r.passed;
    result.total += r.total;
  }

  return result;
}
