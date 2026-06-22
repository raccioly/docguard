/**
 * Findings — the structured, LLM-addressable result unit (v0.27).
 *
 * Background (LLM field report #3): DocGuard's whole job is to tell an agent
 * what to do NEXT. A free-text `errors`/`warnings` string can't carry a stable
 * code (for `explain <CODE>` + inline suppression), a confidence (the signal
 * the false-positive feedback loop runs on), or a machine-readable suggested
 * action. A Finding carries all three.
 *
 * The migration is INCREMENTAL and BACKWARD-COMPATIBLE. A validator that opts in
 * builds `Finding[]` and returns `resultFromFindings(...)`, which still emits the
 * exact `{ errors, warnings, passed, total }` shape every existing consumer
 * (guard counts + exit code, diagnose, score, ci, `--format json`) already reads
 * — PLUS a `findings` array that guard renders richly (each issue gets its
 * `→ suggestion`). Validators that haven't migrated keep returning their
 * hand-built results and render exactly as before. Nothing regresses.
 *
 * Zero npm dependencies — pure Node.js built-ins.
 *
 * @typedef {Object} Suggestion
 * @property {'fix'|'suppress'|'review'|'report'} kind
 * @property {string}  text             One concise line: what to do next.
 * @property {string} [command]         Optional CLI/skill command to run.
 * @property {string} [pragma]          Optional inline suppression snippet.
 *
 * @typedef {Object} Finding
 * @property {string}      code          Stable code, e.g. 'SEC001' (see CODES).
 * @property {string}      validator     Owning validator key.
 * @property {'error'|'warn'} severity
 * @property {'high'|'low'} confidence   'low' = candidate false positive.
 * @property {string}      message       Concise, NO ansi colour.
 * @property {string|null} location      'path:line' or 'path'.
 * @property {Suggestion|null} suggestion
 * @property {boolean}     reportable    Surface in `docguard feedback`.
 * @property {string|null} redactedContext  Safe-to-share context for a report.
 */

/**
 * Stable finding-code registry. `docguard explain <CODE>` reads this, and
 * inline `// docguard:ignore <CODE>` keys off it. Keep codes append-only — a
 * published code is a public surface we don't renumber.
 */
export const CODES = {
  SEC001: {
    validator: 'security',
    title: 'Hardcoded password',
    help: 'A `password`/`passwd`/`pwd` assignment with a quoted literal value (8+ chars). If the value is natural-language UI copy or a validation message — not a credential — this is a false positive: DocGuard now flags those low-confidence, but you can suppress inline.',
    suppress: '// docguard:ignore SEC001 — UI copy, not a credential',
  },
  SEC002: {
    validator: 'security',
    title: 'Hardcoded API key',
    help: 'An `api_key`/`apikey` assignment with a quoted literal value (16+ chars). Move it to an environment variable and read it via `process.env`.',
    suppress: '// docguard:ignore SEC002 — sample value in fixture',
  },
  SEC003: {
    validator: 'security',
    title: 'Hardcoded secret key',
    help: 'A `secret_key`/`secretkey` assignment with a quoted literal value (16+ chars). Move it to an environment variable.',
    suppress: '// docguard:ignore SEC003 — reason',
  },
  SEC004: {
    validator: 'security',
    title: 'Hardcoded access token',
    help: 'An `access_token`/`accesstoken` assignment with a quoted literal value (16+ chars). Move it to an environment variable.',
    suppress: '// docguard:ignore SEC004 — reason',
  },
  SEC005: {
    validator: 'security',
    title: 'AWS Access Key ID',
    help: 'A string matching the AWS Access Key ID format (AKIA…). Rotate it immediately if real, and move credentials to the AWS credential chain / environment.',
    suppress: '// docguard:ignore SEC005 — documented example key',
  },
  SEC006: {
    validator: 'security',
    title: 'API secret key (Stripe/OpenAI pattern)',
    help: 'A string matching a live/test secret-key format (sk-…, sk_live_…). Rotate it if real and move it to an environment variable.',
    suppress: '// docguard:ignore SEC006 — reason',
  },
  SEC010: {
    validator: 'security',
    title: '.env not in .gitignore',
    help: 'No `.env` entry was found in .gitignore, so a local `.env` could be committed. Add `.env` (and `.env.local`) to .gitignore.',
    suppress: null,
  },
  SEC011: {
    validator: 'security',
    title: 'No source files scanned for secrets',
    help: 'The secret scan matched zero source files — usually a too-broad ignore config or a wrong sourceRoot. A scan that checks nothing is a dangerous false ✅.',
    suppress: null,
  },
};

