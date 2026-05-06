## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [Optimization]
**Learning:** Caching regex compilation for repeated calls in `cli/shared-ignore.mjs` significantly speeds up file traversal across validators by avoiding redundant string replacements and RegExp object creations for identical ignore patterns.
**Action:** Implement cache in `cli/shared-ignore.mjs` to memoize compiled filters.
