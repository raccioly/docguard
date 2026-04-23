## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-19 - [Memory-efficient Line Counting]
**Learning:** Found an anti-pattern in `cli/commands/generate.mjs` where `content.split('\n').length` was used to count lines for entire codebases. This caused significant memory allocations and garbage collection overhead because it instantiated an array containing every single line of every single file.
**Action:** Replace `content.split('\n').length` with a memory-efficient `while` loop utilizing `String.prototype.indexOf('\n')` to iterate and count newlines without creating intermediate arrays.
