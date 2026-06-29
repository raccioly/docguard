## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.
## 2024-05-24 - Pre-compile RegExp in nested loops
**Learning:** Instantiating `new RegExp()` inside nested array methods like `.filter` and `.some` creates a severe O(N*M) performance bottleneck, especially when matching two large lists (e.g., documented tests vs. actual test files).
**Action:** Always pre-compile regular expressions and derived strings into an array of "matcher" objects outside of the loop before iterating, which shifts the instantiation cost from O(N*M) to O(N).
## 2024-06-29 - [Pre-computing String Operations]
**Learning:** Performing operations like `basename()` inside nested loops created an O(N*M) redundant string processing bottleneck, similar to `new RegExp()`. When comparing an array of matchers against an array of file paths, resolving the `basename()` of each path on every iteration wastes CPU cycles.
**Action:** Pre-compute string operations (like `basename()`) on the array of file paths outside of the nested loops, and use a single-pass Set comparison to keep track of matched items, turning the operation into an O(N+M) structure and heavily reducing string allocations.
