## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2025-05-20 - [Optimization]
**Learning:** Avoid redundant `statSync` calls during directory traversal. Using `readdirSync(dir, { withFileTypes: true })` provides directory entry objects that have `.isDirectory()` and `.isFile()` methods directly, avoiding the need for an expensive filesystem call for every entry.
**Action:** Always use `withFileTypes: true` when reading directories if we need to know the entry type, rather than calling `statSync` separately.
