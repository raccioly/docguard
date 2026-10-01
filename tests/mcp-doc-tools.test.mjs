/**
 * MCP doc tools (specs/032-mcp-doc-tools): exact, bounded answers to "which
 * docs describe this file?", "what is in this document?", "read me that one
 * section", and the task context packet. No tool calls a model.
 *
 * @req docguard.mcp-doc-tools#FR-001
 * @req docguard.mcp-doc-tools#FR-002
 * @req docguard.output-ux#FR-010
 * @req docguard.mcp-doc-tools#FR-003
 * @req docguard.mcp-doc-tools#FR-004
 * @req docguard.mcp-doc-tools#FR-005
 * @req docguard.mcp-doc-tools#FR-006
 * @req docguard.mcp-doc-tools#FR-007
 * @req docguard.mcp-doc-tools#FR-008
 * @req docguard.mcp-doc-tools#FR-009
 * @req docguard.mcp-doc-tools#FR-010
 * @req docguard.mcp-doc-tools#FR-011
 * @req docguard.mcp-doc-tools#SC-001
 * @req docguard.mcp-doc-tools#SC-002
 * @req docguard.mcp-doc-tools#SC-003
 * @req docguard.mcp-doc-tools#SC-004
 * @req docguard.mcp-doc-tools#SC-005
 */
