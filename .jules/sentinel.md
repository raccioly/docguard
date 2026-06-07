## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-20 - [Shell Injection via execSync in git log | wc -l]
**Vulnerability:** Found `execSync('git log --oneline --since="30 days ago" 2>/dev/null | wc -l', {cwd: projectDir})`.
**Learning:** Even without explicit user input, using `execSync` is inherently risky as it invokes a shell and can be subjected to environment or command manipulation. Additionally, `execSync` uses a limited buffer size by default, making output like `git log` susceptible to ENOBUFS crashes.
**Prevention:** Always use `execFileSync` to avoid shell invocation. For emulating piping, perform the calculation natively in javascript (e.g. splitting standard output by newlines). When reading substantial output, configure the `maxBuffer` property to comfortably accommodate the expected size.
