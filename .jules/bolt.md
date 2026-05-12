## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [Prevent N^2 Bottlenecks in Nested Loops]
**Learning:** Calling `.toLowerCase()` inside a nested loop (e.g., comparing multiple TODOs against multiple documents) creates an N^2 performance bottleneck.
**Action:** Precompute expensive string operations like `.toLowerCase()` during the initial file load/mapping phase and store the result on the document object.
