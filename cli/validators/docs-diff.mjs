/**
 * Docs-Diff Validator — Checks alignment between canonical docs and code.
 *
 * Runs as part of `docguard guard` on every invocation.
 * Detects undocumented code artifacts and documented items not found in code.
 * Returns warnings (not errors) since drift is a soft signal.
 *
 * Respects config.ignore and config.testPatterns for test file discovery.
 * Uses shared-ignore.mjs for consistent filtering (Constitution IV, v1.1.0).
 *
 * v0.29: migrated to structured findings (DDF001–DDF002). Messages are
 * byte-identical to the legacy strings — resultFromFindings derives the
 * errors/warnings arrays from the same findings, so counts, exit codes, and
 * existing tests are unaffected; guard just renders richer output.
 *
 * v0.44 (specs/061-dogfood-round-2): documented tests are read with the same
 * configured test patterns as the code side, and a technology found only by a
 * source-text signal names its file in DDF001.
 * @implements docguard.dogfood-round-2#FR-001
 * @implements docguard.dogfood-round-2#FR-004
 * @implements docguard.dogfood-round-2#FR-007
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename, relative } from 'node:path';
import { shouldIgnore, globMatch, compileGlob, walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { resolveSourceRoots } from '../shared-source.mjs';
import { scanCodeTechnologies, TECH_PATTERNS } from '../scanners/tech-stack.mjs';
import { docRolePath, resolveDocRole } from '../shared-doc-roles.mjs';
import { mkFinding, resultFromFindings } from '../findings.mjs';
import { visibleMarkdown } from '../shared-html-comments.mjs';

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
  'docs-canonical', 'docs-implementation', 'templates',
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.py', '.java', '.go', '.rs', '.rb', '.php',
]);

// v0.29: one stable finding code per drift domain (not per occurrence).
// Location = the canonical doc that owns the domain, so an agent knows which
// file to reconcile. Drift is two-sided (doc stale OR code changed), hence
// suggestion kind 'review' — a human decides which side is wrong.
const DRIFT_FINDINGS = {
  'Tech Stack': {
    code: 'DDF001',
    role: 'architecture',
    suggestion: {
      kind: 'review',
      text: 'Reconcile the Tech Stack in ARCHITECTURE.md with the actual dependencies — document the new tech or remove stale entries',
    },
  },
  'Test Files': {
    code: 'DDF002',
    role: 'testSpec',
    suggestion: {
      kind: 'review',
      text: 'Reconcile TEST-SPEC.md with the test files on disk — document new tests or remove stale entries',
    },
  },
};

/**
 * Validate doc-code alignment — compares canonical docs vs source code.
 * @returns {{ errors: string[], warnings: string[], passed: number, total: number }}
 */
export function validateDocsDiff(projectDir, config = {}) {
  const findings = [];
  let passed = 0;
  let total = 0;

  // NOTE: env-var drift is owned by the Environment validator (which compares
  // documented vars against real process.env / import.meta.env usage). Docs-Diff
  // covers tech-stack and test-file drift to avoid double-reporting.
  const checks = [
    techStackDiff(projectDir, config),
    diffTests(projectDir, config),
  ];

  // Limit how many offending names are inlined in a single warning — keeps
  // the line readable on terminals while still naming the specific files so
  // the warning is actually actionable. Without these names the user gets a
  // bare count ("1 documented but not found in code") with no path to debug.
  const MAX_INLINE = 5;
  // A technology found only by a source-text signal names the file it came
  // from; manifest-detected names stay byte-identical (baseline fingerprints).
  const fmtList = (arr, sources = {}) => {
    const shown = arr.slice(0, MAX_INLINE).map(v => `\`${v}\`` + (sources[v] ? ` (${sources[v]})` : '')).join(', ');
    const extra = arr.length - MAX_INLINE;
    return extra > 0 ? `${shown} (+${extra} more)` : shown;
  };

  for (const result of checks) {
    if (!result) continue;

    total++;
    const undocumented = result.onlyInCode.length;
    const stale = result.onlyInDocs.length;

    if (undocumented === 0 && stale === 0) {
      passed++;
    } else {
      const parts = [];
      if (undocumented > 0) {
        parts.push(`${undocumented} in code but not documented: ${fmtList(result.onlyInCode, result.sources)}`);
      }
      if (stale > 0) {
        parts.push(`${stale} documented but not found in code: ${fmtList(result.onlyInDocs)}`);
      }
      const meta = DRIFT_FINDINGS[result.title] || {};
      findings.push(mkFinding({
        code: meta.code,
        validator: 'docsDiff',
        severity: 'warn',
        message: `${result.title} drift: ${parts.join('; ')}`,
        location: docRolePath(config, meta.role),
        suggestion: meta.suggestion,
      }));
    }
  }

  return resultFromFindings(findings, { passed, total });
}

