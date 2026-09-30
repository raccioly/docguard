/**
 * TypeScript / JavaScript path aliases (`compilerOptions.paths` + `baseUrl`),
 * resolved the way `tsc` and Next.js resolve them, for the import graph and
 * Express mount resolution.
 *
 * Read-only: config files are parsed as JSON with comments and trailing commas
 * removed; nothing is executed. The nearest `tsconfig.json` (else
 * `jsconfig.json`) above the importing file applies. `extends` is followed to
 * relative files and to package configs under `node_modules`, at most
 * MAX_EXTENDS deep; a cycle stops it. A specifier that resolves to no file on
 * disk yields null, never a guess.
 *
 * @implements docguard.js-ts-extraction#FR-005
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const MAX_EXTENDS = 8;
const CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.jsx', '.cjs', '.mts', '.cts'];

/** Strip `//` and `/* *\/` comments and trailing commas outside strings. */
export function parseJsonc(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') { out += text[++i] ?? ''; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (ch === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}

function readConfig(file) {
  try { return parseJsonc(readFileSync(file, 'utf8')); } catch { return null; }
}

/** Resolve an `extends` value to a config file path, or null. */
function extendsTarget(fromFile, value) {
  if (typeof value !== 'string' || !value) return null;
  const base = dirname(fromFile);
  const candidates = [];
  if (value.startsWith('.') || value.startsWith('/')) {
    const abs = resolve(base, value);
    candidates.push(abs, `${abs}.json`, join(abs, 'tsconfig.json'));
  } else {
    // A package config: walk up node_modules directories, as Node does.
    let dir = base;
    for (;;) {
      const abs = join(dir, 'node_modules', value);
      candidates.push(abs, `${abs}.json`, join(abs, 'tsconfig.json'));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return candidates.find(isFile) || null;
}

/**
 * Effective `{ baseUrl, paths, pathsBase }` of one config file with its
 * `extends` chain applied. The child overrides the parent key by key; a
 * `baseUrl` is relative to the config that declares it, and `paths` resolve
 * against the effective `baseUrl`, else against the declaring config's dir.
 */
function effectiveOptions(configFile, seen = new Set(), depth = 0) {
  if (depth > MAX_EXTENDS || seen.has(configFile)) return { baseUrl: null, paths: null, pathsDir: null };
  seen.add(configFile);
  const json = readConfig(configFile);
  if (!json || typeof json !== 'object') return { baseUrl: null, paths: null, pathsDir: null };
  const parents = (Array.isArray(json.extends) ? json.extends : [json.extends])
    .map(value => extendsTarget(configFile, value)).filter(Boolean);
  let merged = { baseUrl: null, paths: null, pathsDir: null };
  for (const parent of parents) {
    const p = effectiveOptions(parent, seen, depth + 1);
    merged = {
      baseUrl: p.baseUrl ?? merged.baseUrl,
      paths: p.paths ?? merged.paths,
      pathsDir: p.paths ? p.pathsDir : merged.pathsDir,
    };
  }
  const options = json.compilerOptions && typeof json.compilerOptions === 'object' ? json.compilerOptions : {};
  const dir = dirname(configFile);
  if (typeof options.baseUrl === 'string') merged.baseUrl = resolve(dir, options.baseUrl);
  if (options.paths && typeof options.paths === 'object' && !Array.isArray(options.paths)) {
    merged.paths = options.paths;
    merged.pathsDir = dir;
  }
  return merged;
}

/** A file for `base` with the relative-import extensions and index files, or null. */
export function resolveModuleFile(base) {
  if (isFile(base)) return base;
  for (const ext of EXTENSIONS) if (isFile(base + ext)) return base + ext;
  for (const ext of EXTENSIONS) {
    const index = join(base, `index${ext}`);
    if (isFile(index)) return index;
  }
  return null;
}

/**
 * A resolver for one project. `resolve(fromFile, spec)` returns the absolute
 * file an aliased specifier names, or null (relative specifiers are the
 * caller's). Config lookups are cached per directory for the resolver's life.
 */
export function createAliasResolver(projectDir) {
  const root = resolve(projectDir);
  const configByDir = new Map();
  const optionsByConfig = new Map();

  const nearestConfig = (dir) => {
    if (configByDir.has(dir)) return configByDir.get(dir);
    let found = null;
    for (const name of CONFIG_NAMES) {
      if (isFile(join(dir, name))) { found = join(dir, name); break; }
    }
    if (!found && dir !== root && dir.startsWith(root + sep)) found = nearestConfig(dirname(dir));
    configByDir.set(dir, found);
    return found;
  };

  const optionsFor = (configFile) => {
    if (!optionsByConfig.has(configFile)) optionsByConfig.set(configFile, effectiveOptions(configFile));
    return optionsByConfig.get(configFile);
  };

  const withinProject = (file) => file && (file === root || file.startsWith(root + sep)) && !file.includes(`${sep}node_modules${sep}`);

  return function resolveAlias(fromFile, spec) {
    if (!spec || spec.startsWith('.') || spec.startsWith('/')) return null;
    const configFile = nearestConfig(dirname(resolve(fromFile)));
    if (!configFile) return null;
    const { baseUrl, paths, pathsDir } = optionsFor(configFile);
    if (paths) {
      const pathsBase = baseUrl || pathsDir;
      // The longest matching prefix wins, as in tsc.
      const patterns = Object.keys(paths).sort((a, b) => b.length - a.length);
      for (const pattern of patterns) {
        const targets = Array.isArray(paths[pattern]) ? paths[pattern] : [];
        const star = pattern.indexOf('*');
        let capture = null;
        if (star < 0) {
          if (spec === pattern) capture = '';
        } else {
          const prefix = pattern.slice(0, star);
          const suffix = pattern.slice(star + 1);
          if (spec.startsWith(prefix) && spec.endsWith(suffix) && spec.length >= prefix.length + suffix.length) {
            capture = spec.slice(prefix.length, spec.length - suffix.length);
          }
        }
        if (capture === null) continue;
        for (const target of targets) {
          if (typeof target !== 'string') continue;
          const file = resolveModuleFile(resolve(pathsBase, target.replace('*', capture)));
          if (withinProject(file)) return file;
        }
        return null;
      }
    }
    if (baseUrl) {
      const file = resolveModuleFile(resolve(baseUrl, spec));
      if (withinProject(file)) return file;
    }
    return null;
  };
}
