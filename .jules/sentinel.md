## 2024-04-11 - Command Injection in File Scanners
**Vulnerability:** Found `execSync` used with interpolated variables (`filePath`) in `cli/validators/doc-quality.mjs` and `cli/validators/freshness.mjs`. This creates a command injection risk if a maliciously named file is scanned.
**Learning:** Shell strings allow execution of arbitrary commands if inputs are not properly sanitized.
**Prevention:** Replaced `execSync` with `execFileSync` to pass arguments securely as an array, completely bypassing shell interpretation. Used `stdio: ['pipe', 'pipe', 'ignore']` to retain the behavior of `2>/dev/null` without needing a shell.