// ── Diff Functions (lightweight versions for validator) ──────────────────

// A negator governs every item of the coordinated list it opens: "no CDK,
// Terraform or Pulumi stacks". The list is a run of items of at most three
// words joined by commas, "or" or "nor", holding no verb or preposition of the
// closed set below, and it must be a list on both sides of the mention: a
// middle item is followed by more items and a coordinator ("CDK, Terraform or
// Pulumi"), a last item by at most three words to the clause end ("… or
// Terraform stacks"). "No Docker, Express serves the API" negates Docker only.
// "and" is not a list coordinator here: "without Docker and PostgreSQL runs
// locally" starts a new clause as often as it extends a list.
// List words exclude the coordinators and the separators are disjoint, so the
// patterns parse one way only and stay linear on long lines.
// @implements docguard.doc-validator-fidelity#FR-003
const LIST_NEGATOR = /\b(?:no|without|neither|nor|not\s+using|none\s+of)\b/gi;
const LIST_STOP = /\b(?:is|are|was|were|be|been|being|uses?|used|using|requires?|required|has|have|had|but|to|of|for|in|on|with|from|by|at|about|into|than)\b/i;
const LIST_WORD = "(?!(?:or|nor|and)\\b)[\\w.+#/'’-]+";
const LIST_ITEM = `${LIST_WORD}(?:\\s+${LIST_WORD}){0,2}`;
// The separators are disjoint (a comma not followed by a coordinator, or a
// coordinator with or without a comma), so a run of separators has one parse.
const LIST_COMMA = '\\s*,\\s*(?!(?:or|nor)\\b)';
const LIST_COORD = '(?:\\s*,\\s*|\\s+)(?:or|nor)\\s+';
const LIST_BEFORE = new RegExp(`^\\s*(?:${LIST_ITEM}(?:${LIST_COORD}|${LIST_COMMA}))+$`, 'i');
// After the list's last item only nouns for a technology's own artifacts may
// follow ("… or Terraform stacks"), then the clause ends or a prepositional
// phrase starts ("stacks in this repo"). Anything else is a predicate: in "No
// Docker or Redis caches sessions" and "No ORM, PostgreSQL or SQLite
// directly" the technologies are in use.
const LIST_ARTIFACT = '(?:blocks?|modules?|stacks?|files?|configs?|configurations?|templates?|scripts?|resources?|providers?|definitions?|manifests?|containers?|images?|clusters?|instances?|servers?|deployments?|layers?|integrations?|dependenc(?:y|ies)|artifacts?|infrastructure)';
// An existence predicate may close the negated list ("No CDK, Terraform or
// Pulumi artifacts are expected"): it states the absence, it is not a use.
const LIST_EXISTENCE = '(?:\\s+(?:are|is|were|was|will\\s+be|have\\s+been|has\\s+been)(?:\\s+(?:currently|yet|ever))?\\s+(?:expected|used|needed|required|present|allowed|planned|involved|included|configured|deployed|supported|committed|checked\\s+in))?';
const LIST_END = `(?:\\s+${LIST_ARTIFACT}){0,2}${LIST_EXISTENCE}\\s*(?:$|[,:;)]|(?:in|from|at|on|for|since|during|within|across|anywhere|here|yet|today|currently|whatsoever)\\b)`;
const LIST_ENDS = new RegExp(`^${LIST_END}`, 'i');
// The list's last item is one word, or two when the second is a name ("AWS
// CDK"), so a predicate is not read as part of it ("… or PostgreSQL store
// nothing"). Case-sensitive for that reason; coordinators are lowercase.
const LIST_LAST = `${LIST_WORD}(?:\\s+(?=[A-Z0-9])${LIST_WORD})?`;
const LIST_CONTINUES = new RegExp(`^(?:${LIST_COMMA}${LIST_ITEM})*${LIST_COORD}${LIST_LAST}${LIST_END}`);

