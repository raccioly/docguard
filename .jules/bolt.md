## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [Optimization]
**Learning:** Found N*M performance bottleneck in `cli/validators/todo-tracking.mjs` where `doc.content.toLowerCase()` was called repeatedly inside a nested loop for every TODO item checked against every document.
**Action:** Precompute expensive operations like `.toLowerCase()` during the initial file load/mapping phase and store the result on the document object to avoid N^2 processing overhead.
