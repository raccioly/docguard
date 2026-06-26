## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-18 - [Systemic command injection via execSync]
**Vulnerability:** Discovered multiple remaining usages of `execSync` across the CLI commands and validators that used dynamic inputs or didn't safely invoke shell commands.
**Learning:** Even hardcoded commands with dynamic variable parts can be susceptible to injection if a variable leaks or inputs aren't safely split. Emulating shell behaviors (like pipes e.g. `| wc -l`) in native javascript requires splitting the standard output array and taking its length, instead of relying on the shell to perform counting.
**Prevention:** Always use `execFileSync` to avoid shell interpolation entirely. Additionally, for shell-like operations, leverage javascript array methods like `.split('\n').filter(Boolean).length`.
