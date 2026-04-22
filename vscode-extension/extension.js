/**
 * SpecGuard VS Code Extension
 * 
 * Features:
 * - Status bar CDD score (live updates)
 * - Inline diagnostics for missing/stale docs
 * - Commands: audit, guard, score, badge, init
 * - File watcher for auto-refresh on doc changes
 */

const vscode = require('vscode');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let statusBarItem;
let diagnosticCollection;
let outputChannel;
let fileWatcher;

// ── Activation ─────────────────────────────────────────────────────────────

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('SpecGuard');

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left, 100
  );
  statusBarItem.command = 'specguard.score';
  statusBarItem.tooltip = 'Click to see CDD score details';
  statusBarItem.accessibilityInformation = { label: 'CDD Score: Unknown', role: 'button' };
  context.subscriptions.push(statusBarItem);

  // Diagnostics
  diagnosticCollection = vscode.languages.createDiagnosticCollection('specguard');
  context.subscriptions.push(diagnosticCollection);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('specguard.audit', () => runCommand('audit')),
    vscode.commands.registerCommand('specguard.guard', () => runGuard()),
    vscode.commands.registerCommand('specguard.score', () => runCommand('score')),
    vscode.commands.registerCommand('specguard.badge', () => runBadge()),
    vscode.commands.registerCommand('specguard.init', () => runInit()),
    vscode.commands.registerCommand('specguard.refresh', async () => await refreshScore()),
    vscode.commands.registerCommand('specguard.fix', () => runFixCommand()),
    vscode.commands.registerCommand('specguard.fixWithAI', (issue) => fixWithAI(issue)),
    vscode.commands.registerCommand('specguard.fixAuto', () => runFixAuto()),
  );

  // Register Code Action provider for markdown files
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file', language: 'markdown' },
      new SpecGuardCodeActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );

  // File watcher for auto-refresh
  const config = vscode.workspace.getConfiguration('specguard');
  if (config.get('autoRefresh')) {
    fileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/docs-canonical/**/*.md'
    );
    fileWatcher.onDidChange(() => refreshScore());
    fileWatcher.onDidCreate(() => refreshScore());
    fileWatcher.onDidDelete(() => refreshScore());
    context.subscriptions.push(fileWatcher);

    // Also watch root docs
    const rootWatcher = vscode.workspace.createFileSystemWatcher(
      '**/{CHANGELOG,AGENTS,DRIFT-LOG,ROADMAP}.md'
    );
    rootWatcher.onDidChange(() => refreshScore());
    rootWatcher.onDidCreate(() => refreshScore());
    rootWatcher.onDidDelete(() => refreshScore());
    context.subscriptions.push(rootWatcher);
  }

  // Initial refresh
  if (config.get('showStatusBar')) {
    await refreshScore();
  }

  outputChannel.appendLine('SpecGuard extension activated');
}

function deactivate() {
  if (statusBarItem) statusBarItem.dispose();
  if (diagnosticCollection) diagnosticCollection.dispose();
  if (outputChannel) outputChannel.dispose();
  if (fileWatcher) fileWatcher.dispose();
}

// ── Code Action Provider ───────────────────────────────────────────────────

class SpecGuardCodeActionProvider {
  provideCodeActions(document, range, context) {
    const actions = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'SpecGuard') continue;

      // "Fix with AI" action — sends instruction to AI assistant
      if (diagnostic.code === 'unfilled-placeholder') {
        const fixAction = new vscode.CodeAction(
          '🔧 SpecGuard: Ask AI to fill this section',
          vscode.CodeActionKind.QuickFix
        );
        fixAction.diagnostics = [diagnostic];
        fixAction.command = {
          command: 'specguard.fixWithAI',
          title: 'Fix with AI',
          arguments: [{
            file: document.uri.fsPath,
            line: diagnostic.range.start.line + 1,
            instruction: `Replace the placeholder on line ${diagnostic.range.start.line + 1} with actual project content. Research the codebase to determine what should go here.`,
          }],
        };
        actions.push(fixAction);
      }

