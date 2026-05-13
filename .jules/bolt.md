## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.

## 2025-05-20 - [Optimization]
**Learning:** Found Array.find inside a nested loop in extractOpenAPIRelationships in cli/scanners/schemas.mjs caused an O(N^2) algorithmic bottleneck.
**Action:** Replace nested array search with an O(1) Map lookup (pre-indexing schema names), resolving an N+1 find bottleneck. Measured improvement from ~720ms to ~10ms for 5000 schemas.
