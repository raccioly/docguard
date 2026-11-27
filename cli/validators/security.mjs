/**
 * Security Validator — Basic checks for secrets in code
 *
 * Respects config.securityIgnore (glob patterns) and config.ignore (global).
 * Uses shared-ignore.mjs for consistent filtering (Constitution IV, v1.1.0).
 * @implements docguard.precision-evidence-loop#FR-003
 * @implements docguard.dogfood-round-2#FR-005
 * @implements docguard.strict-by-default#FR-010
 * @implements docguard.field-report-fixes#FR-004
 * @implements docguard.field-report-fixes#FR-009
 * @implements docguard.field-report-fixes#FR-010
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { shouldIgnore, relPosix, isNonProductPath, walkFiles as sharedWalkFiles } from '../shared-ignore.mjs';
import { mkFinding, resultFromFindings, lineSuppresses } from '../findings.mjs';
import { parseJsTs, walk } from '../scanners/js-ast.mjs';
import { VISUALFORCE, codeExtensions } from '../shared-languages.mjs';

// Each secret pattern maps to a stable finding code (see cli/findings.mjs CODES)
// so it is `explain`-able and inline-suppressible (`// docguard:ignore SEC00x`).
const LABEL_TO_CODE = {
  'hardcoded password': 'SEC001',
  'hardcoded API key': 'SEC002',
  'hardcoded secret key': 'SEC003',
  'hardcoded access token': 'SEC004',
  'AWS Access Key ID': 'SEC005',
  'API secret key (Stripe/OpenAI pattern)': 'SEC006',
};

// Every programming language (specs/107-language-registry), dotenv files, and Visualforce markup, which can
// embed a literal (docguard.field-report-fixes#FR-004). A LaTeX `.cls` is scanned too: the safe direction.
const CODE_EXTENSIONS = codeExtensions(['.env', ...VISUALFORCE.extensions]);

// SECURITY EXEMPTION (tests/file-kinds-registry.test.mjs): the original narrow list, kept as it is on purpose.
// The shared build-output set also skips `out/`, `target/` and `obj/`, where a bundled key is still a leaked key.
const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build',
  'coverage', '.cache', '__pycache__', '.venv', 'vendor',
]);

// Patterns that might indicate hardcoded secrets
const SECRET_PATTERNS = [
  { pattern: /(?:password|passwd|pwd)\??\s*(?:=\s*|:\s*(?:[^'";=\n]+?=\s*)?)['"][^'"]{8,}['"]/gi, label: 'hardcoded password' },
  { pattern: /(?:api[_-]?key|apikey)\??\s*(?:=\s*|:\s*(?:[^'";=\n]+?=\s*)?)['"][^'"]{16,}['"]/gi, label: 'hardcoded API key' },
  { pattern: /(?:secret[_-]?key|secretkey)\??\s*(?:=\s*|:\s*(?:[^'";=\n]+?=\s*)?)['"][^'"]{16,}['"]/gi, label: 'hardcoded secret key' },
  { pattern: /(?:access[_-]?token|accesstoken)\??\s*(?:=\s*|:\s*(?:[^'";=\n]+?=\s*)?)['"][^'"]{16,}['"]/gi, label: 'hardcoded access token' },
  { pattern: /AKIA[0-9A-Z]{16}/g, label: 'AWS Access Key ID' },
  { pattern: /(?:sk-|sk_live_|sk_test_)[a-zA-Z0-9]{20,}/g, label: 'API secret key (Stripe/OpenAI pattern)' },
];

/**
 * A value that is synthetic by its own text (docguard.strict-by-default#FR-010):
 * it names itself a placeholder (`placeholder`, `synthetic`, `not-a-real`,
 * `notreal`, `dummy`, `changeme`, `change-me`, `example`) or is one repeated
 * character. `example` used to be a case-insensitive substring test in
 * `isSafePlaceholder`; since #655 it follows the same whole-segment rule as the
 * others. `xxx` and `your-` are deliberately not in the list.
 *
 * DECISION (a word buried in a real-looking key): the word must be a whole
 * segment of the value, split on non-alphanumerics and camelCase boundaries
 * (`MY_PLACEHOLDER_KEY`, `dummyApiKey`), or must open the value
 * (`dummykey123`). A word inside an unbroken high-entropy run
 * (`Zp2Wm7xdummyR41k8Jd93`) does not count. These values are dropped, not
 * demoted, so substring matching would let a leaked credential that happens to
 * contain `dummy` escape entirely. The cost is that `mydummykey` stays
 * reported; `docguard:ignore` covers it.
 *
 * @param {string} value - the literal, without quotes
 */