/**
 * True when the nearest negator before a mention opens a coordinated list
 * that the mention belongs to. `prefix` is the clause before the mention,
 * `rest` the clause after it.
 */
function negatedByList(prefix, rest) {
  let negator = null;
  for (const match of prefix.matchAll(LIST_NEGATOR)) negator = match;
  if (!negator) return false;
  const tail = prefix.slice(negator.index + negator[0].length);
  if (LIST_STOP.test(tail) || !LIST_BEFORE.test(tail)) return false;
  if (/\b(?:or|nor)\s*$/i.test(tail)) return LIST_ENDS.test(rest);
  return LIST_CONTINUES.test(rest);
}

// A removal or migration verb before a technology negates it ("We removed
// Terraform", "migrated off Terraform", "Removed the template's Terraform
// blocks"); at most three filler words stand between them. It negates the
// technology only when the technology is the object removed: what follows is
// nothing, a preposition ("in 1.0", "with PostgreSQL") or a noun for the
// technology's own artifacts ("blocks", "modules"). "Removed all Redis keys"
// and "replaced the Redis client library" keep Redis in use. After a
// technology the participle needs an auxiliary, because a bare "Terraform
// replaced X" keeps Terraform in use. "replaced X with Y" negates X only.
// @implements docguard.doc-validator-fidelity#FR-004
const REMOVAL_FILLER = "(?:(?:the|a|an|our|its|their|this|that|all|any|old|legacy|former|existing|[\\w]+['’]s)\\s+){0,3}";
const REMOVAL_BEFORE = new RegExp(
  '\\b(?:removed|dropped|deleted|retired|decommissioned|replaced|phased\\s+out|stopped\\s+using|' +
  'no\\s+longer\\s+(?:uses?|using|runs?|running|needs?)|' +
  '(?:migrated|moved|switched|rolled)\\s+(?:off|away\\s+from|back\\s+from))\\s+' + REMOVAL_FILLER + '$', 'i');
const REMOVAL_OBJECT_END = /^(?:$|[,:;)]|(?:in|from|at|on|for|since|during|with|by|as|after|before|to|because|due|entirely|completely|altogether|and|or)\b|(?:blocks?|modules?|stacks?|files?|config(?:uration)?s?|dependenc(?:y|ies)|integrations?|resources?|templates?|scripts?|infrastructure|layers?|providers?|definitions?|manifests?)\b)/i;
const REMOVAL_AFTER = /^(?:(?:is|was|were|are|has\s+been|have\s+been)\s+(?:removed|dropped|deleted|retired|decommissioned|replaced|phased\s+out)\b)/i;

/** True when a removal verb before the mention takes the technology itself as its object. */
function removedBefore(prefix, after) {
  return REMOVAL_BEFORE.test(prefix) && REMOVAL_OBJECT_END.test(after.trim());
}

// Sections that record change over time describe past state by definition.
// @implements docguard.doc-validator-fidelity#FR-005
const CHANGE_RECORD_HEADINGS = new Set([
  'revision history', 'change history', 'document history', 'version history',
  'history', 'revisions', 'changelog', 'change log', 'release notes',
]);
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * The document without its change-record sections (heading through the next
 * heading of the same or a higher level). Comments are removed first and a
 * `#` line inside a fenced block is code, not a heading.
 */
