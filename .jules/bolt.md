## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.
## 2024-05-02 - Optimize Line Counting for Large Codebases
**Learning:** In `cli/commands/generate.mjs`, counting the number of lines in files during the `countFilesAndLines` scan uses `content.split('\n').length`. This allocates an array of strings in memory just to get its length, which causes severe memory pressure and garbage collection overhead during deep scans of large codebases, leading to poor performance.
**Action:** Replace `content.split('\n').length` with a `while` loop that counts newlines using `content.indexOf('\n', position)`, eliminating unnecessary object allocations.
