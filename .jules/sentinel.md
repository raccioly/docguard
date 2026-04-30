## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.
## 2025-05-18 - [Command Injection via execSync in VS Code Extension]
**Vulnerability:** Found `execSpecguard` in `vscode-extension/extension.js` using `execSync` with unsanitized inputs. When passing `cmd` with spaces like `"diagnose --fix"`, a simplistic array approach (`[cmd]`) fails because the CLI expects arguments to be split.
**Learning:** Fixing command injection involves both switching to `execFileSync` and correctly splitting argument strings. Blindly wrapping a space-separated command string in an array (e.g. `['diagnose --fix']`) treats it as a single invalid argument, causing regressions.
**Prevention:** Always `split(' ')` multi-word command arguments before passing to `execFileSync`, or better yet, refactor callers to natively pass arrays instead of concatenated strings.
