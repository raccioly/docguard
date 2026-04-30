## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [Line Counting Optimization]
**Learning:** Found string counting via `content.split('\n').length` was allocating large arrays of strings and triggering heavy garbage collection in `countFilesAndLines` (cli/commands/generate.mjs), which became a bottleneck when running recursively over large projects.
**Action:** Replace `split('\n')` memory allocation with a `while` loop utilizing `String.prototype.indexOf('\n')` for significantly faster, allocation-free string parsing.
