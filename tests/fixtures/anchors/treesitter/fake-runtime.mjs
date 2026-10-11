// A stand-in for web-tree-sitter in tests/requirement-anchors-treesitter.test.mjs.
// It refuses to run unless it was imported from DocGuard's staged copy under
// .docguard/ts/ with an empty environment, and "parses" Go functions only:
// enough to prove the tier's plumbing without the real 2 MB runtime.
if (!import.meta.url.includes('/.docguard/ts/')) throw new Error(`fake runtime imported from ${import.meta.url}, not the staged copy`);
if (Object.keys(process.env).some(k => k !== '__CF_USER_TEXT_ENCODING')) throw new Error(`fake runtime saw environment ${Object.keys(process.env).join(',')}`);

let ids = 0;
const node = (type, text, startRow, endRow, children = [], named = true, fields = {}) => ({
  id: ++ids, type, text, isNamed: named, startPosition: { row: startRow }, endPosition: { row: endRow }, startIndex: 0, endIndex: 0,
  childCount: children.length, child: i => children[i], namedChildren: children.filter(c => c.isNamed),
  get namedChildCount() { return this.namedChildren.length; }, namedChild(i) { return this.namedChildren[i]; },
  childForFieldName: f => fields[f] || null,
});

export class Language { static async load(bytes) { if (!(bytes instanceof Uint8Array)) throw new Error('grammar must be bytes'); return { abiVersion: 15 }; } }
export class Parser {
  static async init(options) { if (typeof options?.locateFile !== 'function') throw new Error('locateFile is required'); }
  setLanguage(language) { this.language = language; }
  parse(text) {
    const lines = text.split('\n');
    const decls = [];
    lines.forEach((line, row) => {
      const m = /^func (\w+)\(/.exec(line);
      if (!m) return;
      let depth = 0; let end = row;
      for (let r = row; r < lines.length; r++) {
        for (const ch of lines[r]) { if (ch === '{') depth++; if (ch === '}') depth--; }
        if (depth === 0 && lines[r].includes('}')) { end = r; break; }
      }
      const name = node('identifier', m[1], row, row);
      const body = lines.slice(row, end + 1).join('\n').replace(/\/\/.*$/gm, '').split(/\s+/).filter(Boolean).map(t => node('word', t, row, row));
      decls.push(node('function_declaration', '', row, end, [node('func', 'func', row, row, [], false), name, ...body], true, { name }));
    });
    return { rootNode: { ...node('source_file', text, 0, lines.length, decls), hasError: false }, delete() {} };
  }
}
