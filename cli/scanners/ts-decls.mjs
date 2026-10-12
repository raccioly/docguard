/**
 * Which tree-sitter nodes are declarations, per language, and how a
 * declaration is fingerprinted. Shared by the opt-in tree-sitter tier
 * (ts-anchors-child.mjs) and the CI oracle (tools/anchor-oracle/run.mjs), so
 * the tier and the measurement of the pattern tier read declarations the same
 * way.
 *
 * Spec: specs/070-requirement-anchors (FR-009, FR-040). Pure: it never loads
 * tree-sitter, only walks node objects the caller's parser produced.
 *
 * @implements docguard.requirement-anchors#FR-009
 */

import { NO_VOLATILE, VOLATILE_PLACEHOLDER } from './fingerprint.mjs';

const IDENTIFIER_TYPES = new Set(['identifier', 'field_identifier', 'type_identifier', 'destructor_name', 'operator_name', 'constant', 'name']);

function lastIdentifier(node) {
  if (!node) return null;
  if (IDENTIFIER_TYPES.has(node.type)) return node;
  if (node.type === 'qualified_identifier' || node.type === 'scoped_identifier' || node.type === 'scoped_type_identifier') {
    return lastIdentifier(node.childForFieldName('name')) || node;
  }
  // `&name()`, `*make()`: reference and pointer declarators wrap the real one without a field name.
  const inner = node.childForFieldName('declarator') || node.childForFieldName('name')
    || node.namedChildren?.find(c => /declarator$/.test(c.type) || IDENTIFIER_TYPES.has(c.type) || c.type === 'qualified_identifier');
  return lastIdentifier(inner);
}

const nameField = node => node.childForFieldName('name');
// `impl<'a> Tokenizer<'a>` and `impl Iterator for Tokenizer<'a>` name the type, without its arguments.
const typeName = node => (node?.type === 'generic_type' ? typeName(node.childForFieldName('type')) : lastIdentifier(node));
// C# operators have no name node: name them the way the pattern tier does, on the keyword's line.
const synthetic = (node, text) => {
  const keyword = node.children.find(c => c.type === 'operator') || node;
  return { id: -1, text, startPosition: keyword.startPosition };
};
// C and C++ functions name themselves through nested declarators.
const declaratorName = node => lastIdentifier(node.childForFieldName('declarator'));
const withBody = node => (node.childForFieldName('body') ? node.childForFieldName('name') : null);
// A C/C++ prototype (`int add(int);`, `void add(int) const;` in a class): its name. A
// function-pointer variable (`void (*cb)(int);`) is not a prototype.
function prototypeName(node) {
  let declarator = node.childForFieldName('declarator');
  while (declarator && (declarator.type === 'reference_declarator' || declarator.type === 'pointer_declarator')) {
    declarator = declarator.childForFieldName('declarator') || declarator.namedChildren.find(c => /declarator$/.test(c.type));
  }
  if (declarator?.type !== 'function_declarator') return null;
  const inner = declarator.childForFieldName('declarator');
  if (!inner || inner.type === 'parenthesized_declarator') return null;
  return lastIdentifier(inner);
}
// `typedef void (*sink)(int);`, `typedef struct { … } ring_t;`: the name the typedef declares.
function typedefName(node) {
  const find = n => {
    if (!n) return null;
    if (n.type === 'type_identifier' || n.type === 'primitive_type') return n.type === 'type_identifier' ? n : null;
    for (const c of n.namedChildren) { const hit = find(c); if (hit) return hit; }
    return null;
  };
  const declarators = node.childrenForFieldName ? node.childrenForFieldName('declarator') : [node.childForFieldName('declarator')];
  return find(declarators[declarators.length - 1]);
}

/** Grammar package, confidence, and the declaration node types with their name node. */
export const TS_LANGUAGES = Object.freeze({
  go: { package: 'tree-sitter-go', file: 'tree-sitter-go.wasm', confidence: 'high', decls: {
    function_declaration: nameField, method_declaration: nameField, type_spec: nameField, type_alias: nameField,
  } },
  rust: { package: 'tree-sitter-rust', file: 'tree-sitter-rust.wasm', confidence: 'high', decls: {
    function_item: nameField, struct_item: nameField, enum_item: nameField, union_item: nameField, trait_item: nameField,
    impl_item: node => typeName(node.childForFieldName('type')), mod_item: withBody, macro_definition: nameField, type_item: nameField,
    associated_type: nameField, function_signature_item: nameField,
  } },
  java: { package: 'tree-sitter-java', file: 'tree-sitter-java.wasm', confidence: 'high', decls: {
    class_declaration: nameField, interface_declaration: nameField, enum_declaration: nameField, record_declaration: nameField,
    annotation_type_declaration: nameField, method_declaration: nameField, constructor_declaration: nameField, compact_constructor_declaration: nameField,
    annotation_type_element_declaration: nameField,
  } },
  csharp: { package: 'tree-sitter-c-sharp', file: 'tree-sitter-c_sharp.wasm', confidence: 'high', decls: {
    class_declaration: nameField, struct_declaration: nameField, interface_declaration: nameField, enum_declaration: nameField,
    record_declaration: nameField, method_declaration: nameField, constructor_declaration: nameField, destructor_declaration: nameField,
    namespace_declaration: nameField, delegate_declaration: nameField,
    operator_declaration: node => synthetic(node, `operator${node.childForFieldName('operator')?.text ?? ''}`),
    conversion_operator_declaration: node => synthetic(node, `operator ${node.childForFieldName('type')?.text ?? ''}`),
  } },
  php: { package: 'tree-sitter-php', file: 'tree-sitter-php_only.wasm', confidence: 'high', decls: {
    function_definition: nameField, class_declaration: nameField, interface_declaration: nameField, trait_declaration: nameField,
    enum_declaration: nameField, method_declaration: nameField,
  } },
  ruby: { package: 'tree-sitter-ruby', file: 'tree-sitter-ruby.wasm', confidence: 'high', decls: {
    method: nameField, singleton_method: nameField, class: nameField, module: nameField,
    assignment: node => (namedClassBlock(node.childForFieldName('right')?.children?.find(c => c.type === 'do_block' || c.type === 'block')) ? node.childForFieldName('left') : null),
  } },
  c: { package: 'tree-sitter-c', file: 'tree-sitter-c.wasm', confidence: 'low', decls: {
    function_definition: declaratorName, struct_specifier: withBody, union_specifier: withBody, enum_specifier: withBody,
    type_definition: typedefName, declaration: prototypeName,
  } },
  cpp: { package: 'tree-sitter-cpp', file: 'tree-sitter-cpp.wasm', confidence: 'low', decls: {
    function_definition: declaratorName, class_specifier: withBody, struct_specifier: withBody, union_specifier: withBody,
    enum_specifier: withBody, namespace_definition: withBody, type_definition: typedefName,
    declaration: prototypeName, field_declaration: prototypeName, alias_declaration: nameField,
  } },
});

