## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-18 - [execFileSync Windows .cmd execution issues]
**Vulnerability:** RCE via `execSync` string interpolation was found and mitigated.
**Learning:** When transitioning from `execSync` to `execFileSync` on Windows, direct execution of npm binaries without `.cmd` fails.
**Prevention:** Implement a fallback mechanism catching specifically `ENOENT` to try the `.cmd` variation, re-throwing other exceptions to preserve the error code and stdout pipeline correctly without swallowing non-zero exits.
