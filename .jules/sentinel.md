## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.
## 2025-05-18 - [Command Injection via execSync in VS Code Extension]
**Vulnerability:** The VS Code extension used `execSync` with the `workspaceDir` path concatenated into the command string, which is vulnerable to command injection if the workspace directory contains shell metacharacters.
**Learning:** Treat workspace directory paths as untrusted user input that can contain shell metacharacters or spaces, requiring `execFileSync` with array arguments to prevent command injection and RCE vulnerabilities.
**Prevention:** Always use `execFileSync` (or `execFile` for async) with array arguments instead of `execSync` when executing commands with dynamic inputs like workspace directories in extensions. Ensure `.cmd` wrappers are utilized for npm binaries on Windows.
## 2025-05-18 - [String Parsing for Argument Arrays]
**Learning:** When mitigating command injection by converting `execSync` with strings to `execFileSync` with argument arrays, naive `String.prototype.split(' ')` is insufficient and breaks paths with spaces. Use a regular expression or library that correctly respects quotes when parsing command strings into argument arrays.