      if (diagnostic.code === 'draft-status') {
        const promoteAction = new vscode.CodeAction(
          '🔧 SpecGuard: Promote to active status',
          vscode.CodeActionKind.QuickFix
        );
        promoteAction.diagnostics = [diagnostic];
        promoteAction.edit = new vscode.WorkspaceEdit();
        const line = document.lineAt(diagnostic.range.start.line);
        promoteAction.edit.replace(
          document.uri,
          line.range,
          line.text.replace('draft', 'active')
        );
        actions.push(promoteAction);
      }

      if (diagnostic.code === 'missing-doc') {
        const initAction = new vscode.CodeAction(
          '🔧 SpecGuard: Auto-create missing docs',
          vscode.CodeActionKind.QuickFix
        );
        initAction.diagnostics = [diagnostic];
        initAction.command = {
          command: 'specguard.fixAuto',
          title: 'Auto-fix',
        };
        actions.push(initAction);
      }
    }

    return actions;
  }
}

// ── Core Functions ─────────────────────────────────────────────────────────

function getWorkspaceDir() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage('SpecGuard: No workspace folder open');
    return null;
  }
  return folders[0].uri.fsPath;
}

function getNodePath() {
  return vscode.workspace.getConfiguration('specguard').get('nodePath') || 'node';
}

function findSpecguard(workspaceDir) {
  // Check local node_modules first
  const localBin = path.join(workspaceDir, 'node_modules', '.bin', 'specguard');
  if (fs.existsSync(localBin)) return localBin;

  // Try npx
  return null;
}

function execSpecguard(workspaceDir, args) {
  const localBin = findSpecguard(workspaceDir);

  let cmd;
  if (localBin) {
    cmd = `"${localBin}" ${args}`;
  } else {
    cmd = `npx -y specguard ${args}`;
  }

  try {
    return execSync(cmd, {
      cwd: workspaceDir,
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
      timeout: 30000,
    });
  } catch (e) {
    outputChannel.appendLine(`SpecGuard error: ${e.message}`);
    return e.stdout || '';
  }
}

// ── Score Refresh ──────────────────────────────────────────────────────────

async function refreshScore() {
  const dir = getWorkspaceDir();
  if (!dir) return;

  try {
    const output = execSpecguard(dir, 'score --format json');
    const jsonStart = output.indexOf('{');
    if (jsonStart < 0) {
      statusBarItem.text = '$(shield) CDD: ?';
      statusBarItem.accessibilityInformation = { label: 'CDD Score: Unknown', role: 'button' };
      statusBarItem.show();
      return;
    }

    const data = JSON.parse(output.slice(jsonStart));
    const score = data.score;
    const grade = data.grade;
    const threshold = vscode.workspace.getConfiguration('specguard').get('scoreThreshold') || 60;

    // Update status bar
    let icon;
    let tooltipStatus;
    if (score >= 90) { icon = '$(verified)'; tooltipStatus = 'Excellent'; }
    else if (score >= 80) { icon = '$(pass)'; tooltipStatus = 'Good'; }
    else if (score >= threshold) { icon = '$(info)'; tooltipStatus = 'Passing'; }
    else { icon = '$(warning)'; tooltipStatus = `Below minimum threshold (${threshold})`; }

    statusBarItem.text = `${icon} CDD: ${score}/100 (${grade})`;
    statusBarItem.tooltip = `CDD Score: ${score}/100 - ${tooltipStatus}\nClick to see details`;
    statusBarItem.accessibilityInformation = { label: `CDD Score: ${score} out of 100, ${tooltipStatus}`, role: 'button' };
    statusBarItem.backgroundColor = score < threshold
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    statusBarItem.show();

    // Run diagnostics
    await runDiagnosticsAsync(dir);

    outputChannel.appendLine(`Score refreshed: ${score}/100 (${grade})`);
  } catch (e) {
    statusBarItem.text = '$(shield) CDD: ?';
    statusBarItem.accessibilityInformation = { label: 'CDD Score: Unknown', role: 'button' };
    statusBarItem.show();
    outputChannel.appendLine(`Score refresh error: ${e.message}`);
  }
}