export function isSyntheticValue(value) {
  if (typeof value !== 'string' || !value) return false;
  if (/^(.)\1+$/s.test(value)) return true;
  if (/^(?:placeholder|synthetic|dummy|changeme|example)/i.test(value)) return true;
  const segments = value
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(seg => seg.toLowerCase());
  if (segments.some(seg => seg === 'example' || seg === 'placeholder' || seg === 'synthetic' || seg === 'notreal' || seg === 'dummy' || seg === 'changeme')) return true;
  return /(?:^|-)(?:not-a-real|change-me)(?:-|$)/.test(value.toLowerCase().replace(/[_\s]+/g, '-'));
}

/** File names the validator already treats as test files (fixture-password evidence, below). */
const TEST_FILE_NAME = /(?:^|\/)__tests?__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

/**
 * Storybook stories hold demo values the way tests hold fixtures
 * (docguard.field-report-fixes#FR-010). They are demo data for the secret context only, never
 * tests: a story must not count as test coverage, so this rule is not in `TEST_PATTERNS`.
 */
const STORYBOOK_FILE_NAME = /\.(?:stories|story)\.(?:[cm]?[jt]sx?|mdx|svelte|vue)$/;

/**
 * Where a literal sits: `test-path` for a test, fixture, example or mock path
 * (`isNonProductPath`, plus the test-file names the fixture-password rule
 * already recognizes), else `product`. A classification only: it never changes
 * a finding's level, because a real secret pasted into a test file is still a
 * leaked secret. `isGatingEligible` (findings.mjs) reads it so a test-path
 * finding can never count toward failing a build.
 * @returns {'product'|'test-path'}
 */
export function secretContext(relPath, config = {}) {
  return isNonProductPath(relPath, config) || TEST_FILE_NAME.test(relPath) || STORYBOOK_FILE_NAME.test(relPath) ? 'test-path' : 'product';
}

const CONTEXT_CODES = new Set(['SEC001', 'SEC002', 'SEC003', 'SEC004']);

/**
 * The secret access keys AWS publishes in its documentation, the pairs of
 * `AKIAIOSFODNN7EXAMPLE`. They sit in countless READMEs and tests. Exact match
 * only, under any pattern label that can match them (#655: the word-in-value
 * rule no longer hides them, so they need their own exception).
 */
const AWS_DOCUMENTATION_SECRETS = new Set([
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  'je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY',
]);

/**
 * Placeholder exemptions belong to the matched value, never sibling fields
 * or trailing comments. Recognizable provider keys use only the exact public
 * AWS example exception, even when the surrounding text says "example".
 */
function isSafePlaceholder(line, matchStr, label) {
  if (label === 'AWS Access Key ID') return matchStr === 'AKIAIOSFODNN7EXAMPLE';
  if (AWS_DOCUMENTATION_SECRETS.has(quotedValue(matchStr))) return true;
  if (label === 'API secret key (Stripe/OpenAI pattern)') return false;
  const value = quotedValue(matchStr);
  if (value === 'password123') return true;
  if (isSyntheticValue(value)) return true;
  // Retain documentation-only line comments; executable code followed by an
  // example comment is not documentation-only and must still be checked.
  return /^\s*\/\/\s*example\b/i.test(line);
}

