## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2025-01-24 - Optimize extractOpenAPIRelationships
**Learning:** Replacing an O(N) array search inside a nested loop with an O(1) Map lookup resolves the N+1 find problem in extractOpenAPIRelationships, significantly improving performance for large schema sets.
**Action:** Pre-index large arrays into Maps when performing lookups inside loops to avoid N^2 bottlenecks.
