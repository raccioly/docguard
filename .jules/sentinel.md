## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-18 - [Command Injection via execSync in VSCode extension]
**Vulnerability:** Found `execSync` used with string interpolation (`cmd = \`"${localBin}" ${args}\``) in `vscode-extension/extension.js`. This allows command injection if `args` or the workspace path contains shell metacharacters.
**Learning:** Node.js extensions executing CLI wrappers often concatenate strings to build shell commands. Because `execSync` executes in a shell by default, this creates a high-severity command injection vulnerability if any part of the path or arguments is untrusted.
**Prevention:** Always use `execFileSync` instead of `execSync` in extensions. Pass arguments as an explicit array, which bypasses shell interpolation. Handle `.cmd` suffixes for cross-platform execution explicitly instead of relying on the shell to resolve them.