const SKIPPED_LEAVES = new Set([',', ';']);

/** A name spelled the way the pattern tier spells it: no Rust `!`; C++ `ns::inner` and `hash<T>` as `ns.inner` and `hash`. */
function spell(text, lang) {
  const name = text.replace(/!$/, '');
  return lang === 'cpp' || lang === 'c' ? name.replace(/<.*>$/s, '').replace(/::/g, '.') : name;
}

/** Bodies whose declarations are local: an anchor names them as statements, not symbols. */
const LOCAL_SCOPES = new Set([
  'function_declaration', 'method_declaration', 'function_item', 'function_definition', 'constructor_declaration',
  'compact_constructor_declaration', 'destructor_declaration', 'method', 'singleton_method', 'operator_declaration',
  'conversion_operator_declaration', 'lambda_expression', 'closure_expression', 'func_literal', 'anonymous_function',
  'arrow_function', 'local_function_statement', 'object_creation_expression', 'enum_constant', 'anonymous_class',
]);

/** Ruby's `Const = Struct.new(...) do ... end` (or Data.define, Class.new): a class body, not a plain block. */
function namedClassBlock(node) {
  if (!node || (node.type !== 'do_block' && node.type !== 'block')) return false;
  const call = node.parent;
  const assignment = call?.parent;
  return call?.type === 'call' && assignment?.type === 'assignment' && assignment.childForFieldName('left')?.type === 'constant';
}

/**
 * The declaration's tokens for its fingerprint: every leaf in source order,
 * except comments, the declaration's own name (a rename keeps the review,
 * FR-030), the commas and semicolons formatters add or drop, and redundant
 * parentheses (FR-010).
 */
export function declarationTokens(node, nameNode, volatile = NO_VOLATILE) {
  const out = [];
  const skipId = nameNode ? nameNode.id : null;
  const visit = n => {
    if (n.id === skipId) return;
    if (/comment/.test(n.type)) return;
    // docguard.volatile-anchor-lines#FR-002: a node wholly on a marked line is the placeholder.
    if (volatile.size && n.startPosition.row === n.endPosition.row && volatile.has(n.startPosition.row + 1)) { out.push(VOLATILE_PLACEHOLDER); return; }
    // Redundant parentheses are formatting: keep what they enclose.
    if (n.type === 'parenthesized_expression' && n.namedChildCount === 1) { visit(n.namedChild(0)); return; }
    if (n.childCount === 0) {
      if (!n.isNamed && SKIPPED_LEAVES.has(n.type)) return;
      out.push(n.isNamed ? `${n.type}:${n.text}` : n.text);
      return;
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i));
  };
  visit(node);
  return out;
}

/**
 * Every declaration in a parsed tree: name, lines, character offsets, tokens,
 * and whether it is local (inside a function body, an anonymous class or a
 * plain block), where an anchor names a statement rather than a symbol.
 */
export function declarations(tree, lang, volatile = NO_VOLATILE) {
  const spec = TS_LANGUAGES[lang];
  if (!spec) return [];
  const out = [];
  const visit = (node, local) => {
    const nameOf = spec.decls[node.type];
    if (nameOf) {
      const nameNode = nameOf(node);
      if (nameNode?.text) {
        out.push({
          name: spell(nameNode.text, lang), type: node.type, local,
          nameLine: nameNode.startPosition.row + 1, startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1,
          start: node.startIndex, end: node.endIndex, tokens: declarationTokens(node, nameNode, volatile),
        });
      }
    }
    const inner = local || LOCAL_SCOPES.has(node.type) || ((node.type === 'do_block' || node.type === 'block') && lang === 'ruby' && !namedClassBlock(node));
    for (const child of node.namedChildren) visit(child, inner);
  };
  visit(tree.rootNode, false);
  return out;
}
