## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-18 - [execFileSync Windows Regression via CVE-2024-27980]
**Vulnerability:** A functional regression risk exists when migrating `execSync` to `execFileSync` for Windows binaries. Spawning `.cmd` or `.bat` files with `execFileSync` throws an `EINVAL` error unless `shell: true` is set, due to CVE-2024-27980 patches in Node.js.
**Learning:** We must not blanket-replace all `execSync` commands with `execFileSync`. For internally controlled, safe commands targeting Windows `.cmd` binaries (like `specify.cmd`), retaining `execSync` avoids this regression while maintaining security.
**Prevention:** Always verify if a binary is a `.cmd` script when using `execFileSync` without a shell on Windows, and ensure large buffered command outputs have an increased `maxBuffer` to prevent `ENOBUFS` errors on large repositories.
