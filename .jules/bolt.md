## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.
## 2024-05-18 - [Optimization]
**Learning:** Found N*M performance bottleneck in checkUntrackedTodos where document content was lowercased repeatedly within a nested loop.
**Action:** Precompute expensive operations like `.toLowerCase()` during the initial file load and store it on the document object.