/**
 * v0.27 (field report #1): a password-style key whose VALUE is natural
 * language — an error message, validation copy, UI string — is almost never a
 * credential. e.g. a "New password must differ from recent passwords"
 * validation message assigned to such a key.
 *
 * We don't drop these (a real secret that happens to read like prose must still
 * surface — false-green is the failure mode this tool exists to prevent); we
 * downgrade them to a LOW-CONFIDENCE warning the agent can suppress inline,
 * instead of a blocking error. Heuristic per the field report: ≥3 words, OR
 * ≥2 internal spaces, OR ends in sentence punctuation.
 *
 * @param {string} value - the literal inside the quotes
 */
function looksLikeProse(value) {
  if (!value) return false;
  const v = value.trim();
  const words = v.split(/\s+/).filter(Boolean);
  // Multi-word natural language (validation messages, UI copy, sentences).
  if (words.length >= 3) return true;
  // A 2-word sentence fragment ending in terminal punctuation — but NOT a
  // single token like "SuperSecretPassword!" (strong passwords end in !/? too,
  // so terminal punctuation ALONE must never reclassify a one-word value).
  if (words.length >= 2 && /[.!?]$/.test(v)) return true;
  return false;
}

/**
 * The word for "password" in common UI languages (lowercase). A form label
 * or translation-catalog entry holds one of these; a credential does not.
 */
const PASSWORD_WORDS = new Set([
  'password', 'passwort', 'kennwort', 'contraseña', 'contrasena', 'contrasenya', 'clave', 'senha',
  'palavra-passe', 'mot de passe', 'wachtwoord', 'wagwoord', 'parola', 'parolă', 'lösenord', 'losenord',
  'adgangskode', 'passord', 'salasana', 'lykilorð', 'hasło', 'haslo', 'heslo', 'jelszó', 'jelszo',
  'lozinka', 'geslo', 'slaptažodis', 'parole', 'parool', 'пароль', 'парола', 'лозинка', 'κωδικός',
  'şifre', 'sifre', 'parol', 'mật khẩu', 'kata sandi', 'kata laluan', 'kata kunci', 'पासवर्ड',
  'كلمة المرور', 'كلمة السر', 'סיסמה', 'รหัสผ่าน', 'パスワード', '密码', '密碼', '口令', '비밀번호', '암호',
]);
// Leading key segments that mark a UI string, not part of its meaning (`f_password`, `lblPassword`).
const UI_KEY_PREFIXES = new Set(['f', 'fld', 'field', 'lbl', 'label', 'txt', 'text', 'str', 'msg', 'i18n', 'l10n', 'ui', 'form', 'input']);

/** Split an identifier into lowercase words: camelCase, snake_case, kebab-case. */
function keyWords(key) {
  return key.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').split(/[\s_-]+/).filter(Boolean).map(w => w.toLowerCase());
}

/**
 * True when a password-keyed value is a label, not a credential (#527):
 * after trimming label decoration (`:`, `*`, an ellipsis) the value is a word
 * for "password", a phrase of at most four letter-only words containing one,
 * or the key's own words. It must read as copy — start with an uppercase
 * letter or a letter from a caseless script — and its key must not be an
 * all-caps constant (`DB_PASSWORD`), which names configuration, not copy.
 * A lowercase value equal to the word, and any value under an all-caps key,
 * therefore stay reported.
 * @implements docguard.dogfood-round-2#FR-005
 */
