## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2026-04-27 - [Command Injection via execSync in VS Code Extension]
**Vulnerability:** The `execSpecguard` function in `vscode-extension/extension.js` used `execSync` and string-based command construction (e.g., `cmd = \"npx -y specguard ${args}\"`), which can lead to command injection if arguments are manipulated, and option injection.
**Learning:** Command construction with strings using `execSync` can lead to shell evaluation of user inputs and path exploits in a VSCode environment context where workspaces can contain untrusted code. Additionally, resolving binaries correctly across OSes (like `npx.cmd` on Windows) is essential for cross-platform compatibility when transitioning to `execFileSync`.
**Prevention:** Use `execFileSync` and pass argument lists as an array to avoid shell interpretation and bypass option injection. Resolve binaries and command wrappers securely based on the current platform.
