const fs = require('fs');
let pkg = JSON.parse(fs.readFileSync('vscode-extension/package.json', 'utf8'));
let ext = fs.readFileSync('vscode-extension/extension.js', 'utf8');

pkg.contributes.commands.forEach(c => {
  if (!ext.includes(c.command)) {
    console.error("Missing command registration for:", c.command);
  }
});
console.log("Validation complete.");
