## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2026-04-25 - [Line Counting Optimization]
**Learning:** `split('\n').length` allocates unnecessary string arrays just to count lines, which adds significant memory and processing overhead when scanning large codebases (e.g., in `generate.mjs`).
**Action:** Use a `while` loop with `indexOf('\n', pos)` instead to count lines efficiently without extra allocation.
