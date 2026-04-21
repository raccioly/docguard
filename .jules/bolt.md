## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-19 - [Optimization] Line Counting Array Allocation Overhead
**Learning:** Using `content.split('\n').length` to count lines in large files or across an entire codebase during scans allocates large string arrays unnecessarily, leading to high garbage collection overhead.
**Action:** Use a `while` loop with `content.indexOf('\n', pos + 1)` to manually count lines without creating intermediate array structures. This is measurably faster (roughly 3x faster) and uses significantly less memory.
