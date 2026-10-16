/**
 * IaC Detector — Identifies Infrastructure-as-Code projects.
 *
 * IaC code is real production source that defines cloud infrastructure.
 * It MUST be documented in ARCHITECTURE.md, not silently ignored. This
 * detector identifies which IaC tool the project uses so docs-coverage
 * can emit ONE consolidated actionable warning naming the actual layout
 * (instead of multiple generic per-directory warnings).
 *
 * Supported tools:
 *   - AWS CDK         → cdk.json marker file
 *   - Terraform       → *.tf files in any non-ignored directory
 *   - Pulumi          → Pulumi.yaml marker file
 *   - AWS SAM         → template.yaml/yml with "AWS::Serverless::"
 *   - Serverless Fmw  → serverless.yml/serverless.yaml/serverless.ts
 *
 * Zero NPM dependencies — pure Node.js built-ins only.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_IGNORE_DIRS } from '../shared-ignore.mjs';

const MAX_DEPTH = 6;

/**
 * Per-tool conventions: marker file/pattern + the directories that hold the
 * actual IaC source. Used to construct the consolidated warning text.
 */
const TOOL_PROFILES = {
  cdk: {
    label: 'AWS CDK',
    markerFile: 'cdk.json',
    sourceDirs: ['bin/ (app entrypoint)', 'lib/stacks/', 'lib/constructs/'],
    headingPattern: /^#+\s+(infrastructure|cdk|iac)\b/im,
  },
  terraform: {
    label: 'Terraform',
    markerFile: null, // any *.tf file
    sourceDirs: ['*.tf (root module)', 'modules/ (reusable modules)', 'environments/ (per-env tfvars)'],
    headingPattern: /^#+\s+(infrastructure|terraform|iac)\b/im,
  },
  pulumi: {
    label: 'Pulumi',
    markerFile: 'Pulumi.yaml',
    sourceDirs: ['index.ts (main program)', 'stacks/', 'config/'],
    headingPattern: /^#+\s+(infrastructure|pulumi|iac)\b/im,
  },
  sam: {
    label: 'AWS SAM',
    markerFile: 'template.yaml', // also template.yml — checked below
    sourceDirs: ['template.yaml (SAM manifest)', 'src/ (Lambda handlers)', 'events/'],
    headingPattern: /^#+\s+(infrastructure|sam|serverless|iac)\b/im,
  },
  serverless: {
    label: 'Serverless Framework',
    markerFile: 'serverless.yml', // also .yaml, .ts — checked below
    sourceDirs: ['serverless.yml (manifest)', 'handlers/', 'src/'],
    headingPattern: /^#+\s+(infrastructure|serverless|iac)\b/im,
  },
};

/**
 * Detect every IaC tool used in the project. Walks the tree from projectDir
 * looking for marker files, respecting DEFAULT_IGNORE_DIRS.
 *
 * @param {string} projectDir - Absolute path to project root
 * @returns {{
 *   isIaC: boolean,
 *   tools: Array<{
 *     tool: string,             // 'cdk' | 'terraform' | 'pulumi' | 'sam' | 'serverless'
 *     label: string,            // 'AWS CDK' etc.
 *     markerPaths: string[],    // relative paths to detected marker files
 *     packageDirs: string[],    // relative dirs containing the markers
 *     sourceDirs: string[],     // expected source layout per tool convention
 *   }>
 * }}
 */
