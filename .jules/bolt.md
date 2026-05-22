## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.
## 2024-05-22 - Pre-compute Array allocations outside loops
**Learning:** In `cli/commands/diff.mjs`, performing Set-to-Array spreading `[...mySet]` inside nested O(N) operations like `.filter()` causes severe O(N*M) allocation bottlenecks because the Array is recreated every iteration.
**Action:** Always pre-compute Sets to Arrays `const myArr = [...mySet]` before entering loop constructs when they are read-only and frequently accessed for subset/containment checks.
