/**
 * AWS AI-DLC workspace reader (specs/089-aidlc-profile). Read-only: DocGuard
 * never writes AI-DLC files. Formats are AI-DLC 2.11.2's:
 *
 *   aidlc/spaces/<space>/intents/<YYMMDD>-<label>/   current record layout
 *   aidlc-docs/                                      legacy layout
 *     aidlc-state.md            `- [x] <stage-slug> — …` rows under ## Stage Progress
 *     …/traceability.json       { stage, unit?, upstream_ids, coverage: [{ id, status, target }] }
 *     …/source-manifest.json    { stage, unit, version, writes: [{ path, repo? }] }
 *
 * @implements docguard.aidlc-profile#FR-001
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { DEFAULT_IGNORE_DIRS, walkFiles } from '../shared-ignore.mjs';

const MAX_FILES = 2000;
// The shared build-output and package-cache set, plus AI-DLC's own engine folder. Dot entries are read: a record
// holds `.`-folders of its own.
const SKIP_DIRS = new Set([...DEFAULT_IGNORE_DIRS, '.aidlc-engine']);

function listDirs(abs) {
  try { return readdirSync(abs, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort(); } catch { return []; }
}

/** Every record directory: current intents, then the legacy root. */
export function findAidlcRecords(projectDir) {
  const records = [];
  const spaces = resolve(projectDir, 'aidlc', 'spaces');
  for (const space of listDirs(spaces)) {
    const intents = join(spaces, space, 'intents');
    for (const intent of listDirs(intents)) records.push({ space, intent, abs: join(intents, intent), layout: 'current' });
  }
  const legacy = resolve(projectDir, 'aidlc-docs');
  if (existsSync(legacy)) records.push({ space: null, intent: 'aidlc-docs', abs: legacy, layout: 'legacy' });
  return records;
}

/** Files below `abs` that pass `test`, at most `maxDepth` folders deep and `MAX_FILES` of them, in walk order. */
function collect(abs, test, maxDepth, out = []) {
  walkFiles(abs, (full) => {
    if (out.length >= MAX_FILES) return;
    if (relative(abs, full).split(sep).length - 1 > maxDepth) return;
    if (test(basename(full), full)) out.push(full);
  }, { ignoreDirs: SKIP_DIRS, skipDotEntries: false, root: abs });
  return out;
}

function walk(abs, out) {
  collect(abs, name => name === 'traceability.json' || name === 'source-manifest.json' || name === 'aidlc-state.md', 8, out);
}

/** Stage slug → checkbox state, from `## Stage Progress` (and phase headings under it). */
export function parseStageProgress(text) {
  const states = new Map();
  let inProgress = false;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/^##\s/.test(line)) inProgress = /^##\s+Stage Progress/i.test(line);
    if (!inProgress) continue;
    const m = line.match(/^\s*-\s*\[([ x\-?RS])\]\s*([a-z0-9][a-z0-9-]*)/i);
    if (m) states.set(m[2], m[1]);
  }
  return states;
}

const readJson = p => { try { return { ok: true, value: JSON.parse(readFileSync(p, 'utf-8')) }; } catch (e) { return { ok: false, error: e.message.split('\n')[0] }; } };

/** One record's tables, manifests and stage states. */
export function readAidlcRecord(projectDir, record) {
  const files = [];
  walk(record.abs, files);
  const stateFile = files.find(f => f.endsWith('aidlc-state.md') && resolve(f, '..') === record.abs) || files.find(f => f.endsWith('aidlc-state.md'));
  let stages = new Map();
  if (stateFile) { try { stages = parseStageProgress(readFileSync(stateFile, 'utf-8')); } catch { /* unreadable state: no stage states */ } }
  const rel = f => relative(projectDir, f).replace(/\\/g, '/');
  const tables = [];
  const manifests = [];
  const malformed = [];
  for (const f of files) {
    if (f.endsWith('traceability.json')) {
      const r = readJson(f);
      if (!r.ok || !r.value || typeof r.value !== 'object' || !Array.isArray(r.value.coverage)) { malformed.push({ file: rel(f), reason: r.ok ? 'no coverage array' : r.error }); continue; }
      tables.push({ file: rel(f), ...r.value });
    } else if (f.endsWith('source-manifest.json')) {
      const r = readJson(f);
      if (!r.ok || !r.value || typeof r.value !== 'object' || !Array.isArray(r.value.writes)) { malformed.push({ file: rel(f), reason: r.ok ? 'no writes array' : r.error }); continue; }
      manifests.push({ file: rel(f), ...r.value });
    }
  }
  return { ...record, rel: rel(record.abs), stages, tables, manifests, malformed };
}

