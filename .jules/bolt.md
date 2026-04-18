## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.
## 2024-05-18 - [Memory Allocation Optimization]
**Learning:** `content.split('\n').length` creates a very large array in memory just to count lines, which can be disastrous when scanning many files in a codebase, triggering heavy garbage collection. Using `content.indexOf('\n')` in a loop performs the same logic with practically 0 allocation overhead.
**Action:** Always count lines using an `indexOf('\n')` loop rather than `split('\n').length` inside file processing loops.
