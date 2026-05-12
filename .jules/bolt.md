## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

2025-05-14 - Optimize service-to-test map generation
Learning: Repeated string operations like `.replace()` and inner loop searches with `.includes()` across large arrays (O(N*M)) create significant performance bottlenecks. Pre-calculating search terms and flipping the search order (iterating through the larger/main list and matching against a reduced set of remaining targets) can substantially reduce CPU time.
Action: Replaced O(N*M) `find` loop with a pre-calculation step and a more efficient matching strategy in `cli/commands/generate.mjs`.
