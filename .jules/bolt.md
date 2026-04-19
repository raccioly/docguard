## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [Optimization] Counting Lines Efficiently
**Learning:** Using `String.prototype.split('\n').length` to count lines forces unnecessary array allocation, creating garbage collection overhead for large files.
**Action:** Use a `while` loop with `String.prototype.indexOf('\n')` to iterate through strings and count lines without allocating memory for an array.
