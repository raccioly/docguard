## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.

## 2026-05-26 - [Pre-compiling Regex in nested loops]
**Learning:** Instantiating `new RegExp()` inside nested `.filter` and `.some` array loops causes severe $O(N \times M)$ bottlenecks.
**Action:** Always pre-compile regular expressions and map the inputs to a struct or object before entering loop conditions to improve scalability.
