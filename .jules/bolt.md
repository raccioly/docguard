## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.
## 2025-05-18 - [Optimization]
**Learning:** Found an N*M complexity bottleneck where `.toLowerCase()` was repeatedly calculated in an inner loop comparing todos against tracking content docs in `cli/validators/todo-tracking.mjs`.
**Action:** Precompute expensive string operations like `.toLowerCase()` outside inner loops during initial file loads or in outer loops.
