## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.
## 2024-05-18 - [Optimization - Memory Allocation]
**Learning:** Found that counting lines with `content.split('\n').length` in a file read block causes unnecessary array allocation and GC overhead for large files.
**Action:** Use a `while` loop with `String.prototype.indexOf('\n')` to count lines instead to optimize memory and speed when scanning large files.
