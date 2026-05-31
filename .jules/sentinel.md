## 2025-05-18 - [Command Injection via execSync]
**Vulnerability:** Found multiple instances where user-controlled inputs (`projectDir`, `filePath`) were interpolated directly into shell commands via `execSync` (e.g., `execSync(\`node "\${cliPath}" init --dir "\${projectDir}"\`)`).
**Learning:** This is a classic command injection vulnerability. If `projectDir` contains shell metacharacters like `;`, `&&`, or `||`, it allows arbitrary command execution.
**Prevention:** Always use `execFileSync` (or `execFile` for async) instead of `execSync` when executing commands with dynamic inputs. Pass arguments as an array to ensure they are passed directly to the executable without shell interpolation.

## 2025-05-18 - [Command Injection via execSync in freshness validator]
**Vulnerability:** Found `execSync` used with dynamically constructed shell pipes like `git log --since="${isoDate}" ... | wc -l` and `| grep -c "DRIFT:"`. If `isoDate` could be manipulated by an attacker, they could achieve remote code execution.
**Learning:** `execSync` with pipes inherently uses a shell which introduces injection risk if inputs are mishandled. Mitigation means avoiding the shell entirely (`execFileSync`) and parsing text programmatically instead.
**Prevention:** Avoid passing raw string payloads to `execSync` especially with pipes `|` or boolean operators like `&&`, `||`. Convert pipeline commands into JavaScript logic, such as using `String.prototype.split('\n').length` instead of `wc -l` and `String.prototype.match()` instead of `grep`, and invoke commands via `execFileSync` supplying an array of arguments.