// ── Diagnostics ────────────────────────────────────────────────────────────


async function runDiagnosticsAsync(workspaceDir) {
  diagnosticCollection.clear();

  const requiredFiles = [
    'docs-canonical/ARCHITECTURE.md',
    'docs-canonical/DATA-MODEL.md',
    'docs-canonical/SECURITY.md',
    'docs-canonical/TEST-SPEC.md',
    'docs-canonical/ENVIRONMENT.md',
    'AGENTS.md',
    'CHANGELOG.md',
    'DRIFT-LOG.md',
  ];

  const diagnosticsMap = new Map();
  const textDecoder = new TextDecoder('utf-8');

  await Promise.all(requiredFiles.map(async (file) => {
    const uri = vscode.Uri.file(path.join(workspaceDir, file));
    try {
      await vscode.workspace.fs.stat(uri);

      const fileData = await vscode.workspace.fs.readFile(uri);
      const content = textDecoder.decode(fileData);
      const lines = content.split('\n');

      const fileDiags = [];

      lines.forEach((line, i) => {
        if (line.includes('<!-- TODO') || line.includes('<!-- e.g.')) {
          const range = new vscode.Range(i, 0, i, line.length);
          const diag = new vscode.Diagnostic(
            range,
            `Template placeholder — fill in with real content`,
            vscode.DiagnosticSeverity.Information
          );
          diag.source = 'SpecGuard';
          diag.code = 'unfilled-placeholder';
          fileDiags.push(diag);
        }

        if (line.includes('specguard:status draft')) {
          const range = new vscode.Range(i, 0, i, line.length);
          const diag = new vscode.Diagnostic(
            range,
            `Document is in draft status — review and promote to 'active'`,
            vscode.DiagnosticSeverity.Hint
          );
          diag.source = 'SpecGuard';
          diag.code = 'draft-status';
          fileDiags.push(diag);
        }
      });

      if (fileDiags.length > 0) {
        diagnosticsMap.set(uri, fileDiags);
      }
    } catch (e) {
      if (e.code === 'FileNotFound' || e.code === 'ENOENT') {
        await addRootDiagnosticAsync(
          workspaceDir, diagnosticsMap,
          `Missing required CDD document: ${file}. Run 'SpecGuard: Initialize CDD Docs' to create it.`,
          vscode.DiagnosticSeverity.Warning
        );
      }
    }
  }));

  for (const [uri, diags] of diagnosticsMap) {
    diagnosticCollection.set(uri, diags);
  }
}

async function addRootDiagnosticAsync(workspaceDir, diagnosticsMap, message, severity) {
  const rootFiles = ['package.json', '.specguard.json', 'README.md']
    .map(f => vscode.Uri.file(path.join(workspaceDir, f)));

  let rootFileUri = null;
  for (const uri of rootFiles) {
    try {
      await vscode.workspace.fs.stat(uri);
      rootFileUri = uri;
      break;
    } catch (e) {
      // File does not exist
    }
  }

  if (!rootFileUri) return;

  if (!diagnosticsMap.has(rootFileUri)) {
    diagnosticsMap.set(rootFileUri, []);
  }

  const range = new vscode.Range(0, 0, 0, 0);
  const diag = new vscode.Diagnostic(range, message, severity);
  diag.source = 'SpecGuard';
  diag.code = 'missing-doc';
  diagnosticsMap.get(rootFileUri).push(diag);
}

// ── Commands ───────────────────────────────────────────────────────────────

function runCommand(cmd) {
  const dir = getWorkspaceDir();
  if (!dir) return;

  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.appendLine(`$ specguard ${cmd}\n`);

  const output = execSpecguard(dir, cmd);
  outputChannel.appendLine(output);
}

