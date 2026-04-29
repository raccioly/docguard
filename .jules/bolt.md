## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.
## 2024-05-18 - [Optimization]
**Learning:** O(N^2) performance bottleneck observed in `cli/validators/todo-tracking.mjs` due to nested iterations invoking `.toLowerCase()` and string processing.
**Action:** Precompute computationally expensive operations like `.toLowerCase()` on document load or hoist them out of the inner loop to optimize comparison checks across lists.
