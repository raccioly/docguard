## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-19 - [N^2 Bottleneck in nested loops]
**Learning:** Recomputing `.toLowerCase()` in nested loops against multiple documents creates an N^2 performance bottleneck during TODO tracking validation.
**Action:** Precompute expensive operations like `.toLowerCase()` during initial file load and store the result on the document object.
