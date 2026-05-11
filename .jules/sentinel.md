## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.
## 2025-05-18 - [Command Injection via execSync in VS Code]
**Vulnerability:** Found `execSync` used in VS Code extension (`vscode-extension/extension.js`) where the `workspaceDir` was passed without mitigation against command injection.
**Learning:** `execSync` interprets shell metacharacters when executed as a string. `execFileSync` directly passes the parsed arguments to the executable and avoids RCE vulnerabilities. Additionally, using Node binaries requires calling them directly with `node` or using fallback mechanisms for Windows.
**Prevention:** Always use `execFileSync` avoiding `.split(' ')` issues, and properly fallback on `.cmd` when running `npx` on Windows.
