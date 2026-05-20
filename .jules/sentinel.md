## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-18 - [execFileSync with Windows batch files]
**Vulnerability:** Command injection was possible in `specify init` because `execSync` was being used with a dynamically constructed string that included user input (the extracted agent string).
**Learning:** `execFileSync` cannot natively run `.cmd` or `.bat` files on Windows. If we switch to `execFileSync('specify.cmd', ...)` to prevent command injection, the process will fail without a shell wrapper. The safe way to invoke batch scripts cross-platform while preventing command injection is to explicitly use `cmd.exe /c` on Windows: `execFileSync('cmd.exe', ['/c', 'specify.cmd', ...args])`.
**Prevention:** When refactoring `execSync` to `execFileSync` for cross-platform execution of `.cmd` files, remember to prefix the command with `cmd.exe /c` on Windows to avoid breaking the application on that OS.
