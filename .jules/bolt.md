## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [Regex Compilation Overhead]
**Learning:** The `buildIgnoreFilter` in `cli/shared-ignore.mjs` was causing performance bottlenecks due to redundant regex compilation during recursive directory scans, as it re-evaluated the same global config patterns repeatedly.
**Action:** Implemented an internal `filterCache` using a `Map` and `JSON.stringify(patterns)` as the cache key to prevent repetitive regex compilation.