async function runGuard() {
  const dir = getWorkspaceDir();
  if (!dir) return;

  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.appendLine('$ specguard guard\n');

  const output = execSpecguard(dir, 'guard');
  outputChannel.appendLine(output);

  await runDiagnosticsAsync(dir);
  await refreshScore();

  if (output.includes('PASS')) {
    vscode.window.showInformationMessage('SpecGuard: All checks passed ✅');
  } else if (output.includes('WARN')) {
    const action = 'Run Fix';
    vscode.window.showWarningMessage('SpecGuard: Guard found warnings ⚠️', action).then(sel => {
      if (sel === action) runFixCommand();
    });
  } else {
    const action = 'Run Fix';
    vscode.window.showErrorMessage('SpecGuard: Guard found errors ❌', action).then(sel => {
      if (sel === action) runFixCommand();
    });
  }
}

function runFixCommand() {
  const dir = getWorkspaceDir();
  if (!dir) return;

  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.appendLine('$ specguard fix\n');

  const output = execSpecguard(dir, 'fix');
  outputChannel.appendLine(output);

  // Also get the AI prompt version
  const promptOutput = execSpecguard(dir, 'fix --format prompt');

  if (promptOutput && !promptOutput.includes('No CDD issues found')) {
    // Offer to copy AI prompt to clipboard
    const copyAction = 'Copy AI Fix Prompt';
    const autoAction = 'Auto-Fix';
    vscode.window.showInformationMessage(
      'SpecGuard found issues. Copy the fix prompt for your AI assistant?',
      copyAction, autoAction
    ).then(sel => {
      if (sel === copyAction) {
        vscode.env.clipboard.writeText(promptOutput).then(() => {
          vscode.window.showInformationMessage(
            'SpecGuard: AI fix prompt copied to clipboard! Paste it into Copilot Chat, Cursor, or any AI assistant.'
          );
        });
      } else if (sel === autoAction) {
        runFixAuto();
      }
    });
  }
}

async function runFixAuto() {
  const dir = getWorkspaceDir();
  if (!dir) return;

  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.appendLine('$ specguard fix --auto\n');

  const output = execSpecguard(dir, 'fix --auto');
  outputChannel.appendLine(output);

  await refreshScore();
  vscode.window.showInformationMessage('SpecGuard: Auto-fix complete! Review the created files.');
}

function fixWithAI(issue) {
  if (!issue) return;

  // Copy the AI instruction to clipboard for pasting into AI assistant
  const prompt = `In the file ${issue.file}, line ${issue.line}:\n${issue.instruction}\n\nPlease make this change now.`;

  vscode.env.clipboard.writeText(prompt).then(() => {
    vscode.window.showInformationMessage(
      'SpecGuard: Fix instruction copied to clipboard. Paste into your AI assistant (Copilot Chat, Cursor, etc.)'
    );
  });
}

function runBadge() {
  const dir = getWorkspaceDir();
  if (!dir) return;

  const output = execSpecguard(dir, 'badge --format json');
  const jsonStart = output.indexOf('{');
  if (jsonStart < 0) {
    vscode.window.showErrorMessage('SpecGuard: Could not generate badges');
    return;
  }

  try {
    const data = JSON.parse(output.slice(jsonStart));
    const snippet = data.readmeSnippet;

    vscode.env.clipboard.writeText(snippet).then(() => {
      vscode.window.showInformationMessage(
        `SpecGuard: Badge markdown copied to clipboard! Score: ${data.score}/100 (${data.grade})`
      );
    });
  } catch (e) {
    outputChannel.appendLine(`Badge error: ${e.message}`);
  }
}

async function runInit() {
  const dir = getWorkspaceDir();
  if (!dir) return;

  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.appendLine('$ specguard init\n');

  const output = execSpecguard(dir, 'init');
  outputChannel.appendLine(output);

  await refreshScore();
  vscode.window.showInformationMessage(
    'SpecGuard: CDD documentation initialized! Check the docs-canonical/ folder.'
  );
}

module.exports = { activate, deactivate };

