## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2025-05-01 - [Optimization: Avoid Redundant Operations in Nested Loops]
**Learning:** Found N^2 performance bottlenecks in nested loops (such as comparing a list of TODOs against multiple tracking documents). Calling expensive string operations like `.toLowerCase()` inside these loops drastically reduces performance.
**Action:** Precompute expensive operations during the initial file load or mapping phase and store the result (e.g. `contentLower` on the document object) to avoid recalculating the same value repetitively.
