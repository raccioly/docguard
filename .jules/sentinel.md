## 2024-06-11 - Migrate execSync to execFileSync for command injection prevention
**Vulnerability:** Use of `execSync` with string concatenation for system commands allows command injection if input is unsanitized (e.g. `which ${name}`).
**Learning:** `execFileSync` without shell execution is immune to shell meta-character injection since it passes arguments directly to the executable. Also, shell piping (`| wc -l`) or redirection (`2>/dev/null`) requires native equivalent implementations like `stdio` arrays and array splitting.
**Prevention:** Strictly forbid `execSync` strings for system commands; always use `execFileSync(executable, [args], { stdio })` array-based execution.
