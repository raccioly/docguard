## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.
## 2024-05-18 - [Avoid N*M String Checks with Array Precomputation]
**Learning:** Found O(N*M) array spreading bottleneck inside Set filtering loops (e.g. `[...mySet].filter(s => [...otherSet].some(...))`). Spreading a Set inside an iteration loop allocates a new array on every iteration, destroying performance.
**Action:** Always precompute Sets into Arrays outside of loops when performing cross-comparisons to achieve an O(1) allocation and avoid GC pauses.
