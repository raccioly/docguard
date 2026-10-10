/**
 * The published user docs stay navigable, linked and true to the CLI.
 *
 * @req docguard.user-documentation#FR-001
 * @req docguard.user-documentation#FR-002
 * @req docguard.user-documentation#FR-003
 * @req docguard.user-documentation#FR-004
 * @req docguard.user-documentation#FR-005
 * @req docguard.user-documentation#FR-006
 * @req docguard.user-documentation#FR-007
 * @req docguard.user-documentation#FR-008
 * @req docguard.user-documentation#FR-009
 * @req docguard.user-documentation#SC-001
 * @req docguard.user-documentation#SC-002
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { renderFindingsReference, FINDINGS_REFERENCE } from '../tools/generate-docs-reference.mjs';
import { CODES, BLOCKER_CODES } from '../cli/findings.mjs';
import { LANGUAGE_NAMES } from '../cli/shared-source.mjs';

const DOCS = resolve('docs');

function markdownFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return name.endsWith('.md') ? [full] : [];
  });
}
const pages = markdownFiles(DOCS);
const rel = p => relative(process.cwd(), p);
const read = p => readFileSync(p, 'utf8');

function frontMatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  return Object.fromEntries(m[1].split('\n').map(l => l.split(/:\s*/)).filter(([k]) => k).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
}

// Fenced code blocks and inline code are not links.
const prose = text => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

describe('the finding-code reference is generated (FR-004)', () => {
  it(`${FINDINGS_REFERENCE} matches the code registry`, () => {
    assert.equal(read(FINDINGS_REFERENCE), renderFindingsReference(), 'run `npm run docs:reference`');
  });

  it('lists every finding and blocker code', () => {
    const text = read(FINDINGS_REFERENCE);
    for (const code of [...Object.keys(CODES), ...Object.keys(BLOCKER_CODES)]) {
      assert.match(text, new RegExp(`^### ${code}: `, 'm'), code);
    }
  });
});

