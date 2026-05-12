## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-24 - [Command Injection in VS Code Extension]
**Vulnerability:** Command Injection in `execSpecguard` due to shell concatenation of arguments in `execSync`.
**Learning:** Even when current callers use "safe" strings, using shell-based execution for external tools in a VS Code extension is dangerous as it might eventually handle user-controlled workspace paths or configuration.
**Prevention:** Use `execFileSync` with an array of arguments. Prioritize direct execution of JavaScript entry points with `node` to avoid shell shims. Handle platform-specifics (like `npx.cmd`) explicitly.