import { describe, it, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { docsForPath, docStructure, readSection } from '../cli/scanners/doc-references.mjs';
import { buildTaskContextPacket } from '../cli/scanners/task-context.mjs';
import { tmpdir } from 'node:os';

const CLI = resolve('cli/docguard.mjs');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const LONG = 'é'.repeat(20000); // 40,000 bytes of two-byte characters: past the 32 KiB cap

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'docguard-mcpdoc-'));
  dirs.push(dir);
  const files = {
    '.docguard.json': JSON.stringify({ projectName: 'nav', profile: 'starter' }),
    'src/pricing.mjs': '/** @implements acme.pricing#FR-001\n * @doc ARCHITECTURE.md */\nexport function discount(t) { return t > 100 ? t * 0.9 : t; }\n',
    'docs-canonical/ARCHITECTURE.md': [
      '# Architecture',
      '<!-- docguard:last-reviewed 2026-09-29 -->',
      '',
      '## Pricing',
      '',
      '<!-- docguard:section id=pricing source=human covers="src/pricing.mjs#discount" -->',
      'Discounts live in src/pricing.mjs and the `pricing` module.',
      '<!-- /docguard:section -->',
      '',
      '## Limits',
      '',
      'See pricing.mjs for thresholds.',
      '',
      '```markdown',
      '## Not a heading',
      '<!-- docguard:section id=example source=human -->',
      '<!-- /docguard:section -->',
      '```',
      '',
      '## Big',
      '',
      LONG,
      '',
      '## Twice',
      'one',
      '## Twice',
      'two',
      '',
    ].join('\n'),
    'AGENTS.md': '# Agents\n\nPricing rules are in src/pricing.mjs.\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

/** Send requests to `docguard mcp` over stdio and return responses by id. */
function mcp(dir, calls) {
  const messages = [
    { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    ...calls.map((c, i) => ({ jsonrpc: '2.0', id: 10 + i, method: 'tools/call', params: { name: c[0], arguments: c[1] } })),
  ];
  const r = spawnSync(process.execPath, [CLI, 'mcp'], { cwd: dir, input: `${messages.map(m => JSON.stringify(m)).join('\n')}\n`, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  const byId = new Map(r.stdout.trim().split('\n').map(l => JSON.parse(l)).map(m => [m.id, m]));
  const results = calls.map((_, i) => {
    const m = byId.get(10 + i);
    const text = m.result.content[0].text;
    return m.result.isError ? { error: text } : JSON.parse(text);
  });
  return { tools: byId.get(1).result.tools, results, raw: calls.map((_, i) => byId.get(10 + i).result.content[0].text) };
}

const NEW_TOOLS = ['docguard_docs_for_path', 'docguard_doc_structure', 'docguard_read_section', 'docguard_task_context'];
const OLD_TOOLS = ['docguard_guard', 'docguard_score', 'docguard_explain', 'docguard_verify_evidence', 'docguard_verify_claims', 'docguard_report', 'docguard_diagnose'];

describe('the tool list (FR-001, FR-009)', () => {
  it('adds four read-only tools, keeps the seven, and offers no model-backed tool', () => {
    const { tools } = mcp(project(), []);
    assert.deepEqual(tools.map(t => t.name).sort(), [...OLD_TOOLS, ...NEW_TOOLS].sort());
    for (const t of tools.filter(t => NEW_TOOLS.includes(t.name))) assert.equal(t.annotations.readOnlyHint, true, t.name);
    assert.ok(!tools.some(t => /(?:^|_)(?:ask|question|chat|answer)(?:_|$)/i.test(t.name)));
  });
});

describe('docguard_docs_for_path (FR-002, FR-003, FR-008)', () => {
  it('names every doc line, instruction line, requirement, annotation and covered section, byte-identically twice', () => {
    const dir = project();
    const { results, raw } = mcp(dir, [['docguard_docs_for_path', { path: 'src/pricing.mjs' }], ['docguard_docs_for_path', { path: 'src/pricing.mjs' }]]);
    const r = results[0];
    assert.equal(raw[0], raw[1], 'deterministic');
    // The marker line itself names the file in covers=, as trace --reverse also reports.
    assert.deepEqual(r.references.items.map(x => [x.line, x.kind, x.heading?.anchor, x.section]), [[6, 'path', 'pricing', 'pricing'], [7, 'path', 'pricing', 'pricing'], [12, 'basename', 'limits', null]]);
    // docguard.output-ux#FR-010: an instruction hit carries its line, like a doc reference.
    assert.deepEqual(r.agentInstructions.items, [{ doc: 'AGENTS.md', line: 3, kind: 'path', text: 'Pricing rules are in src/pricing.mjs.' }]);
    assert.deepEqual(r.requirements.items, [{ kind: 'implements', id: 'acme.pricing#FR-001' }]);
    assert.deepEqual(r.docAnnotations.items, ['ARCHITECTURE.md']);
    assert.deepEqual(r.covers.items, [{ section: 'docs-canonical/ARCHITECTURE.md#pricing', ref: 'src/pricing.mjs#discount', state: 'unaccepted' }]);
    assert.deepEqual({ total: r.references.total, returned: r.references.returned, truncated: r.references.truncated }, { total: 3, returned: 3, truncated: false });
    assert.equal(r.owner, null);
  });

  it('matches exactly what trace --reverse reports (one matcher)', () => {
    const dir = project();
    const trace = JSON.parse(spawnSync(process.execPath, [CLI, 'trace', '--reverse', 'src/pricing.mjs', '--format', 'json'], { cwd: dir, encoding: 'utf8' }).stdout);
    const { results } = mcp(dir, [['docguard_docs_for_path', { path: 'src/pricing.mjs' }]]);
    assert.deepEqual(results[0].references.items.map(x => [x.doc, x.line, x.kind]), trace.matches.map(m => [m.doc, m.line, m.kind]));
  });

  it('answers for a file that does not exist (docs may still cite it)', () => {
    const { results } = mcp(project(), [['docguard_docs_for_path', { path: 'src/gone.mjs' }]]);
    assert.equal(results[0].exists, false);
  });
});

describe('path safety (FR-007)', () => {
  it('refuses traversal, absolute, private and symlinked paths by name', () => {
    const dir = project();
    symlinkSync(join(dir, 'src/pricing.mjs'), join(dir, 'src/link.mjs'));
    const { results } = mcp(dir, [
      ['docguard_docs_for_path', { path: '../x.mjs' }],
      ['docguard_docs_for_path', { path: '/etc/passwd' }],
      ['docguard_docs_for_path', { path: '.env' }],
      ['docguard_docs_for_path', { path: 'src/link.mjs' }],
      ['docguard_doc_structure', { doc: 'src/pricing.mjs' }],
    ]);
    assert.match(results[0].error, /must not contain \.\./);
    assert.match(results[1].error, /relative to the project/);
    assert.match(results[2].error, /private or outside the project/);
    assert.match(results[3].error, /symbolic link/);
    assert.match(results[4].error, /must be a Markdown file/);
  });
});

describe('docguard_doc_structure (FR-004)', () => {
  it('returns headings with anchors and ranges, sections with covers, and ignores fenced examples', () => {
    const { results } = mcp(project(), [['docguard_doc_structure', { doc: 'docs-canonical/ARCHITECTURE.md' }]]);
    const s = results[0];
    assert.deepEqual(s.headings.items.map(h => [h.level, h.anchor, h.startLine]), [[1, 'architecture', 1], [2, 'pricing', 4], [2, 'limits', 10], [2, 'big', 20], [2, 'twice', 24], [2, 'twice', 26]]);
    assert.deepEqual(s.sections.items, [{ id: 'pricing', source: 'human', pinned: false, covers: ['src/pricing.mjs#discount'], startLine: 6, endLine: 8 }]);
    assert.equal(s.lastReviewed, '2026-09-29');
    assert.ok(s.totalBytes > 40000);
  });
});

describe('docguard_read_section (FR-005)', () => {
  it('resolves by id, anchor or heading, and fails an ambiguous heading with its lines', () => {
    const { results } = mcp(project(), [
      ['docguard_read_section', { doc: 'docs-canonical/ARCHITECTURE.md', id: 'pricing' }],
      ['docguard_read_section', { doc: 'docs-canonical/ARCHITECTURE.md', anchor: 'limits' }],
      ['docguard_read_section', { doc: 'docs-canonical/ARCHITECTURE.md', heading: 'Twice' }],
    ]);
    assert.equal(results[0].matchedBy, 'id');
    assert.equal(results[0].content, 'Discounts live in src/pricing.mjs and the `pricing` module.');
    assert.equal(results[1].matchedBy, 'anchor');
    assert.match(results[1].content, /^## Limits\n\nSee pricing\.mjs/);
    assert.match(results[2].error, /Heading "Twice" is ambiguous: lines 24, 26/);
  });

  it('bounds every read, pages with nextOffset, and never splits a character', () => {
    const dir = project();
    let offset = 0;
    let text = '';
    for (let i = 0; i < 12; i++) {
      const { results } = mcp(dir, [['docguard_read_section', { doc: 'docs-canonical/ARCHITECTURE.md', anchor: 'big', offset, maxBytes: 5001 }]]);
      const r = results[0];
      assert.ok(Buffer.byteLength(r.content) <= 5001);
      assert.ok(!r.content.includes('\uFFFD'), 'no split character');
      text += r.content;
      if (!r.truncated) break;
      offset = r.nextOffset;
    }
    assert.equal(text, `## Big\n\n${LONG}\n`);
    const { results } = mcp(dir, [['docguard_read_section', { doc: 'docs-canonical/ARCHITECTURE.md', anchor: 'big', maxBytes: 999999 }]]);
    assert.equal(Buffer.byteLength(results[0].content) <= 32 * 1024, true, 'hard cap');
    assert.equal(results[0].truncated, true, 'a 40 KB section is cut at the cap');
  });
});

describe('docguard_task_context (FR-006)', () => {
  it('returns the agent --task packet unchanged', () => {
    const dir = project();
    const cli = JSON.parse(spawnSync(process.execPath, [CLI, 'agent', '--task', 'change the pricing discount', '--format', 'json'], { cwd: dir, encoding: 'utf8' }).stdout);
    const { results } = mcp(dir, [['docguard_task_context', { task: 'change the pricing discount' }]]);
    assert.deepEqual(results[0], cli);
  });
});

// SC-005: the listing test below compares sets, so it fails on a missing tool
// and on an extra one alike.
describe('published listings match tools/list (FR-010, FR-011)', () => {
  const names = mcp(project(), []).tools.map(t => t.name).sort();
  const found = text => [...new Set(text.match(/docguard_[a-z_]+/g) || [])].sort();

  it('the MCPB manifest, Smithery config, ai-integration table and commands reference agree', () => {
    assert.deepEqual(JSON.parse(readFileSync('mcpb/manifest.template.json', 'utf8').replace('__VERSION__', '0.0.0')).tools.map(t => t.name).sort(), names);
    assert.deepEqual(found(readFileSync('smithery.yaml', 'utf8')), names);
    assert.deepEqual(found(readFileSync('docs/ai-integration.md', 'utf8').split('\n').filter(l => l.startsWith('| `docguard_')).join('\n')), names);
    const cmds = readFileSync('docs/commands.md', 'utf8');
    assert.deepEqual(found(cmds.slice(cmds.indexOf('### `docguard mcp`'), cmds.indexOf('```', cmds.indexOf('### `docguard mcp`')))), names);
  });

  it('server.json and the README no longer enumerate a stale subset', () => {
    assert.doesNotMatch(JSON.parse(readFileSync('server.json', 'utf8')).description, /guard, score, explain, verify-claims and diagnose/);
    assert.doesNotMatch(readFileSync('README.md', 'utf8'), /tools for guard, score, explain, verify-evidence, verify-claims, report and diagnose\./);
  });

  it('the budget measures every new tool response', () => {
    const budgets = JSON.parse(readFileSync('budgets.json', 'utf8'));
    for (const tool of NEW_TOOLS) assert.ok(budgets.mcpCalls.some(c => c.tool === tool), tool);
  });
});

describe('the success criteria', () => {
  it('SC-001: finding and reading what describes as-built.mjs costs at most 25% of reading those docs whole', () => {
    const r = docsForPath(process.cwd(), {}, 'cli/scanners/as-built.mjs');
    const docs = [...new Set(r.references.items.map(x => x.doc))];
    assert.ok(docs.length >= 1);
    const whole = docs.reduce((sum, d) => sum + statSync(d).size, 0);
    let navigated = Buffer.byteLength(JSON.stringify(r));
    for (const ref of r.references.items) navigated += Buffer.byteLength(JSON.stringify(readSection(process.cwd(), {}, { doc: ref.doc, line: ref.line })));
    assert.ok(navigated <= whole * 0.25, `${navigated} bytes vs ${whole}`);
  });

  it('SC-002: every new tool answers the budget inputs in 32 KiB or less', () => {
    const budgets = JSON.parse(readFileSync('budgets.json', 'utf8'));
    const call = { docguard_docs_for_path: a => docsForPath(process.cwd(), {}, a.path), docguard_doc_structure: a => docStructure(process.cwd(), {}, a.doc), docguard_read_section: a => readSection(process.cwd(), {}, a), docguard_task_context: a => buildTaskContextPacket(process.cwd(), {}, a.task) };
    for (const c of budgets.mcpCalls.filter(x => call[x.tool])) {
      const bytes = Buffer.byteLength(JSON.stringify(call[c.tool](c.arguments)));
      assert.ok(bytes <= 32 * 1024, `${c.tool}: ${bytes}`);
    }
  });

  it('SC-003: the User Story 1 fixture returns exactly its four facts, in a stable order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docguard-mcpdoc-us1-'));
    dirs.push(dir);
    const put = (rel, c) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), c); };
    put('.docguard.json', '{"projectName":"us1","profile":"starter"}');
    put('src/a.mjs', '/** @implements acme.x#FR-001 */\nexport const a = 1;\n');
    put('docs-canonical/ARCHITECTURE.md', '# A\n\nSee src/a.mjs.\n');
    put('docs-canonical/DATA-MODEL.md', '# D\n\nThe `a` module.\n');
    put('AGENTS.md', '# Agents\n\nsrc/a.mjs is special.\n');
    const { results, raw } = mcp(dir, [['docguard_docs_for_path', { path: 'src/a.mjs' }], ['docguard_docs_for_path', { path: 'src/a.mjs' }]]);
    const r = results[0];
    const facts = [...r.references.items.map(x => `${x.doc}:${x.kind}`), ...r.agentInstructions.items.map(x => `${x.doc}:${x.kind}`), ...r.requirements.items.map(x => x.id)];
    assert.deepEqual(facts, ['docs-canonical/ARCHITECTURE.md:path', 'docs-canonical/DATA-MODEL.md:module', 'AGENTS.md:path', 'acme.x#FR-001']);
    assert.equal(raw[0], raw[1]);
  });

  it('SC-004: twenty traversal and symlink inputs are refused and a file outside the root never leaks', () => {
    const dir = project();
    const outside = mkdtempSync(join(tmpdir(), 'docguard-mcpdoc-outside-'));
    dirs.push(outside);
    writeFileSync(join(outside, 'secret.md'), '# SENTINEL-7f3a\n');
    symlinkSync(join(outside, 'secret.md'), join(dir, 'docs-canonical/link.md'));
    symlinkSync(outside, join(dir, 'escape'));
    // Private files exist, so only a refusal (never "not found") can pass.
    writeFileSync(join(dir, '.env'), 'SECRET=1\n');
    writeFileSync(join(dir, '.env.local'), 'SECRET=2\n');
    mkdirSync(join(dir, 'src/.local'), { recursive: true });
    writeFileSync(join(dir, 'src/.local/k'), 'k\n');
    mkdirSync(join(dir, '.local'), { recursive: true });
    writeFileSync(join(dir, '.local/x.md'), '# private\n');
    const bad = ['../x', '../../etc/passwd', '/etc/passwd', 'src/../../x', './../x', 'a\\b', 'a\0b', '.env', '.env.local', 'src/.local/k', 'docs-canonical/link.md', 'escape/secret.md', 'C:/x', '..', 'src/..', '', ' ', 'docs-canonical/../../x.md', '.local/x.md', 'escape'];
    assert.equal(bad.length, 20);
    const calls = bad.map(p => ['docguard_docs_for_path', { path: p }]);
    const docCalls = ['docs-canonical/link.md', 'escape/secret.md', '../secret.md'].map(p => ['docguard_read_section', { doc: p, line: 1 }]);
    const { results, raw } = mcp(dir, [...calls, ...docCalls]);
    const mustRefuse = new Set(['.env', '.env.local', 'src/.local/k', '.local/x.md', 'docs-canonical/link.md', 'escape/secret.md', 'escape']);
    for (const [i, r] of results.entries()) {
      const input = (calls[i] || docCalls[i - calls.length])[1];
      if (mustRefuse.has(input.path || input.doc)) assert.ok(r.error, `${JSON.stringify(input)} exists and must be refused`);
      assert.ok(r.error || r.exists === false, `input ${i} (${JSON.stringify((calls[i] || docCalls[i - calls.length])[1])}) was not refused: ${JSON.stringify(r).slice(0, 120)}`);
    }
    assert.ok(!raw.some(text => text.includes('SENTINEL-7f3a')), 'no content from outside the root');
  });

  it('read_section with line returns just the lines around a reference', () => {
    const { results } = mcp(project(), [['docguard_read_section', { doc: 'docs-canonical/ARCHITECTURE.md', line: 12, context: 1 }]]);
    assert.equal(results[0].matchedBy, 'line');
    assert.deepEqual([results[0].startLine, results[0].endLine], [11, 13]);
    assert.equal(results[0].content, '\nSee pricing.mjs for thresholds.\n');
  });
});
