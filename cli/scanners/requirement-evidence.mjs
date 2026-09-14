/**
 * Pure requirement-reference evidence shared by validators and registry projections.
 * @implements docguard.document-lifecycle#FR-013
 * @implements docguard.document-lifecycle#FR-016
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { TEST_PATTERNS } from '../shared-trace-patterns.mjs';
import { parseJsTs, walk } from './js-ast.mjs';

export function isTestSource(file) {
  return /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|sh)$/.test(file)
    && (TEST_PATTERNS.some(pattern => pattern.test(file)) || /(?:^|\/)(?:__tests__|tests?)\//.test(file));
}

export function resolveRequirementReferences(definitions, references, retiredDefinitions = new Set()) {
  const byId = new Map();
  for (const [key, definition] of definitions) {
    if (!byId.has(definition.id)) byId.set(definition.id, []);
    byId.get(definition.id).push(key);
  }
  for (const key of retiredDefinitions) {
    const id = key.slice(key.lastIndexOf('#') + 1);
    if (!byId.has(id)) byId.set(id, []);
    if (!byId.get(id).includes(key)) byId.get(id).push(key);
  }
  const resolved = new Map();
  for (const [id, refs] of references) {
    const candidates = byId.get(id) || [];
    for (const ref of refs) {
      let key = null;
      if (ref.scope) {
        const direct = `${ref.scope}#${id}`;
        if (definitions.has(direct)) key = direct;
        else {
          const aliases = candidates.filter(candidate => definitions.get(candidate)?.specId === ref.scope);
          if (aliases.length === 1) key = aliases[0];
        }
      } else if (candidates.length === 1) key = candidates[0];
      if (!key || !definitions.has(key)) continue;
      if (!resolved.has(key)) resolved.set(key, []);
      resolved.get(key).push(ref);
    }
  }
  return resolved;
}

function testDeclarations(content, filename) {
  const declarations = [];
  const comment = (text, line) => {
    for (const [offset, raw] of text.split('\n').entries()) {
      const body = raw.replace(/^\s*\*?\s*/, '');
      if (/^(?:@(?:req|task|covers)\s|Testing\s)/i.test(body)) declarations.push({ text: body, line: line + offset });
    }
  };
  const labelName = /^(?:test|it|describe|context|specify|Run|DisplayName)$/;
  const ext = extname(filename);
  if (/^\.(?:[cm]?[jt]s|[jt]sx)$/.test(ext)) {
    const { ast, ok } = parseJsTs(content, filename);
    if (ok) {
      for (const c of ast.comments || []) comment(c.value, c.loc.start.line);
      const isLabelCall = callee => {
        if (callee?.type === 'Identifier') return labelName.test(callee.name);
        if (callee?.type !== 'MemberExpression' || callee.computed) return false;
        return labelName.test(callee.property.name)
          || (/^(?:only|skip|todo|concurrent|serial)$/.test(callee.property.name) && isLabelCall(callee.object));
      };
      walk(ast.program, node => {
        if (node.type !== 'CallExpression' || !isLabelCall(node.callee)) return;
        const label = node.arguments[0];
        if (label?.type === 'StringLiteral' || (label?.type === 'TemplateLiteral' && label.expressions.length === 0)) {
          declarations.push({ text: content.slice(label.start + 1, label.end - 1), line: label.loc.start.line });
        }
      });
      return declarations.sort((a, b) => a.line - b.line);
    }
  }

  const tokens = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|\#[^\n]*|"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/g;
  const hashComments = /\.(?:py|rb|php|sh)$/.test(ext);
  let end = 0;
  let line = 1;
  let code = '';
  for (const token of content.matchAll(tokens)) {
    const gap = content.slice(end, token.index);
    line += (gap.match(/\n/g) || []).length;
    code += gap;
    const text = token[0];
    if (text.startsWith('//') || text.startsWith('/*') || (hashComments && text.startsWith('#'))) {
      comment(text.replace(/^(?:\/\/|\/\*|#)/, ''), line);
    } else if (/^["'`]/.test(text)
      && /\b(?:test|it|describe|context|specify|Run|DisplayName)(?:\.(?:only|skip|todo|concurrent|serial))*\s*\(?\s*$/.test(code)) {
      declarations.push({ text: text.slice(1, -1), line });
    }
    line += (text.match(/\n/g) || []).length;
    code = text.startsWith('/') || text.startsWith('#') ? code + ' ' : ';';
    end = token.index + text.length;
  }
  return declarations;
}

function implementationDeclarations(content, filename) {
  const declarations = [];
  const ext = extname(filename);
  const hashComments = /\.(?:py|rb|php|sh)$/.test(ext);
  const tokens = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|\#[^\n]*/g;
  for (const token of content.matchAll(tokens)) {
    if (token[0].startsWith('#') && !hashComments) continue;
    const line = content.slice(0, token.index).split('\n').length;
    const text = token[0].replace(/^(?:\/\/|\/\*|#)/, '');
    if (/@(?:req|implements)\s/i.test(text)) declarations.push({ text, line });
  }
  return declarations;
}

function collectReferences(projectDir, projectFiles, patterns, select, declarationsForFile) {
  const refs = new Map();
  for (const relPath of projectFiles.filter(select)) {
    const fullPath = resolve(projectDir, relPath);
    if (!existsSync(fullPath)) continue;
    let content;
    try { content = readFileSync(fullPath, 'utf8'); } catch { continue; }
    const hasMatch = patterns.some(pattern => { pattern.lastIndex = 0; return pattern.test(content); });
    if (!hasMatch) continue;
    for (const declaration of declarationsForFile(content, relPath)) {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(declaration.text)) !== null) {
          if (!match[0]) { pattern.lastIndex++; continue; }
          const reqId = match[0];
          if (!refs.has(reqId)) refs.set(reqId, []);
          const line = declaration.line + (declaration.text.slice(0, match.index).match(/\n/g) || []).length;
          const prefix = declaration.text.slice(0, match.index);
          const qualifier = prefix.match(/([^\s`"'<>()[\]{}]+)#$/);
          const scope = qualifier ? qualifier[1].replaceAll('\\', '/').replace(/^\.\//, '') : null;
          refs.get(reqId).push({ file: relPath, line, scope });
        }
      }
    }
  }
  return refs;
}

export function scanTestFilesForReferences(projectDir, projectFiles, patterns) {
  return collectReferences(projectDir, projectFiles, patterns, isTestSource, testDeclarations);
}

/** Source annotations are explicit implementation evidence, never inferred from names. */
export function scanImplementationFilesForReferences(projectDir, projectFiles, patterns) {
  return collectReferences(
    projectDir,
    projectFiles,
    patterns,
    path => !isTestSource(path) && /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|sh|cs|swift)$/.test(path),
    implementationDeclarations,
  );
}
