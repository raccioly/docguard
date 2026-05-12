## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

2025-05-15 - [Hardcoded Database Credentials]
Vulnerability: Fallback values for database URLs containing credentials (even local ones) can be accidentally committed and used in insecure environments.
Learning: Always fail securely if a required credential-bearing environment variable is missing rather than providing a default fallback.
Prevention: Use `os.environ.get()` without a default and raise an error if the value is `None`, and provide a `.env.example` file for guidance.