export function withoutChangeRecords(markdown) {
  const out = [];
  let skipLevel = 0;
  let fence = null;
  for (const line of visibleMarkdown(markdown).split('\n')) {
    const marker = line.match(FENCE);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.slice(marker[0].length).trim() === '') fence = null;
    } else if (marker) {
      fence = marker[1];
    } else {
      const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (heading) {
        const level = heading[1].length;
        // A change record under an H1 ends at the next H1 or H2, so a document
        // titled "# Revision History" does not hide every section after it.
        if (skipLevel && level <= Math.max(skipLevel, 2)) skipLevel = 0;
        const text = heading[2].replace(/^\d+(?:\.\d+)*\.?\s+/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        // Only a top-level (H1/H2) heading opens a change record: "### History"
        // is as likely a component named History.
        if (!skipLevel && level <= 2 && CHANGE_RECORD_HEADINGS.has(text)) { skipLevel = level; continue; }
      }
    }
    if (!skipLevel) out.push(line);
  }
  return out.join('\n');
}

/** Evaluate mentions locally; optionality is not evidence of absence or use. */
function mentionsCurrentTechnology(content, tech, technologies) {
  const escape = value => value.replace(/[.*+?^\x24{}()|[\]\\]/g, character => '\\' + character);
  const names = new RegExp('\\b(?:' + technologies.map(escape).join('|') + ')\\b', 'gi');
  const sentences = content.replace(/<!--[^]*?-->/g, '').replace(/[\x60*]/g, '')
    .split(/\n|[;!?]|\.(?=\s|$)/);
  for (const sentence of sentences) {
    let subject = null;
    for (let clause of sentence.split(/\b(?:but|whereas|while|however)\b/i)) {
      let mentions = [...clause.matchAll(names)];
      // Carry an omitted subject only within the same sentence, and only for
      // an explicit continuation predicate ("but [it] is used ...").
      if (!mentions.length && subject && /^\s*,?\s*(?:it\s+)?(?:is|was|remains)\s+/i.test(clause)) {
        clause = subject + ' ' + clause.trim().replace(/^,\s*/, '').replace(/^it\s+/i, '');
        mentions = [...clause.matchAll(names)];
      }
      if (mentions.length) subject = mentions.at(-1)[0];
      // A leading "No" governs every item in a subject list, including tools
      // outside our vocabulary. Stop at the predicate; later claims stay live.
      const negativeList = /^\s*No\s+(.+?)\s+(?:is|are|was|were)\s+used\b/i.exec(clause);
      const negativeListEnd = negativeList &&
        !/\b(?:is|are|was|were|uses?|used|requires?|required)\b/i.test(negativeList[1])
        ? clause.indexOf(negativeList[1]) + negativeList[1].length : -1;
      for (let i = 0; i < mentions.length; i++) {
        const mention = mentions[i];
        if (mention[0].toLowerCase() !== tech.toLowerCase()) continue;
        if (mention.index < negativeListEnd) continue;
        const before = clause.slice(i ? mentions[i - 1].index + mentions[i - 1][0].length : 0, mention.index);
        const after = clause.slice(mention.index + mention[0].length, mentions[i + 1]?.index ?? clause.length)
          .replace(/^\s*[|:(—-]\s*/, ' ').trim();
        const negativeBefore = /\b(?:no|without|neither|nor|not(?:\s+using|\s+used)?|(?:do|does|did)\s+not\s+use|never\s+used?|no\s+longer\s+(?:use|using)|(?:migrated|moved)\s+(?:away\s+)?from)\s*$/i;
        const historicalBefore = /\b(?:previously|formerly|historically|once)\s+(?:(?:we\s+)?(?:used?|using)\s+)?$|\bused\s+to\s+use\s*$/i;
        const negativeAfter = /^(?:(?:is|was|are|were)\s+)?(?:not\s+(?:used|using|supported|adopted)|no\s+longer\s+(?:used|supported)|unused|removed|retired)\b/i;
        const optionalAfter = /^(?:(?:is|was|are|were)\s+)?(?:not\s+(?:needed|required)|optional)\b/i;
        const historicalAfter = /^(?:(?:is|was|were)\s+)?(?:previously|formerly|historically|once)\b|^(?:was|were)\s+used\b/i;
        const prefix = clause.slice(0, mention.index);
        const rest = clause.slice(mention.index + mention[0].length);
        if (!negativeBefore.test(before) && !historicalBefore.test(before) &&
            !negatedByList(prefix, rest) && !removedBefore(prefix, after) &&
            !negativeAfter.test(after) && !optionalAfter.test(after) && !historicalAfter.test(after) &&
            !REMOVAL_AFTER.test(after)) return true;
      }
    }
  }
  return false;
}

export function diffTechStack(dir, config = {}) {
  const result = techStackDiff(dir, config);
  if (!result) return null;
  const { sources, ...diff } = result;
  return diff;
}

/** The tech-stack diff plus `sources`: technology → "file: signal" for text-detected ones. */
function techStackDiff(dir, config = {}) {
  const archPath = resolveDocRole(dir, config, 'architecture');
  if (!existsSync(archPath)) return null;

  // Monorepo-aware and ecosystem-aware: package.json files (root, source root,
  // workspaces) and every other manifest detectEcosystems parses. A repo with
  // no manifest anywhere yields no code-side truth → return null.
  // @implements docguard.dogfood-round-2#FR-007 {scope=statement}
  const scan = scanCodeTechnologies(dir, config);
  if (!scan.hasManifest) return null;

  const archContent = withoutChangeRecords(readFileSync(archPath, 'utf-8'));

  const docTech = new Set();
  const techPatterns = TECH_PATTERNS;

  for (const tech of techPatterns) {
    if (mentionsCurrentTechnology(archContent, tech, techPatterns)) {
      docTech.add(tech);
    }
  }

  // The code side is shared with `generate`, so the ARCHITECTURE.md it writes
  // names every technology this check looks for (docguard.generated-docs-consistency#FR-010).
  const { evidence, covered } = scan;
  const codeTech = new Set(evidence.map(e => e.tech));
  const sources = Object.fromEntries(evidence.filter(e => e.kind === 'source').map(e => [e.tech, `${e.file}: ${e.signal}`]));

  if (docTech.size === 0 && codeTech.size === 0) return null;

  return {
    title: 'Tech Stack',
    // Absence is reported only where a manifest could have shown the technology:
    // an unread ecosystem is not evidence (React in a Python-only repo).
    onlyInDocs: [...docTech].filter(t => !codeTech.has(t) && covered.has(t)),
    onlyInCode: [...codeTech].filter(t => !docTech.has(t)),
    sources,
  };
}

/**
 * The configured test-file globs: `testPatterns`, plus the legacy single
 * `testPattern` (loadConfig merges them; raw configs may carry either).
 * @returns {string[]}
 */
export function configuredTestPatterns(config = {}) {
  const patterns = Array.isArray(config?.testPatterns) ? [...config.testPatterns] : [];
  if (typeof config?.testPattern === 'string' && config.testPattern && !patterns.includes(config.testPattern)) {
    patterns.push(config.testPattern);
  }
  return patterns.filter(p => typeof p === 'string' && p);
}

/**
 * The test files a test spec documents — one definition for DDF002 and `diff`.
 * A documented test is a backticked, whitespace-free token outside fenced
 * code that ends in .test.<ext> / .spec.<ext> (optionally a glob), or that
 * matches a configured test pattern: the whole pattern, or, for a bare file
 * name, the pattern's last path segment. Without patterns, only the first
 * shape counts, exactly as before.
 * @implements docguard.dogfood-round-2#FR-001
 * @returns {Set<string>}
 */
export function extractDocumentedTests(markdown, config = {}) {
  // Strip fenced code blocks first — they contain shell commands like
  // `npx playwright test login.spec.ts` whose tokens were being mis-extracted
  // as documented test files.
  const content = String(markdown).replace(/```[\s\S]*?```/g, '');
  const docTests = new Set();
  const testFileName = /^[^`\s]*\.(?:test|spec)\.[a-zA-Z0-9]+$/;

  const patterns = configuredTestPatterns(config);
  const whole = patterns.map(p => compileGlob(p));
  const last = patterns.map(p => compileGlob(p.split('/').pop()));
  // Each pass anchors on its own token shape, so the closing backtick of a
  // code span that contains spaces never pairs with the next span's opener:
  // a test-file name; a token with brace groups (spaces after their commas,
  // `{alpha, beta}`, are not part of the paths); and, with test patterns
  // configured, any backticked token.
  const testNameToken = /`([^`\s]*\.(?:test|spec)\.[a-zA-Z0-9]+)`/g;
  const braceToken = /`([^`\s{}]*(?:\{[^`{}\n]*\}[^`\s{}]*)+)`/g;
  const tokenRegex = /`([^`\s]+)`/g;
  const tokens = [];
  let match;
  while ((match = testNameToken.exec(content)) !== null) tokens.push(match[1]);
  while ((match = braceToken.exec(content)) !== null) {
    const token = match[1].replace(/\{[^{}]*\}/g, group => group.replace(/\s+/g, ''));
    if (!/\s/.test(token)) tokens.push(token);
  }
  if (patterns.length > 0) while ((match = tokenRegex.exec(content)) !== null) tokens.push(match[1]);
  const accepted = (token) => {
    if (testFileName.test(token)) return true;
    if (patterns.length === 0) return false;
    return (token.includes('/') ? whole : last).some(rx => rx.test(token));
  };
  for (const raw of tokens) {
    // A brace list documents every path it expands to; a brace glob
    // (`src/**/*.test.{js,jsx}`) is one pattern that documents what any of its
    // alternatives matches, and `documentedTestRegex` reads it that way.
    // @implements docguard.doc-validator-fidelity#FR-002
    const expansions = expandBraces(raw);
    if (expansions.length > 1 && /[*?]/.test(raw)) {
      if (expansions.every(accepted)) docTests.add(raw);
      continue;
    }
    for (const token of expansions) if (accepted(token)) docTests.add(token);
  }
  return docTests;
}

/**
 * The regular expression a documented test entry (a path, a basename or a
 * glob, brace alternation included) stands for. One definition for DDF002 and
 * `docguard diff`.
 * @implements docguard.doc-validator-fidelity#FR-002
 * @param {string} target
 * @returns {RegExp}
 */
export function documentedTestRegex(target) {
  // `*` is any run of characters (as DDF002 always read it) and `?` one character.
  const one = (part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*').replace(/\?/g, '.');
  return new RegExp('^(?:' + expandBraces(target).map(one).join('|') + ')$');
}

/**
 * Expand single-level brace alternation (`a.{test,spec}.ts`, `{src,lib}/x`) the
 * way a shell does. A token with unbalanced braces, a group without a comma, a
 * nested group, or more than `cap` expansions stays literal.
 * @implements docguard.doc-validator-fidelity#FR-002
 * @param {string} token
 * @param {number} [cap]
 * @returns {string[]}
 */
export function expandBraces(token, cap = 64) {
  const parts = [];
  let literal = '';
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === '}') return [token];
    if (c !== '{') { literal += c; continue; }
    const close = token.indexOf('}', i + 1);
    if (close < 0) return [token];
    const body = token.slice(i + 1, close);
    if (body.includes('{') || !body.includes(',')) return [token];
    parts.push(literal, body.split(','));
    literal = '';
    i = close;
  }
  if (parts.length === 0) return [token];
  parts.push(literal);
  let results = [''];
  for (const part of parts) {
    const options = typeof part === 'string' ? [part] : part;
    if (results.length * options.length > cap) return [token];
    results = results.flatMap(prefix => options.map(option => prefix + option));
  }
  return [...new Set(results)];
}

/**
 * Diff test files between TEST-SPEC.md and actual code.
 * Uses config.testPatterns if available, otherwise falls back to
 * scanning standard test directories.
 * Always ignores node_modules via globMatch().
 */
function diffTests(dir, config) {
  const testSpecPath = resolveDocRole(dir, config, 'testSpec');
  if (!existsSync(testSpecPath)) return null;

  const docTests = extractDocumentedTests(readFileSync(testSpecPath, 'utf-8'), config);

  // Collect ALL test files from disk: configured patterns + every *.test.* /
  // *.spec.* file found recursively under each source root (catches co-located
  // and nested __tests__ dirs) + root-level conventional test dirs (e2e/, tests/).
  const codeTests = collectCodeTests(dir, config);

  if (docTests.size === 0 && codeTests.size === 0) return null;

  // TEST-SPEC.md frequently documents tests as GLOB PATTERNS
  // (`backend/src/*/__tests__/*.test.ts`, `e2e/*.spec.ts`), and entries may be
  // bare basenames or full paths. Treat each documented entry as a glob and
  // match it against code test paths (or basenames when the entry has no slash).
  // Exact-string comparison produced the false "N documented but not found".
  const codeArr = [...codeTests];

  // PERFORMANCE OPTIMIZATION: Pre-compile regular expressions to avoid O(N*M)
  // instantiation bottlenecks inside the nested .filter and .some loops below.
  const docMatchers = [...docTests].map(docEntry => {
    const entry = String(docEntry).trim();
    const hasSlash = entry.includes('/');
    const target = hasSlash ? entry : basename(entry);
    // Glob -> regex: escape regex specials, then any run of '*' becomes '.*'.
    const rx = documentedTestRegex(target);

    return {
      original: docEntry,
      hasSlash,
      rx
    };
  });

  const matches = (matcher, codeRel) => {
    const subject = matcher.hasSlash ? codeRel : basename(codeRel);
    return matcher.rx.test(subject);
  };

  return {
    title: 'Test Files',
    onlyInDocs: docMatchers.filter(m => !codeArr.some(c => matches(m, c))).map(m => m.original),
    onlyInCode: codeArr.filter(c => !docMatchers.some(m => matches(m, c))),
  };
}

/**
 * Collect every test file in the project (relative paths), monorepo-aware:
 *   - configured config.testPatterns
 *   - any *.test.* / *.spec.* found recursively under each source root
 *     (catches co-located and deeply-nested __tests__ directories)
 *   - root-level conventional test dirs (tests/, e2e/, cypress/, etc.)
 * @returns {Set<string>} relative test file paths
 */
export function collectCodeTests(dir, config = {}) {
  const codeTests = new Set();
  const isTest = (f) => /\.(test|spec)\./.test(f);

  // 1. configured patterns
  for (const f of getTestFilesFromPatterns(dir, configuredTestPatterns(config), config)) {
    codeTests.add(f);
  }

  // 2. recursive scan of each source root (co-located + nested __tests__)
  for (const root of resolveSourceRoots(dir, config)) {
    for (const f of getFilesRecursive(root, config)) {
      if (isTest(f)) {
        const rel = relative(dir, f);
        if (!shouldIgnore(rel, config)) codeTests.add(rel);
      }
    }
  }

  // 3. root-level conventional test dirs (e2e lives outside any source root)
  for (const td of ['tests', 'test', '__tests__', 'spec', 'e2e', 'cypress']) {
    const testDir = join(resolve(dir), td);
    if (!existsSync(testDir)) continue;
    for (const f of getFilesRecursive(testDir, config)) {
      if (isTest(f)) {
        const rel = relative(dir, f);
        if (!shouldIgnore(rel, config)) codeTests.add(rel);
      }
    }
  }

  return codeTests;
}

/**
 * Find test files matching configured testPatterns.
 * Uses globMatch() for pattern matching — always excludes node_modules.
 * Results are deduplicated via Set (handles overlapping patterns).
 */
export function getTestFilesFromPatterns(dir, patterns, config) {
  const results = new Set();

  // v0.29 consolidation: traversal delegates to the shared canonical walker;
  // per-file filtering (config ignore + positive globMatch) stays here.
  sharedWalkFiles(dir, (fullPath) => {
    const relPath = relative(dir, fullPath);
    // Skip files in globally ignored paths
    if (config && shouldIgnore(relPath, config)) return;
    // Use globMatch for positive pattern matching (rejects node_modules internally)
    if (globMatch(relPath, patterns)) {
      results.add(relPath);
    }
  }, { ignoreDirs: IGNORE_DIRS });
  return [...results];
}

// v0.29 consolidation: traversal delegates to the shared canonical walker.
function getFilesRecursive(dir, config) {
  const results = [];
  sharedWalkFiles(dir, (fullPath) => {
    if (CODE_EXTENSIONS.has(extname(fullPath))) results.push(fullPath);
  }, { ignoreDirs: IGNORE_DIRS });
  return results;
}
