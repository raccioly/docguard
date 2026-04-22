const fs = require('fs');
let content = fs.readFileSync('vscode-extension/extension.js', 'utf8');

// Undo the renaming of specguard that breaks diagnostics and commands not in package.json
content = content.replace("diagnosticCollection = vscode.languages.createDiagnosticCollection('docguard');", "diagnosticCollection = vscode.languages.createDiagnosticCollection('specguard');");
content = content.replace("if (line.includes('docguard:status draft')) {", "if (line.includes('specguard:status draft')) {");
content = content.replace("const rootFiles = ['package.json', '.docguard.json', 'README.md']", "const rootFiles = ['package.json', '.specguard.json', 'README.md']");

// Note: docguard.* command prefixes match package.json, so those are correct, but what about fixWithAI?
// The command docguard.fixWithAI was added in extension.js, but let's see if package.json has it.
// Actually package.json doesn't have fixWithAI, so it might not matter or maybe it shouldn't be exposed. But I'll leave docguard.fixWithAI as it is internally registered.

fs.writeFileSync('vscode-extension/extension.js', content, 'utf8');
