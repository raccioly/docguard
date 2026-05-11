## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.
## 2024-05-18 - [Optimization]
**Learning:** Recomputing `content.toLowerCase()` inside a nested O(N*M) loop creates a massive CPU performance bottleneck.
**Action:** Precompute expensive lowercase and map operations when generating sets that will be repetitively scanned, such as inside `loadTrackingDocs`.
