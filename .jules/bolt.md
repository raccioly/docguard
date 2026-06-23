## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.
## 2024-05-24 - Pre-compile RegExp in nested loops
**Learning:** Instantiating `new RegExp()` inside nested array methods like `.filter` and `.some` creates a severe O(N*M) performance bottleneck, especially when matching two large lists (e.g., documented tests vs. actual test files).
**Action:** Always pre-compile regular expressions and derived strings into an array of "matcher" objects outside of the loop before iterating, which shifts the instantiation cost from O(N*M) to O(N).
## 2024-05-24 - Pre-compute properties and use Sets instead of nested multi-pass arrays
**Learning:** Performing `basename()` calculations inside nested multi-pass array iterations (`.filter()` and `.some()`) generates substantial O(N*M) bottlenecks.
**Action:** When filtering two lists against each other using comparisons that require calculations (like regex matching or `basename`), pre-compute the target properties for all items, and cross-reference them in a single double `for`-loop utilizing `Set`s to track matches, drastically reducing iterations and redundant string operations.