export function detectIaC(projectDir) {
  const findings = {
    cdk: { markerPaths: [], packageDirs: [] },
    terraform: { markerPaths: [], packageDirs: [] },
    pulumi: { markerPaths: [], packageDirs: [] },
    sam: { markerPaths: [], packageDirs: [] },
    serverless: { markerPaths: [], packageDirs: [] },
  };

  const recordFinding = (tool, fullPath) => {
    const relPath = relative(projectDir, fullPath);
    findings[tool].markerPaths.push(relPath);
    const pkgDir = relative(projectDir, dirnameOf(fullPath)) || '.';
    if (!findings[tool].packageDirs.includes(pkgDir)) {
      findings[tool].packageDirs.push(pkgDir);
    }
  };

  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = join(dir, e.name);

      // CDK
      if (e.name === 'cdk.json') recordFinding('cdk', full);

      // Terraform — any .tf file (we record one per directory, not per file)
      if (e.name.endsWith('.tf')) {
        const pkgDir = relative(projectDir, dir) || '.';
        if (!findings.terraform.packageDirs.includes(pkgDir)) {
          findings.terraform.markerPaths.push(relative(projectDir, full));
          findings.terraform.packageDirs.push(pkgDir);
        }
      }

      // Pulumi
      if (e.name === 'Pulumi.yaml' || e.name === 'Pulumi.yml') {
        recordFinding('pulumi', full);
      }

      // SAM — template.yaml/yml WITH AWS::Serverless::
      if (e.name === 'template.yaml' || e.name === 'template.yml') {
        if (fileContains(full, 'AWS::Serverless::')) recordFinding('sam', full);
      }

      // Serverless Framework
      if (
        e.name === 'serverless.yml' ||
        e.name === 'serverless.yaml' ||
        e.name === 'serverless.ts' ||
        e.name === 'serverless.js'
      ) {
        recordFinding('serverless', full);
      }
    }

    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (DEFAULT_IGNORE_DIRS.has(e.name)) continue;
      if (e.name.startsWith('.')) continue;
      walk(join(dir, e.name), depth + 1);
    }
  };

  if (existsSync(projectDir)) {
    try {
      if (statSync(projectDir).isDirectory()) walk(projectDir, 0);
    } catch { /* skip */ }
  }

  const tools = [];
  for (const [tool, data] of Object.entries(findings)) {
    if (data.markerPaths.length > 0) {
      tools.push({
        tool,
        label: TOOL_PROFILES[tool].label,
        markerPaths: data.markerPaths,
        packageDirs: data.packageDirs,
        sourceDirs: TOOL_PROFILES[tool].sourceDirs,
      });
    }
  }

  return { isIaC: tools.length > 0, tools };
}

/**
 * Check whether ARCHITECTURE.md content includes an Infrastructure/CDK/IaC/
 * Terraform/Pulumi/SAM heading at any level. Case-insensitive.
 *
 * @param {string} archContent - Full ARCHITECTURE.md content
 * @returns {boolean}
 */
export function hasInfrastructureHeading(archContent) {
  if (!archContent) return false;
  return /^#+\s+(infrastructure|cdk|iac|terraform|pulumi|sam|serverless)\b/im.test(archContent);
}

/**
 * Build the consolidated warning text for a detected IaC tool.
 * One warning per tool — names the marker location and required content.
 */
export function buildIaCWarning(toolFinding) {
  const primary = toolFinding.markerPaths[0];
  const pkgDir = toolFinding.packageDirs[0];
  const where = pkgDir === '.' ? '' : pkgDir + '/';
  const sourceList = toolFinding.sourceDirs
    .map(s => s.startsWith('*.') ? `${where}${s}` : `${where}${s}`)
    .join(', ');
  return `${toolFinding.label} detected at ${primary} — add an "Infrastructure" section to ` +
    `ARCHITECTURE.md covering ${sourceList}`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function dirnameOf(p) {
  const i = p.lastIndexOf('/');
  if (i < 0) {
    const j = p.lastIndexOf('\\');
    return j < 0 ? p : p.slice(0, j);
  }
  return p.slice(0, i);
}

function fileContains(filePath, needle) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.includes(needle);
  } catch {
    return false;
  }
}

// ── Backwards-compatibility shim ────────────────────────────────────────────

/**
 * Legacy CDK-only API kept for callers that don't need multi-tool detection.
 * Delegates to detectIaC and projects the CDK slice into the old shape.
 *
 * @deprecated Use detectIaC for new code.
 */
export function detectCDK(projectDir) {
  const result = detectIaC(projectDir);
  const cdk = result.tools.find(t => t.tool === 'cdk');
  if (!cdk) {
    return { isCDK: false, cdkJsonPaths: [], cdkPackageDirs: [] };
  }
  return {
    isCDK: true,
    cdkJsonPaths: cdk.markerPaths,
    cdkPackageDirs: cdk.packageDirs,
  };
}
