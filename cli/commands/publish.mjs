/**
 * DocGuard Publish Command
 * Scaffolds documentation publishing config for external doc platforms.
 * Currently supports: Mintlify
 * 
 * Usage: docguard publish --platform mintlify [--dir .]
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { c } from '../shared.mjs';

const SUPPORTED_PLATFORMS = ['mintlify'];

export function runPublish(projectDir, config, flags) {
  const platform = flags.platform || 'mintlify';

  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    console.error(`${c.red}✗ Unsupported platform: ${platform}${c.reset}`);
    console.log(`  Supported: ${SUPPORTED_PLATFORMS.join(', ')}`);
    process.exit(1);
  }

  console.log(`${c.bold}📚 DocGuard Publish — ${platform}${c.reset}`);
  console.log(`${c.dim}   Scaffolding ${platform} docs from canonical documentation...${c.reset}\n`);

  switch (platform) {
    case 'mintlify':
      scaffoldMintlify(projectDir, config, flags);
      break;
  }
}

function scaffoldMintlify(dir, config, flags) {
  const docsDir = resolve(dir, 'docs');

  // Check for existing Mintlify setup
  if (existsSync(resolve(dir, 'docs.json')) && !flags.force) {
    console.log(`  ${c.yellow}⚠️  docs.json already exists.${c.reset} Use --force to overwrite.`);
    return;
  }

  // Create docs directory
  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }

  let created = 0;

  // ── 1. Generate docs.json (Mintlify v2 config) ──
  const docsJson = {
    "$schema": "https://mintlify.com/docs.json",
    name: config.projectName || basename(dir),
    logo: {
      dark: "/logo/dark.svg",
      light: "/logo/light.svg",
    },
    favicon: "/favicon.svg",
    colors: {
      primary: "#0D9373",
      light: "#07C983",
      dark: "#0D9373",
    },
    topbarLinks: [
      {
        name: "GitHub",
        url: `https://github.com/${config.repository || 'your-org/your-repo'}`,
      },
    ],
    topbarCtaButton: {
      name: "Get Started",
      url: "/quickstart",
    },
    tabs: [
      {
        name: "Architecture",
        url: "architecture",
      },
      {
        name: "API Reference",
        url: "api-reference",
      },
    ],
    navigation: buildMintlifyNavigation(dir),
    footerSocials: {
      github: `https://github.com/${config.repository || 'your-org/your-repo'}`,
    },
  };

  writeFileSync(resolve(dir, 'docs.json'), JSON.stringify(docsJson, null, 2), 'utf-8');
  console.log(`  ${c.green}✅ docs.json${c.reset} (Mintlify v2 config)`);
  created++;

  // ── 2. Generate introduction.mdx ──
  const readmePath = resolve(dir, 'README.md');
  let readmeContent = '';
  if (existsSync(readmePath)) {
    readmeContent = readFileSync(readmePath, 'utf-8');
    // Extract first paragraph for description
    const firstPara = readmeContent.split('\n\n').slice(1, 3).join('\n\n');
    readmeContent = firstPara;
  }

  const introContent = `---
title: Introduction
description: "${config.projectName} documentation"
---

# ${config.projectName}

${readmeContent || `Welcome to the ${config.projectName} documentation.`}

## Quick Links

<CardGroup cols={2}>
  <Card title="Quick Start" icon="rocket" href="/quickstart">
    Get up and running in 5 minutes
  </Card>
  <Card title="Architecture" icon="building" href="/architecture">
    Understand the system design
  </Card>
  <Card title="API Reference" icon="code" href="/api-reference">
    Explore the API endpoints
  </Card>
  <Card title="Data Model" icon="database" href="/data-model">
    Learn about the data structure
  </Card>
</CardGroup>
`;

  writeFileSync(resolve(docsDir, 'introduction.mdx'), introContent, 'utf-8');
  console.log(`  ${c.green}✅ docs/introduction.mdx${c.reset}`);
  created++;

  // ── 3. Generate quickstart.mdx ──
  const quickstartContent = `---
title: Quick Start
description: "Get started with ${config.projectName}"
---

# Quick Start

## Prerequisites

- Node.js 18+
- npm or pnpm

## Installation

\`\`\`bash
npm install
\`\`\`

## Setup

\`\`\`bash
cp .env.example .env.local
# Fill in environment variables
npm run dev
\`\`\`

## Verify

\`\`\`bash
npx docguard-cli guard    # Check documentation compliance
npx docguard-cli score    # View CDD maturity score
\`\`\`
`;

  writeFileSync(resolve(docsDir, 'quickstart.mdx'), quickstartContent, 'utf-8');
  console.log(`  ${c.green}✅ docs/quickstart.mdx${c.reset}`);
  created++;

  // ── 4. Map canonical docs to Mintlify pages ──
  const canonicalDir = resolve(dir, 'docs-canonical');
  const mappings = [
    { source: 'ARCHITECTURE.md', target: 'architecture.mdx', title: 'Architecture' },
    { source: 'API-REFERENCE.md', target: 'api-reference.mdx', title: 'API Reference' },
    { source: 'DATA-MODEL.md', target: 'data-model.mdx', title: 'Data Model' },
    { source: 'SECURITY.md', target: 'security.mdx', title: 'Security' },
    { source: 'ENVIRONMENT.md', target: 'environment.mdx', title: 'Environment' },
    { source: 'TEST-SPEC.md', target: 'test-spec.mdx', title: 'Test Specification' },
  ];

  for (const mapping of mappings) {
    const sourcePath = resolve(canonicalDir, mapping.source);
    if (existsSync(sourcePath)) {
      let content = readFileSync(sourcePath, 'utf-8');

      // Add Mintlify frontmatter
      const frontmatter = `---\ntitle: "${mapping.title}"\ndescription: "${config.projectName} ${mapping.title.toLowerCase()}"\n---\n\n`;

      // Remove docguard metadata comments
      content = content.replace(/<!--\s*docguard:\w+\s+[^>]+\s*-->\n?/g, '');
      content = content.replace(/> \*\*Auto-generated by DocGuard\.\*\*[^\n]*\n?/g, '');

      writeFileSync(resolve(docsDir, mapping.target), frontmatter + content, 'utf-8');
      console.log(`  ${c.green}✅ docs/${mapping.target}${c.reset} ← ${mapping.source}`);
      created++;
    }
  }

  // ── Summary ──
  console.log(`\n${c.bold}  ─────────────────────────────────────────${c.reset}`);
  console.log(`  ${c.green}Created: ${created} files${c.reset}`);
  console.log(`\n  ${c.bold}Next steps:${c.reset}`);
  console.log(`  ${c.cyan}1.${c.reset} Install Mintlify: ${c.dim}npm install -g mintlify${c.reset}`);
  console.log(`  ${c.cyan}2.${c.reset} Preview locally: ${c.dim}mintlify dev${c.reset}`);
  console.log(`  ${c.cyan}3.${c.reset} Push to GitHub → auto-deploys on Mintlify${c.reset}`);
  console.log(`  ${c.dim}\n  Mintlify is free for open-source projects.${c.reset}`);
  console.log(`  ${c.dim}  Docs: https://mintlify.com/docs${c.reset}\n`);
}

function buildMintlifyNavigation(dir) {
  const nav = [
    {
      group: "Getting Started",
      pages: ["introduction", "quickstart"],
    },
  ];

  // Add architecture group if docs exist
  const canonicalDir = resolve(dir, 'docs-canonical');
  const architecturePages = [];
  if (existsSync(resolve(canonicalDir, 'ARCHITECTURE.md'))) architecturePages.push("architecture");
  if (existsSync(resolve(canonicalDir, 'DATA-MODEL.md'))) architecturePages.push("data-model");
  if (existsSync(resolve(canonicalDir, 'SECURITY.md'))) architecturePages.push("security");
  if (architecturePages.length > 0) {
    nav.push({ group: "Architecture", pages: architecturePages });
  }

  // Add operations group
  const opsPages = [];
  if (existsSync(resolve(canonicalDir, 'ENVIRONMENT.md'))) opsPages.push("environment");
  if (existsSync(resolve(canonicalDir, 'TEST-SPEC.md'))) opsPages.push("test-spec");
  if (opsPages.length > 0) {
    nav.push({ group: "Operations", pages: opsPages });
  }

  // Add API reference
  if (existsSync(resolve(canonicalDir, 'API-REFERENCE.md'))) {
    nav.push({ group: "API Reference", pages: ["api-reference"] });
  }

  return nav;
}
