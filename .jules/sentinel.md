## 2024-05-24 - Command Injection via File Path in execSync
**Vulnerability:** Command injection was possible in `cli/validators/freshness.mjs` and `cli/validators/doc-quality.mjs` because user-controlled file paths were passed unescaped directly into a string concatenated for `execSync`.
**Learning:** Even internal CLI tools processing local repository files can be vulnerable to command injection if filenames or directory structures contain shell characters or are crafted maliciously.
**Prevention:** Always use `execFileSync` instead of `execSync` when dealing with external inputs, file paths, or complex parameters. Pass the command arguments as a distinct array and emulate shell behaviors (like `2>/dev/null`) natively using `stdio: ['pipe', 'pipe', 'ignore']`.
