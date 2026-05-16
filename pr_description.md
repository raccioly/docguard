🚨 **Severity:** CRITICAL

💡 **Vulnerability:**
A command injection vulnerability existed in `cli/commands/init.mjs` and `cli/ensure-skills.mjs`. The `detectAIAgent` function read configuration files (`init-options.json` or `.agent/`) to determine the active AI agent. This unvalidated input was then directly interpolated into a shell execution string via `execSync` (`specify init ... --ai ${detectedAgent}`). An attacker or a maliciously crafted `.specify/init-options.json` could execute arbitrary shell commands.

🎯 **Impact:**
If a user cloned a repository containing a maliciously crafted `.specify/init-options.json` (e.g., `{"ai": "hello; echo 'pwned'"}`) and ran DocGuard, the injected shell commands would be executed on their local machine with the privileges of the running Node process.

🔧 **Fix:**
Added strict regex input validation (`/^[a-zA-Z0-9-]+$/`) against the `detectedAgent` value immediately after it is extracted, throwing a clear error if malicious characters (like semicolons, pipes, or quotes) are detected before any shell interpolation occurs. Also documented the vector in `.jules/sentinel.md`.

✅ **Verification:**
1. Manually craft a malicious `.specify/init-options.json` with an injection payload like `; rm -rf /`.
2. Run `pnpm start init` or an auto-init trigger.
3. Verify the CLI throws `Error: Invalid AI agent identifier` instead of executing the payload.
4. Run `pnpm test` to ensure all tests continue to pass.
