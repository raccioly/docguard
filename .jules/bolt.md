## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.

## 2024-05-18 - [Avoid Redundant Array Allocations in Filters]
**Learning:** Found redundant array spreads `[...set]` inside `.filter()` callbacks. This results in N allocations of size M in an $O(N \times M)$ iteration bottleneck when comparing elements.
**Action:** Always precompute Sets into Array variables before entering `.filter()` or `.map()` loops when comparing multiple arrays.