const SOURCE_EXT = /\.(?:m?[jt]sx?|cjs|py|go|rs|java|kt|rb|php|cs|swift|scala|dart|c|cc|cpp|h|hpp|vue|svelte|sql|ya?ml|json|toml|tf|sh)$/i;
const ID_LIKE = /^(?:FR|NFR|US|AC|BR|SC|REQ|UC)[-.]?\d/i;

/** True when a traceability target names a workspace path, not an ID or prose. */
export function isPathTarget(target) {
  if (typeof target !== 'string') return false;
  const t = target.trim();
  if (!t || /\s/.test(t) || ID_LIKE.test(t) || /^[a-z]+:\/\//i.test(t)) return false;
  return t.includes('/') || SOURCE_EXT.test(t);
}

/** A project-relative path, or null when it escapes the project. */
export function safeWorkspacePath(projectDir, p) {
  if (typeof p !== 'string' || !p || p.startsWith('/') || /^[a-z]:/i.test(p)) return null;
  const abs = resolve(projectDir, p);
  const rel = relative(projectDir, abs);
  return rel.startsWith('..') ? null : abs;
}

export function pathExists(abs, isDir) {
  try { const s = statSync(abs); return isDir ? s.isDirectory() : true; } catch { return false; }
}

// ── Memory (specs/091-memory-governance) ────────────────────────────────────

/** Every AI-DLC space: `aidlc/spaces/<space>/`. */
export function findAidlcSpaces(projectDir) {
  const spaces = resolve(projectDir, 'aidlc', 'spaces');
  return listDirs(spaces).map(space => ({ space, abs: join(spaces, space) }));
}

function filesIn(abs, test) {
  return collect(abs, test, 6).sort();
}

/** Rule layers AI-DLC's learning loop writes: memory/{org,team,project}.md and memory/phases/*.md. */
export function memoryLayerFiles(spaceAbs) {
  const mem = join(spaceAbs, 'memory');
  return filesIn(mem, (name, p) => /^(?:org|team|project)\.md$/.test(name) || (/\.md$/.test(name) && /[\\/]phases[\\/]/.test(p)));
}

export function codekbFiles(spaceAbs) {
  return filesIn(join(spaceAbs, 'codekb'), name => /\.md$/i.test(name));
}

/** Stage diaries: `memory.md` under the space's intents. */
export function diaryFiles(spaceAbs) {
  return filesIn(join(spaceAbs, 'intents'), name => name === 'memory.md');
}

/**
 * Backticked tokens outside fences and HTML comments, with their line.
 * @returns {{ token: string, line: number, text: string }[]}
 */
export function backtickRefs(text) {
  const out = [];
  let fence = null;
  let comment = false;
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const f = raw.trim().match(/^(`{3,}|~{3,})/);
    if (fence) { if (f && f[1][0] === fence[0]) fence = null; return; }
    if (f) { fence = f[1]; return; }
    let line = '', rest = raw;
    while (rest) {
      if (comment) { const e = rest.indexOf('-->'); if (e < 0) { rest = ''; break; } comment = false; rest = rest.slice(e + 3); }
      else { const s = rest.indexOf('<!--'); if (s < 0) { line += rest; break; } line += rest.slice(0, s); comment = true; rest = rest.slice(s + 4); }
    }
    for (const m of line.matchAll(/`([^`\n]{2,200})`/g)) out.push({ token: m[1].trim(), line: i + 1, text: raw.trim() });
  });
  return out;
}

export const ENV_TOKEN = /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/;
