/**
 * Environment variables a Python module reads beyond `os.environ[...]`,
 * `os.environ.get()` and `os.getenv()` (which grepEnvUsage matches directly):
 *
 *   - `environ` / `getenv` imported from `os` (any alias);
 *   - pydantic `BaseSettings` fields: `env_prefix` from `SettingsConfigDict`,
 *     `ConfigDict`, a dict or a `class Config`; `alias`, `validation_alias`,
 *     `AliasChoices(...)` and pydantic v1 `env=`; `case_sensitive`.
 *
 * Read from the module outline and its tokens, so a name inside a string or a
 * comment is never a read. Pure JavaScript: grepEnvUsage stays synchronous and
 * needs no interpreter.
 *
 * @implements docguard.python-extraction#FR-009
 */
import { logicalLines, outlineFromSource, refTail } from './py-outline.mjs';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Env var names read by one Python module. */
export function pythonEnvNames(content) {
  const names = new Set();
  let outline;
  try { outline = outlineFromSource(content); } catch { return names; }

  const environ = new Set();
  const getenv = new Set();
  for (const a of outline.aliases) {
    if (a.module !== 'os' || a.level) continue;
    if (a.name === 'environ') environ.add(a.local);
    if (a.name === 'getenv') getenv.add(a.local);
  }
  if (environ.size || getenv.size) {
    for (const { tokens: t } of logicalLines(content)) {
      for (let i = 0; i < t.length; i++) {
        if (t[i].type !== 'name' || (i > 0 && t[i - 1].type === 'op' && t[i - 1].v === '.')) continue;
        const op = (k, v) => t[k]?.type === 'op' && t[k].v === v;
        let str = null;
        if (environ.has(t[i].v)) {
          if (op(i + 1, '.') && t[i + 2]?.v === 'get' && op(i + 3, '(')) str = t[i + 4];
          else if (op(i + 1, '[')) str = t[i + 2];
        } else if (getenv.has(t[i].v) && op(i + 1, '(')) {
          str = t[i + 2];
        }
        if (str?.type === 'str' && ENV_NAME.test(str.v)) names.add(str.v);
      }
    }
  }

  for (const name of settingsEnvNames(outline)) names.add(name);
  return names;
}

function settingsEnvNames(outline) {
  const classes = new Map(outline.body.filter(s => s.k === 'class').map(c => [c.name, c]));
  const isSettings = (c, seen = new Set()) => {
    if (!c || seen.has(c.name)) return false;
    seen.add(c.name);
    return (c.bases || []).some(b => refTail(b) === 'BaseSettings' || isSettings(classes.get(refTail(b)), seen));
  };
  const parentOf = c => (c.bases || []).map(b => classes.get(refTail(b))).find(p => p && isSettings(p));

  const configOf = (c, seen = new Set()) => {
    if (!c || seen.has(c.name)) return { prefix: '', caseSensitive: false };
    seen.add(c.name);
    const inherited = configOf(parentOf(c), seen);
    let prefix = inherited.prefix;
    let caseSensitive = inherited.caseSensitive;
    const read = (key, value) => {
      if (key === 'env_prefix' && value?.t === 'str') prefix = value.v;
      if (key === 'case_sensitive' && value?.t === 'const') caseSensitive = value.v === true;
    };
    for (const s of c.body || []) {
      if (s.k === 'assign' && s.targets.includes('model_config') && s.value) {
        if (s.value.t === 'call') for (const [k, v] of Object.entries(s.value.kw || {})) read(k, v);
        if (s.value.t === 'dict') s.value.keys.forEach((k, i) => { if (k?.t === 'str') read(k.v, s.value.values[i]); });
      }
      if (s.k === 'class' && s.name === 'Config') {
        for (const inner of s.body || []) if (inner.k === 'assign') for (const t of inner.targets) read(t, inner.value);
      }
    }
    return { prefix, caseSensitive };
  };

  const out = [];
  for (const c of classes.values()) {
    if (!isSettings(c)) continue;
    const { prefix, caseSensitive } = configOf(c);
    const chain = [];
    for (let k = c; k; k = parentOf(k)) { if (chain.includes(k)) break; chain.unshift(k); }
    for (const cls of chain) {
      for (const s of cls.body || []) {
        if (s.k !== 'assign' || !s.ann || s.aug) continue;
        const field = s.targets[0];
        if (!field || field.startsWith('_') || field === 'model_config' || refTail(s.ann.value || s.ann) === 'ClassVar') continue;
        const aliases = fieldAliases(s.value);
        const names = aliases.length ? aliases : [`${prefix}${field}`];
        for (const n of names) {
          const name = caseSensitive ? n : n.toUpperCase();
          if (ENV_NAME.test(name)) out.push(name);
        }
      }
    }
  }
  return out;
}

/** Explicit environment names on a `Field(...)`: they bypass `env_prefix`. */
function fieldAliases(value) {
  if (value?.t !== 'call' || refTail(value.fn) !== 'Field') return [];
  const kw = value.kw || {};
  const strings = e => {
    if (!e) return [];
    if (e.t === 'str') return [e.v];
    if (e.t === 'list') return e.items.flatMap(strings);
    if (e.t === 'call' && refTail(e.fn) === 'AliasChoices') return e.args.flatMap(strings);
    return [];
  };
  return [...strings(kw.validation_alias), ...strings(kw.alias), ...strings(kw.env)]
    .filter((v, i, all) => all.indexOf(v) === i);
}
