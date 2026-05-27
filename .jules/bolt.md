## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.

## 2024-05-18 - [Array.find in Nested Loops]
**Learning:** Found an O(N^2) algorithmic bottleneck in `cli/scanners/schemas.mjs` within `extractOpenAPIRelationships`, where `Array.find` was repeatedly executed inside nested schema and field loops, leading to excessive string lowercasing and object searching.
**Action:** Always precompute lookups (e.g., using a `Map`) before entering nested iterations to maintain O(1) retrieval times and avoid redundant execution of lookup algorithms.
