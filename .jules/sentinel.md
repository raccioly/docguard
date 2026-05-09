## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-18 - [RCE in VS Code Extension via Workspace Path]
**Vulnerability:** The VS Code extension used `execSync` to execute CLI commands within the user's `workspaceDir`. Since `workspaceDir` is user-controlled, opening a maliciously named directory could execute arbitrary shell commands.
**Learning:** Workspace directory paths in extensions are untrusted user input. Using `execSync` with `cwd` or interpolating the path into the command string allows command injection via shell metacharacters.
**Prevention:** Always use `execFileSync` with array arguments to prevent shell interpolation. Resolve the absolute path to `.js`/`.mjs` entry points and execute them directly via the `node` binary to avoid unsafe `.cmd` wrapper execution on Windows. Catch `ENOENT` to fallback to `.cmd` only when executing npm binaries directly.