function isPasswordLabel(key, value) {
  if (!key || !/\p{Ll}/u.test(key)) return false;
  const text = value.trim().replace(/\s*(?:[:*]|\.\.\.|…)+$/u, '').trim();
  if (!text || !/^(?:\p{Lu}|\p{Lo})/u.test(text)) return false;
  const lower = text.toLowerCase().replace(/\s+/g, ' ');
  if (PASSWORD_WORDS.has(lower)) return true;
  const words = lower.split(' ');
  if (!words.every(w => /^[\p{L}\p{M}'’-]+$/u.test(w))) return false;
  // Collapse a multi-word password term ("mot de passe") into one slot.
  let phrase = ` ${lower} `;
  for (const term of PASSWORD_WORDS) if (term.includes(' ')) phrase = phrase.split(` ${term} `).join(' \u0000 ');
  const slots = phrase.trim().split(' ');
  if (slots.length <= 4 && slots.some(w => w === '\u0000' || PASSWORD_WORDS.has(w))) return true;
  const fromKey = keyWords(key);
  while (fromKey.length > 1 && UI_KEY_PREFIXES.has(fromKey[0])) fromKey.shift();
  return fromKey.join(' ') === words.join(' ');
}

/** Words of a key that name a credential (`COOKIE_ACCESS_TOKEN` → access, token). */
const CREDENTIAL_WORDS = new Set(['password', 'passwd', 'pwd', 'access', 'token', 'api', 'key', 'apikey', 'secret', 'accesstoken', 'secretkey']);

/** Key words that say the key holds the NAME of something (`COOKIE_ACCESS_TOKEN`, `tokenHeader`), not its value. */
const NAMING_WORDS = new Set(['cookie', 'header', 'param', 'parameter', 'query', 'field', 'name', 'storage', 'column', 'claim', 'attribute', 'attr', 'prop', 'property', 'env', 'var', 'variable', 'label', 'event', 'metric']);

/** A route segment: lowercase words joined by `-`, `_` or `.`, or a parameter (`:id`, `{id}`, `${id}`). */
const ROUTE_SEGMENT = /^(?:[a-z]+(?:[-_.][a-z0-9]+)*\d{0,3}|\d{1,4}|:[A-Za-z_]\w*|\{[A-Za-z_]\w*\}|\$\{[A-Za-z_]\w*\})$/;
/** A query parameter name that carries a credential. */
const CREDENTIAL_PARAM = /token|key|secret|pass|pwd|auth|sig|credential|session/i;

/**
 * The shape of a value that cannot be a credential, or null (docguard.field-report-fixes#FR-009).
 * The password and token patterns match a credential-looking key followed by any long enough
 * literal; these values are what the key names, not its secret:
 *   - `route`: `/forgot-password`, `./reset`, `#login`, `/users/:id`: lowercase words and parameters only;
 *   - `url`: an endpoint with a scheme and without `user:pass@` or a credential-named query value;
 *     a bare query parameter name (`?access_token=`) is one too;
 *   - `name`: `idp_access_token` under `COOKIE_ACCESS_TOKEN`: the key says it holds a name (a word such
 *     as cookie, header, field or storage), and the value is two to four lowercase words that contain
 *     every credential word of the key, with no word that mixes letters and digits;
 *   - `label`: `auth.refreshAccessToken`: two to five dotted identifiers, no `eyJ` (a JWT) and no
 *     segment with digits inside it or 20 characters or more.
 * Each is reported as a low-confidence warning, never dropped: a real secret could still take one
 * of these shapes, and `docguard:ignore` settles it.
 * @param {string} key - the identifier the literal is assigned to
 * @param {string} value - the literal, without quotes
 * @returns {'route'|'url'|'name'|'label'|null}
 */
export function nonCredentialShape(key, value) {
  if (typeof value !== 'string' || !value) return null;
  const v = value.trim();
  if (/^(?:\.?\/|#)/.test(v)) {
    const segments = v.replace(/^(?:\.?\/|#)/, '').replace(/\/$/, '').split('/');
    if (segments.every(seg => seg.length > 0 && seg.length < 25 && ROUTE_SEGMENT.test(seg))) return 'route';
    return null;
  }
  if (/^[?&][A-Za-z_][\w.-]*=$/.test(v)) return 'url';
  if (/^(?:https?|wss?):\/\/\S+$/i.test(v)) {
    let url;
    try { url = new URL(v); } catch { return null; }
    if (url.username || url.password) return null;
    for (const [name, val] of url.searchParams) if (val && CREDENTIAL_PARAM.test(name)) return null;
    return 'url';
  }
  if (/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+$/.test(v)) {
    const words = v.split(/[-_]/);
    const kw = keyWords(key || '');
    const credential = kw.filter(w => CREDENTIAL_WORDS.has(w));
    const naming = kw.some(w => NAMING_WORDS.has(w));
    const plain = words.length <= 4 && words.every(w => w.length < 20 && (/^[a-z]+$/.test(w) || /^\d{1,3}$/.test(w)));
    if (naming && plain && credential.length > 0 && credential.every(w => words.includes(w))) return 'name';
    return null;
  }
  const dotted = v.split('.');
  if (dotted.length >= 2 && dotted.length <= 5 && !/^eyJ/.test(v)
    && dotted.every(seg => seg.length > 0 && seg.length < 20 && /^[A-Za-z_$][A-Za-z_$]*\d{0,3}$/.test(seg))) return 'label';
  return null;
}

const SHAPE_TEXT = {
  route: 'the value is a route path, not a credential',
  url: 'the value is a URL or URL parameter name without credentials (an endpoint, not a credential)',
  name: "the value is a name made of the key's own words (a cookie, header or field name, not a credential)",
  label: 'the value is a dotted label (an event, metric or message key, not a credential)',
};

/** The identifier a secret match sits in: chars before the match plus the matched word. */
function matchedKey(content, index, matchStr) {
  let start = index;
  while (start > 0 && /[\p{L}\p{N}_$]/u.test(content[start - 1])) start--;
  return content.slice(start, index) + (matchStr.match(/^[A-Za-z]+/) || [''])[0];
}

/** Pull the first quoted literal out of a matched secret expression. */
function quotedValue(matchStr) {
  const m = matchStr.match(/['"]([^'"]*)['"]/);
  return m ? m[1] : '';
}

/**
 * Only explicit synthetic password vocabulary inside a mock-call expectation
 * qualifies. Test paths, assertion context, or a private-looking value alone
 * are insufficient. Provider key signatures remain independently scanned.
 * Unknown syntax/parser failure supplies no exemptions.
 */
function fixturePasswordEvidence(content, filename) {
  if (!TEST_FILE_NAME.test(filename)) return [];
  const { ast, ok } = parseJsTs(content, filename);
  if (!ok || ast.errors?.length) return [];
  const evidence = [];
  const literalCounts = new Map();
  walk(ast, node => {
    if (node.type !== 'StringLiteral') return;
    literalCounts.set(node.value, (literalCounts.get(node.value) || 0) + 1);
  });
  walk(ast, node => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (callee.type !== 'MemberExpression' || callee.computed ||
        !/^(?:toHaveBeenCalledWith|toHaveBeenLastCalledWith|toHaveBeenNthCalledWith|toMatchObject|toEqual|toStrictEqual)$/.test(callee.property.name)) return;
    const expectation = callee.object;
    if (expectation.type !== 'CallExpression' || expectation.callee.type !== 'Identifier' ||
        expectation.callee.name !== 'expect') return;
    // Inspect direct object arguments only; executing a nested callback or
    // helper inside an assertion does not make its credentials fixture data.
    for (const arg of node.arguments) {
      if (arg.type !== 'ObjectExpression') continue;
      for (const prop of arg.properties) {
        if (prop.type !== 'ObjectProperty' || prop.computed ||
            !/^(?:password|passwd|pwd)$/i.test(prop.key.name || prop.key.value || '') ||
            prop.value.type !== 'StringLiteral') continue;
        const explicitSynthetic = /^(?:test|mock|dummy|fixture)[_-]?(?:password|passwd|pwd)[0-9!@#$%_*.-]*$/i.test(prop.value.value);
        const repeatedFixtureValue = (literalCounts.get(prop.value.value) || 0) > 1;
        if (explicitSynthetic || repeatedFixtureValue) evidence.push({
          start: prop.start,
          end: prop.end,
          classification: explicitSynthetic ? 'safe' : 'probable',
        });
      }
    }
  });
  return evidence;
}

/**
 * Files this validator would scan, before any ignore setting: the walker's
 * files with a scanned extension, minus the dotenv files it skips on purpose.
 * @returns {string[]} project-relative POSIX paths
 */
function candidateFiles(projectDir) {
  const found = [];
  walkDir(projectDir, (filePath) => {
    if (!CODE_EXTENSIONS.has(extname(filePath))) return;
    if (filePath.endsWith('.env') || filePath.endsWith('.env.local') || filePath.endsWith('.env.example')) return;
    found.push(relPosix(projectDir, filePath));
  });
  return found;
}

/**
 * Does a secret scan belong to this project, and what excluded the candidates?
 * It applies when the project holds at least one source or configuration file
 * with a scanned extension. Excluding every one of them with `securityIgnore`,
 * `ignore` or `.docguardignore` does not make it not apply: that is a setting
 * the project chose, and the evidence names it (spec 097 FR-006).
 * @returns {{ applies: boolean, evidence: string, candidates: number, scannable: number, excludedBy: string|null }}
 */
export function applies(projectDir, config = {}) {
  const candidates = candidateFiles(projectDir);
  if (candidates.length === 0) {
    return {
      applies: false, candidates: 0, scannable: 0, excludedBy: null,
      evidence: `no file with a scanned extension (${[...CODE_EXTENSIONS].join(' ')}) exists in the project, so there is nothing to scan for secrets`,
    };
  }
  const scannable = candidates.filter(rel => !shouldIgnore(rel, config, 'securityIgnore'));
  if (scannable.length > 0) {
    return { applies: true, candidates: candidates.length, scannable: scannable.length, excludedBy: null, evidence: `${scannable.length} source or configuration file(s) can be scanned, for example ${scannable[0]}` };
  }
  const byGlobal = candidates.some(rel => shouldIgnore(rel, { ...config, securityIgnore: [] }, 'securityIgnore'));
  const excludedBy = byGlobal ? 'ignore / .docguardignore' : 'securityIgnore';
  return {
    applies: true, candidates: candidates.length, scannable: 0, excludedBy,
    evidence: `${candidates.length} candidate file(s) exist but every one is excluded by ${excludedBy}`,
  };
}

export function validateSecurity(projectDir, config) {
  /** @type {import('../findings.mjs').Finding[]} */
  const findings = [];
  let passed = 0;
  let total = 0;
  let scanned = 0;
  let realSecretCount = 0;

  walkDir(projectDir, (filePath) => {
    const ext = extname(filePath);
    if (!CODE_EXTENSIONS.has(ext)) return;

    // Skip .env files — they're supposed to have secrets
    if (filePath.endsWith('.env') || filePath.endsWith('.env.local')) return;
    // Skip .env.example — it should have placeholder values
    if (filePath.endsWith('.env.example')) return;

    const relPath = relPosix(projectDir, filePath);

    // Apply config ignore patterns (securityIgnore + global ignore)
    if (shouldIgnore(relPath, config, 'securityIgnore')) return;

    scanned++;
    const context = secretContext(relPath, config);
    const content = readFileSync(filePath, 'utf-8');
    let lines = null;
    let passwordFixtureEvidence = null;

    for (const { pattern, label } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      // Scan ALL matches for this pattern, not just the first. A real secret
      // can sit BELOW a safe placeholder of the same kind (e.g. an
      // `apiKey = "EXAMPLE..."` line above a hardcoded real key). Bailing on
      // the first match — as this loop used to — silently missed the real one.
      while ((match = pattern.exec(content)) !== null) {
        // Lazily initialize lines only when a match is found
        if (!lines) lines = content.split('\n');

        // 1-based line number + the line above (for inline-pragma suppression).
        const lineNo = content.slice(0, match.index).split('\n').length;
        const matchLine = lines[lineNo - 1] || '';
        const prevLine = lines[lineNo - 2] || '';

        // Skip known-safe placeholder/example values, but keep scanning for a
        // real one further down the file.
        if (isSafePlaceholder(matchLine, match[0], label)) continue;

        const code = LABEL_TO_CODE[label];
        const location = `${relPath}:${lineNo}`;
        if (code === 'SEC001') {
          passwordFixtureEvidence ??= fixturePasswordEvidence(content, relPath);
          const fixture = passwordFixtureEvidence.find(({ start, end }) => match.index >= start &&
              match.index + match[0].length <= end);
          if (fixture?.classification === 'safe') continue;
          if (fixture?.classification === 'probable') {
            findings.push(mkFinding({
              ...(CONTEXT_CODES.has(code) ? { context } : {}),
              code, validator: 'security', severity: 'warn', confidence: 'low',
              message: `${location}: possible ${label}, but the same redacted value is used as test input and expected output`,
              location,
              suggestion: {
                kind: 'review',
                text: 'Confirm this repeated test value is synthetic. Use a clearly named fixture password or suppress this line with a reason.',
                pragma: `// docguard:ignore ${code} — repeated synthetic test fixture`,
              },
              reportable: true,
              redactedContext: `${label} pattern fired inside a test assertion and the same literal appears elsewhere in the test. Literal omitted.`,
            }));
            continue;
          }
        }

        // v0.27 (#8): honour an inline `// docguard:ignore SEC00x` pragma on the
        // line or the line above — per-line suppression instead of blinding the
        // whole file via `securityIgnore`.
        if (code && lineSuppresses(code, matchLine, prevLine)) continue;

        const value = quotedValue(match[0]);
        const key = matchedKey(content, match.index, match[0]);
        // UI copy such as `f_password: 'Password'` is a label, not a secret (#527).
        if (code === 'SEC001' && isPasswordLabel(key, value)) continue;
        // A route, an endpoint, the key's own name or a dotted label (docguard.field-report-fixes#FR-009).
        const shape = CONTEXT_CODES.has(code) ? nonCredentialShape(key, value) : null;
        if (shape) {
          findings.push(mkFinding({
            context,
            code, validator: 'security', severity: 'warn', confidence: 'low',
            message: `${location}: possible ${label}, but ${SHAPE_TEXT[shape]}`,
            location,
            suggestion: {
              kind: 'suppress',
              text: 'If this value is not a secret, suppress it inline with the reason.',
              pragma: `// docguard:ignore ${code} — ${shape}, not a credential`,
            },
            reportable: true,
            redactedContext: `${label} pattern fired on a value shaped as a ${shape}. Literal omitted.`,
          }));
          continue;
        }
        const isProse = looksLikeProse(value);

        if (isProse) {
          // v0.27 (#1): natural-language value → low-confidence warning, not a
          // blocking error. Still surfaced (no false-green), still suppressible,
          // and now reportable via `docguard feedback`.
          findings.push(mkFinding({
              ...(CONTEXT_CODES.has(code) ? { context } : {}),
            code, validator: 'security', severity: 'warn', confidence: 'low',
            message: `${location}: possible ${label} — but the value reads like natural-language text (likely UI copy / a validation message, not a credential)`,
            location,
            suggestion: {
              kind: 'suppress',
              text: 'If this is UI copy or a message and not a real secret, suppress it inline.',
              pragma: `// docguard:ignore ${code} — UI copy, not a credential`,
            },
            reportable: true,
            redactedContext: `${label} pattern fired on a value that is natural-language text (~${value.trim().split(/\s+/).filter(Boolean).length} words). Literal omitted.`,
          }));
        } else {
          realSecretCount++;
          findings.push(mkFinding({
              ...(CONTEXT_CODES.has(code) ? { context } : {}),
            code, validator: 'security', severity: 'error', confidence: 'high',
            message: `${location}: possible ${label} found`,
            location,
            suggestion: {
              kind: 'fix',
              text: 'Move the secret to an environment variable and read it via process.env / the platform secret store. Never commit credentials.',
              command: code ? `docguard explain ${code}` : undefined,
              pragma: code ? `// docguard:ignore ${code} — reason (only if a confirmed false positive)` : undefined,
            },
          }));
        }
        if (isProse) continue;
        // One blocking finding per (file, label) is enough — the reported message is
        // identical for repeats and we've already proven a match exists.
        break;
      }
    }
  });

  // Only count the secret scan as a passed check if we actually scanned files.
  // An empty scan that reports "no secrets" is a dangerous false ✅ — surface it.
  if (scanned > 0) {
    total++;
    // Low-confidence (prose) findings do not fail the check — only real secrets do.
    if (realSecretCount === 0) passed++;
  } else {
    const a = applies(projectDir, config);
    findings.push(mkFinding({
      code: 'SEC011', validator: 'security', severity: 'warn', confidence: 'high',
      message: 'No source files were scanned for secrets — check config.sourceRoot / ignore patterns',
      suggestion: { kind: 'review', text: !a.applies
        ? 'The project has no file with a scanned extension, so there is nothing to scan; no setting needs to change unless source files live somewhere the scan does not reach.'
        : `${a.candidates} candidate file(s) exist but every one is excluded by ${a.excludedBy}. Narrow ${a.excludedBy === 'securityIgnore' ? '"securityIgnore" in .docguard.json' : '"ignore" in .docguard.json or .docguardignore'} so at least the product source is scanned.` },
    }));
  }

  // Check .gitignore includes .env
  total++;
  const gitignorePath = resolve(projectDir, '.gitignore');
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, 'utf-8');
    if (gitignore.includes('.env') || gitignore.includes('.env.local')) {
      passed++;
    } else {
      findings.push(mkFinding({
        code: 'SEC010', validator: 'security', severity: 'warn', confidence: 'high',
        message: '.gitignore does not include .env — secrets may be committed',
        location: '.gitignore',
        suggestion: { kind: 'fix', text: 'Add `.env` and `.env.local` to .gitignore.' },
      }));
    }
  } else {
    findings.push(mkFinding({
      code: 'SEC010', validator: 'security', severity: 'warn', confidence: 'high',
      message: 'No .gitignore found — secrets may be committed',
      suggestion: { kind: 'fix', text: 'Create a .gitignore that excludes `.env` and `.env.local`.' },
    }));
  }

  // Result contract (spec 097 FR-004 to FR-006). `performed` is the number of
  // files genuinely scanned; `total` stays as it was (it also counts the
  // .gitignore check) so no standard count moves. A run that scanned nothing
  // already carries SEC011, so the verdict is never `empty` and no emptyCause
  // is set; the cause is in `applies.evidence` and the SEC011 suggestion.
  const contract = scanned > 0
    ? { performed: scanned, applies: { applies: true, evidence: `scanned ${scanned} file(s) for hardcoded secrets` } }
    : (() => { const a = applies(projectDir, config); return { performed: 0, applies: { applies: a.applies, evidence: a.evidence } }; })();
  return { ...resultFromFindings(findings, { passed, total }), ...contract };
}

// v0.29 consolidation: traversal delegates to the shared canonical walker.
// keepDot('.env') is LOAD-BEARING — a secrets validator must scan dotenv files.
function walkDir(dir, callback) {
  sharedWalkFiles(dir, callback, {
    ignoreDirs: IGNORE_DIRS,
    keepDot: (entry) => entry === '.env',
    // Security reads every kind of file, a nested checkout included: a secret in a copy is still a leaked secret
    // (specs/100-file-kinds). It only labels the context (`secretContext`); it never skips a kind.
    nestedCheckouts: false,
  });
}
