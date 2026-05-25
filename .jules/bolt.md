## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.
## 2024-06-25 - Avoid O(N*M) algorithmic bottleneck from repeatedly instantiating RegExp
**Learning:** Instantiating `new RegExp()` inside nested loops like `.filter` and `.some` can cause a severe O(N*M) bottleneck, specifically when processing glob strings and basenames for a large array of files.
**Action:** Always pre-compile `new RegExp` matches and string processing into objects mapping raw and processed formats before entering any large loop processing strings or arrays.
