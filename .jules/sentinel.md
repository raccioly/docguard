## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-18 - [Command Injection via execSync in VS Code Extension]
**Vulnerability:** The VS Code extension `execSpecguard` function utilized `execSync(cmd)` where arguments were concatenated as a single string, exposing the extension to command injection if paths or command arguments were user-controlled or malicious.
**Learning:** `execSync` is a persistent anti-pattern across not just CLI utilities but also IDE extensions, where the same `child_process` rules apply. Using local `.bin` directories on Windows requires executing `.cmd` explicitly or gracefully falling back using try-catch when `execFileSync` is utilized instead of `execSync`.
**Prevention:** Strictly enforce `execFileSync` passing arguments as an array instead of a constructed command string. Add Windows `.cmd` resolution safeguards when dropping the shell environment dependency.
