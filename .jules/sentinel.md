## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.
## 2025-05-18 - [Command Injection via execSync in VS Code Extension]
**Vulnerability:** The VS Code extension used `execSync` with concatenated string arguments, including the potentially user-controlled `workspaceDir`, which could lead to command injection if the directory path contained shell metacharacters.
**Learning:** Using `execSync` with untrusted directory paths in a VS Code extension is dangerous. We must use `execFileSync` with array arguments. Also, using `node <script>` instead of `.cmd` wrappers avoids Windows shell execution vulnerabilities.
**Prevention:** Always use `execFileSync` with array arguments for executing external commands. Implement custom argument parsing to correctly tokenize string arguments, and execute Node.js scripts directly via `node` instead of relying on shell wrappers.
