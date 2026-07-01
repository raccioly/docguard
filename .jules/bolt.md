## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.
## 2024-05-24 - Pre-compile RegExp in nested loops
**Learning:** Instantiating `new RegExp()` inside nested array methods like `.filter` and `.some` creates a severe O(N*M) performance bottleneck, especially when matching two large lists (e.g., documented tests vs. actual test files).
**Action:** Always pre-compile regular expressions and derived strings into an array of "matcher" objects outside of the loop before iterating, which shifts the instantiation cost from O(N*M) to O(N).

## 2024-05-30 - [Avoid DRY violations in fast-paths]
**Learning:** Optimizing RegExp checks with hardcoded `.includes()` early-returns introduces severe DRY (Don't Repeat Yourself) violations and risks breaking functionality (e.g., case-sensitivity). If the regex criteria changes in the future, the hardcoded `.includes()` strings must be manually updated, creating a fragile codebase.
**Action:** Avoid hardcoding `.includes()` substring checks as fast-paths for RegExp. Instead, focus on architectural optimizations like pre-computing transformations outside of loops, pre-compiling RegExp objects, or caching results.
