## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-18 - [Command Injection via detectAIAgent in execSync]
**Vulnerability:** Command Injection in `cli/commands/init.mjs` and `cli/ensure-skills.mjs`. The `detectAIAgent` function read configuration files (`init-options.json`) which could contain malicious inputs for the agent name. This unvalidated input was then interpolated directly into an `execSync` call via `aiFlag` (e.g., `specify init ... --ai ${detectedAgent}`).
**Learning:** Even seemingly benign values extracted from config files (like an AI agent identifier) can become command injection vectors if the config is tampered with and the value is concatenated into a raw shell string execution.
**Prevention:** Strictly enforce the use of `execFileSync` with explicitly separated argument arrays rather than concatenating CLI flags and values into a single command string, completely bypassing shell interpretation.
