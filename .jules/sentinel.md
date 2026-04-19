## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.
## 2025-05-18 - [Command Injection via execSync with which/where]
**Vulnerability:** Command injection vulnerability in `execSync` due to interpolated command variables.
**Learning:** Even variables that seem safe like `which`/`where` concatenated with target executable names should use `execFileSync` to avoid any shell interpolation risks, suppressing stderr output with `stdio: ['pipe', 'pipe', 'ignore']` instead of `2>/dev/null`.
**Prevention:** Replace `execSync` with `execFileSync`, pass arguments securely as an array, and use the `stdio` option to handle output redirection.
