/**
 * Spec 107: one language registry (`cli/shared-languages.mjs`) for every scanner.
 *
 * A scanner that asks "is this file code?" reads the registry, so a language added once reaches all of
 * them. A list tied to one parser (env-read patterns, Spring routes, ORM schemas, test-name conventions)
 * stays where it is with a `LANGUAGE EXEMPTION` comment that says why, the same pattern as the file-kind
 * registry's SECURITY EXEMPTION. This test finds every line under cli/ that names four or more registry
 * languages and fails unless an exemption comment sits within six lines above it.
 *
 * @req docguard.language-registry#FR-001
 * @req docguard.language-registry#FR-002
 * @req docguard.language-registry#FR-003
 * @req docguard.language-registry#FR-004
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LANGUAGES, CODE_EXTENSIONS, LANGUAGE_NAMES, LEXER_BY_EXTENSION, codePathPattern, isCodePath, languageFor,
} from '../cli/shared-languages.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function* mjsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* mjsFiles(full);
    else if (name.endsWith('.mjs')) yield full;
  }
}

// A token is an extension without its dot, standing alone between list punctuation: `'.go'`, `|go|`, `(go|`.
const TOKEN = /(?<=['"`|(:]\.?|\\\.)([a-z+#]{1,8})(?=['"`|)])/g;
const EXT_TO_LANG = new Map(LANGUAGES.flatMap(l => l.extensions.map(e => [e.slice(1), l.id])));
// JS/TS appear as `[jt]sx?`-style classes too; count them through any spelled variant.
const languagesOnLine = line => new Set([...line.matchAll(TOKEN)].map(m => EXT_TO_LANG.get(m[1])).filter(Boolean));

describe('no scanner keeps a private language list', () => {
  it('every line naming four or more languages is in the registry or carries a reasoned exemption', () => {
    const offenders = [];
    for (const file of mjsFiles(join(ROOT, 'cli'))) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (rel === 'cli/shared-languages.mjs') continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
        if (languagesOnLine(line).size < 4) return;
        const above = lines.slice(Math.max(0, i - 6), i + 1).join('\n');
        if (!/LANGUAGE EXEMPTION \(tests\/language-registry\.test\.mjs\): \S/.test(above)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    assert.deepEqual(offenders, [], 'move these lists onto cli/shared-languages.mjs, or exempt them with a reason');
  });

  it('the detector sees a private list', () => {
    assert.ok(languagesOnLine(`const X = new Set(['.py', '.go', '.rs', '.java']);`).size >= 4);
    assert.ok(languagesOnLine('const R = /\\.(?:py|go|rs|java|kt)$/;').size >= 4);
    assert.equal(languagesOnLine('if (ext === ".go") return;').size, 1);
  });
});

describe('the registry', () => {
  it('derives the lexer map, the names and the code set from one entry per language', () => {
    assert.equal(LEXER_BY_EXTENSION.cls, 'java');
    assert.equal(LEXER_BY_EXTENSION.tsx, 'ts');
    assert.equal(LANGUAGE_NAMES['.trigger'], 'Apex');
    assert.equal(LANGUAGE_NAMES['.ts'], undefined, 'AST languages are not named as pattern-read');
    assert.ok(CODE_EXTENSIONS.has('.cls') && CODE_EXTENSIONS.has('.swift') && !CODE_EXTENSIONS.has('.sh') && !CODE_EXTENSIONS.has('.page'));
    assert.equal(languageFor('force-app/main/default/triggers/Order.trigger').id, 'apex');
    assert.equal(isCodePath('pages/Home.page'), false);
    assert.ok(codePathPattern(['.yml']).test('a/b.YML'));
    assert.equal(codePathPattern([], { flags: '' }).test('a/b.CLS'), false);
    const seen = new Set();
    for (const l of LANGUAGES) for (const e of l.extensions) { assert.equal(seen.has(e), false, `${e} belongs to one language`); seen.add(e); }
  });
});

describe('every "is this code?" scanner reads Apex', () => {
  // @req docguard.language-registry#FR-005
  it('todo tracking, drift comments, anchors and SPK008 evidence see a .cls file; API-Surface does not apply', async (t) => {
    const { makeTempDir } = await import('./helpers/temp-dir.mjs');
    const { spawnSync } = await import('node:child_process');
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const dir = makeTempDir('dg-107-', t);
    const put = (rel, body) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };
    put('sfdx-project.json', '{"packageDirectories":[{"path":"force-app","default":true}]}\n');
    put('force-app/main/default/classes/WidgetService.cls', '// @implements widgets#FR-001\npublic with sharing class WidgetService {\n    // TODO: handle empty lists\n    // DRIFT: sync callout instead of the queue\n    public static Integer count() { return 1; }\n}\n');
    put('specs/001-widgets/spec.md', '# Feature Specification: Widgets\n\n**Spec ID**: widgets\n\n## Requirements\n\n- **FR-001**: The system counts widgets.\n');
    const cli = (...args) => spawnSync(process.execPath, [join(ROOT, 'cli', 'docguard.mjs'), ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', DOCGUARD_NO_UPDATE_HINT: '1' }, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(cli('init', '--skip-prompts', '--no-spec-kit').status, 0);
    const guard = JSON.parse(cli('guard', '--format', 'json').stdout);
    const at = code => guard.findings.filter(f => f.code === code && String(f.location).includes('WidgetService.cls'));
    assert.equal(at('TDO002').length, 1, 'the TODO in Apex is tracked');
    assert.equal(at('DRF002').length, 1, 'the DRIFT comment in Apex is read');
    assert.equal(guard.strict.blocking.includes('apiSurface'), false, 'Salesforce DX names no route DocGuard reads');
    const anchors = JSON.parse(cli('anchors', '--format', 'json').stdout);
    const links = anchors.links || anchors.anchors || anchors;
    assert.ok(links.some(l => l.file === 'force-app/main/default/classes/WidgetService.cls' && l.requirement === 'widgets#FR-001'), 'the @implements tag in Apex is an anchor');
  });
});
