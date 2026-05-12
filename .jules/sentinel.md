## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.
## 2025-05-18 - [Command Injection false positive in VS Code extension]
**Vulnerability:** Initially thought `execSync` usage in `vscode-extension/extension.js` (e.g., `runCommand`, `execSpecguard`) was vulnerable to command injection.
**Learning:** Functions like `runCommand` and `execSpecguard` only pass hardcoded string literals to `execSync`. Because no user input or external data is ever concatenated into the command string, there is no command injection vector.
**Prevention:** Always trace the data flow to ensure external/user input actually reaches the `execSync` call before attempting to refactor it to `execFileSync`. Refactoring hardcoded string commands to arrays unnecessarily complicates cross-platform execution (e.g., `npx` vs `npx.cmd`).
