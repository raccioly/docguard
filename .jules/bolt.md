## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [Avoid N^2 string operations in nested loops]
**Learning:** Calling `.toLowerCase()` inside nested loops (like scanning N TODOs against M documents) introduces severe performance bottlenecks.
**Action:** Precompute expensive operations like `.toLowerCase()` during the initial file load/mapping phase and store the result on the document object.