/**
 * Build a Finding with sane defaults. `reportable` defaults to true for
 * low-confidence findings — low confidence IS the feedback signal.
 *
 * @param {Partial<Finding>} f
 * @returns {Finding}
 */
export function mkFinding(f) {
  const severity = f.severity === 'error' ? 'error' : 'warn';
  const confidence = f.confidence === 'low' ? 'low' : 'high';
  return {
    code: f.code || null,
    validator: f.validator || null,
    severity,
    confidence,
    message: f.message || '',
    location: f.location || null,
    suggestion: f.suggestion || null,
    reportable: f.reportable === true || confidence === 'low',
    redactedContext: f.redactedContext || null,
  };
}

/**
 * Derive the legacy `{ errors, warnings, passed, total }` result from a list of
 * findings, keeping `findings` attached for the rich renderer. ONE source of
 * truth — the strings guard counts and the findings guard renders can never
 * disagree because they're computed from the same array.
 *
 * @param {Finding[]} findings
 * @param {{passed?:number, total?:number, applicable?:boolean}} [opts]
 */
export function resultFromFindings(findings, opts = {}) {
  const errors = [];
  const warnings = [];
  for (const f of findings) {
    if (f.severity === 'error') errors.push(f.message);
    else warnings.push(f.message);
  }
  const res = {
    errors,
    warnings,
    passed: opts.passed || 0,
    total: opts.total != null ? opts.total : 0,
    findings,
  };
  if (opts.applicable !== undefined) res.applicable = opts.applicable;
  return res;
}

/**
 * Does an inline `docguard:ignore` pragma in `text` suppress finding `code`?
 *
 * Accepted forms (mirrors the ergonomics of eslint-disable / ruff `# noqa`):
 *   docguard:ignore                 → suppresses ANY code on the line
 *   docguard:ignore SEC001          → suppresses exactly SEC001
 *   docguard:ignore SEC001,DQ002    → comma list
 *   docguard:ignore SEC*            → prefix wildcard
 *   docguard:ignore all             → suppresses any code
 *   docguard:ignore-secret          → convenience alias for any SEC* code
 *
 * @param {string} text
 * @param {string} code
 * @returns {boolean}
 */
export function suppressesCode(text, code) {
  if (!text || !code) return false;
  const m = text.match(/docguard:ignore(-secret)?\b[ \t]*([A-Za-z0-9_,*-]+)?/i);
  if (!m) return false;
  if (m[1]) return /^SEC/i.test(code);            // ignore-secret alias
  const arg = (m[2] || '').trim();
  if (!arg) return true;                           // bare ignore → any code
  return arg.split(',').map((s) => s.trim()).some((tok) => {
    if (!tok) return false;
    if (tok.toLowerCase() === 'all') return true;
    if (tok.endsWith('*')) return code.toUpperCase().startsWith(tok.slice(0, -1).toUpperCase());
    return tok.toUpperCase() === code.toUpperCase();
  });
}

/**
 * Source-line suppression: an ignore pragma counts if it's on the flagged line
 * OR the line directly above it (so a comment can sit above the offending
 * statement, the common style for non-trailing-comment languages).
 */
export function lineSuppresses(code, line, prevLine = '') {
  return suppressesCode(line, code) || suppressesCode(prevLine, code);
}

/**
 * Flatten a one-line, colour-free rendering of a suggestion — used by JSON
 * consumers, diagnose, and the feedback body. Guard does its own coloured
 * rendering and does not use this.
 */
export function suggestionLine(s) {
  if (!s) return '';
  let out = s.text || '';
  if (s.command) out += `  →  ${s.command}`;
  else if (s.pragma) out += `  →  ${s.pragma}`;
  return out;
}