describe('every page is in the navigation (FR-006)', () => {
  const titles = new Map(pages.map(p => [p, frontMatter(read(p))]));

  it('each page has front matter with a title and an order', () => {
    for (const [page, fm] of titles) {
      assert.ok(fm, `${rel(page)} has no front matter`);
      assert.ok(fm.title, `${rel(page)} has no title`);
      assert.ok(fm.nav_order || fm.permalink, `${rel(page)} has no nav_order`);
    }
  });

  it('each parent names a section page that exists', () => {
    const sections = new Set([...titles.values()].filter(fm => fm?.has_children === 'true').map(fm => fm.title));
    assert.ok(sections.has('Guides') && sections.has('Reference'));
    for (const [page, fm] of titles) {
      if (fm?.parent) assert.ok(sections.has(fm.parent), `${rel(page)}: parent "${fm.parent}" is not a section`);
    }
  });

  it('the site config uses a theme GitHub Pages builds without a repository build step', () => {
    const config = read('docs/_config.yml');
    assert.match(config, /^remote_theme: just-the-docs\/just-the-docs@v\d+\.\d+\.\d+$/m, 'theme pinned to a release');
    assert.match(config, /jekyll-remote-theme/);
  });

  it('no page contains Liquid tags the Pages build would execute', () => {
    for (const page of pages) assert.doesNotMatch(prose(read(page)), /\{\{|\{%/, rel(page));
  });
});

describe('every relative link resolves (FR-008, SC-001)', () => {
  it('links between docs pages point at files that exist', () => {
    const broken = [];
    for (const page of pages) {
      for (const [, target] of prose(read(page)).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        const path = target.split('#')[0];
        if (!existsSync(resolve(dirname(page), path))) broken.push(`${rel(page)} → ${target}`);
      }
    }
    assert.deepEqual(broken, []);
  });

  it('the landing page reaches every page', () => {
    const index = read('docs/index.md');
    const linked = new Set([...prose(index).matchAll(/\]\(([^)#\s]+)/g)].map(([, t]) => resolve(DOCS, t)));
    const unreached = pages.filter(p => !linked.has(p) && !p.endsWith('index.md') && !p.endsWith('README.md'));
    assert.deepEqual(unreached.map(rel), []);
  });
});

describe('the pages name only commands that exist (FR-008)', () => {
  const commands = new Set([...read('cli/docguard.mjs').matchAll(/case '([a-z-]+)':/g)].map(m => m[1]));

  it('every `docguard <command>` in the guides and reference is a real command', () => {
    const unknown = [];
    for (const page of pages) {
      if (page.endsWith('findings.md')) continue;
      // An invocation on one line: `docguard <cmd>` or `npx [--yes] docguard-cli[@v] <cmd>`.
      for (const [, , cmd] of read(page).matchAll(/(?<![\w/.-])(docguard|npx (?:--yes )?docguard-cli(?:@[\w.-]+)?) ([a-z][a-z-]*)\b/g)) {
        if (!commands.has(cmd)) unknown.push(`${rel(page)}: docguard ${cmd}`);
      }
    }
    assert.deepEqual(unknown, []);
  });
});

describe('the READMEs point readers to the docs (FR-007)', () => {
  it('the README links the docs site and the new guides', () => {
    const readme = read('README.md');
    assert.match(readme, /https:\/\/raccioly\.github\.io\/docguard\//);
    assert.match(readme, /guides\/existing-projects/);
    assert.match(readme, /reference\/languages/);
  });

  it('the Spanish and Portuguese READMEs link the English guides', () => {
    for (const file of ['README.es.md', 'README.pt-BR.md']) {
      const text = read(file);
      assert.match(text, /https:\/\/raccioly\.github\.io\/docguard\//, file);
      assert.match(text, /guides\/existing-projects/, file);
    }
  });
});

describe('the pages cover what the spec requires (FR-001, FR-002, FR-003, FR-005)', () => {
  it('the existing-projects guide walks from init to a gated first PR', () => {
    const guide = read('docs/guides/existing-projects.md');
    for (const step of ['docguard init', 'docguard generate', 'guard --update-baseline', 'docguard ci', 'generate --spec']) {
      assert.ok(guide.includes(step), `existing-projects.md mentions ${step}`);
    }
  });

  it('the languages page names every language DocGuard reads by pattern, plus the AST languages', () => {
    const page = read('docs/reference/languages.md');
    const names = new Set([...Object.values(LANGUAGE_NAMES), 'JavaScript', 'TypeScript', 'Python']);
    for (const name of names) assert.ok(page.includes(name), `languages.md names ${name}`);
    for (const tier of ['js-ast', 'py-ast', 'regex-fallback', 'fallback-language']) assert.ok(page.includes(tier), tier);
  });

  it('the agents page names every agent the scaffolder and the skill installer know', () => {
    const page = read('docs/reference/agents.md');
    const scaffolder = read('cli/commands/agents.mjs');
    const targets = [...scaffolder.slice(scaffolder.indexOf('const AGENT_TARGETS'), scaffolder.indexOf('\n};', scaffolder.indexOf('const AGENT_TARGETS'))).matchAll(/^  ([a-z-]+): \{/gm)].map(m => m[1]);
    assert.ok(targets.length >= 6, targets.join());
    const surface = read('cli/agent-surface.mjs');
    const signals = [...surface.slice(surface.indexOf('SIGNAL_SKILL_DIRS')).split('};')[0].matchAll(/'?([a-z-]+)'?: '([^']+)'/g)];
    for (const name of targets) assert.match(page, new RegExp(`\\b${name}\\b`, 'i'), `agents.md names ${name}`);
    for (const [, key, dir] of signals) {
      assert.ok(page.includes(key), `agents.md names ${key}`);
      assert.ok(page.includes(dir), `agents.md names ${dir}`);
    }
  });

  it('installation and the guides cover every channel and topic', () => {
    const install = read('docs/installation.md');
    for (const channel of ['npm', 'pipx', 'brew install', 'ghcr.io/raccioly/docguard', 'raccioly/docguard@', 'specify extension add', '.mcpb']) {
      assert.ok(install.includes(channel), `installation.md covers ${channel}`);
    }
    for (const page of ['guides/ci.md', 'guides/monorepo.md', 'guides/upgrading.md', 'guides/troubleshooting.md', 'guides/spec-kit.md', 'reference/mcp.md']) {
      assert.ok(existsSync(join(DOCS, page)), page);
    }
  });
});

describe('statements proved wrong stay corrected (FR-009)', () => {
  const help = args => spawnSync(process.execPath, ['cli/docguard.mjs', ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }).stdout;

  it('no doc offers a Spec Kit install that fails or a flag Spec Kit removed', () => {
    for (const file of ['README.md', 'docs/quickstart.md', 'docs/installation.md', 'extensions/spec-kit-docguard/README.md', ...pages.map(rel)]) {
      const text = read(file);
      assert.doesNotMatch(text, /^specify extension add docguard\s*$/m, `${file}: bare catalog install`);
      assert.doesNotMatch(text, /specify init[^\n]*--ai\b/, `${file}: removed --ai flag`);
    }
  });

  it('the README names only agents, commands and hooks that exist', () => {
    const readme = read('README.md');
    assert.doesNotMatch(readme, /--agent antigravity|\/docguard\.init\b|\/docguard\.update\b/);
    assert.match(readme, /\*\*5 enterprise-grade AI skills\*\*/);
    for (const hook of ['before_specify', 'before_tasks', 'after_implement', 'after_converge', 'after_tasks']) assert.ok(readme.includes(`\`${hook}\``), hook);
  });

  it('CLI help describes ci as the gate and does not offer guard a flag it ignores', () => {
    assert.doesNotMatch(help(['ci', '--help']), /Generate CI/);
    assert.doesNotMatch(help(['guard', '--help']), /--fail-on-warning/);
    assert.match(help(['--help']), /ci +GitHub Actions workflow/);
  });
});
