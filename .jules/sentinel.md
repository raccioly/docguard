## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-18 - [Command Injection via execSync with shell pipes]
**Vulnerability:** Use of `execSync` with shell pipes (`| wc -l`, `| grep -c`) and interpolated paths/arguments allows command injection.
**Learning:** `execSync` evaluates shell metacharacters, leading to vulnerabilities if inputs are not strictly sanitized. Even when seemingly harmless strings like `which ${name}` are used, it runs in a shell.
**Prevention:** Emulate shell pipes natively in JavaScript (e.g. using `.split('\n').filter(Boolean).length` instead of `| wc -l` and `.match(/pattern/g).length` instead of `| grep -c`). Always use `execFileSync` to execute commands directly without a shell, avoiding interpolation entirely.
