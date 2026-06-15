## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.
## 2024-05-24 - Pre-compile RegExp in nested loops
**Learning:** Instantiating `new RegExp()` inside nested array methods like `.filter` and `.some` creates a severe O(N*M) performance bottleneck, especially when matching two large lists (e.g., documented tests vs. actual test files).
**Action:** Always pre-compile regular expressions and derived strings into an array of "matcher" objects outside of the loop before iterating, which shifts the instantiation cost from O(N*M) to O(N).
## 2024-05-24 - Pre-compute properties and track using Sets in nested array loops
**Learning:** Using multiple nested array methods (e.g. `.filter` containing `.some`) inside O(N*M) comparisons—combined with repetitive local object/string property extraction (like `basename()`) inside the inner loop—creates massive redundant overhead.
**Action:** When comparing two large arrays via patterns, map both arrays beforehand to pre-compute expensive string properties (like `basename`), and use a single double `for` loop to build `Set` tracking collections for matches rather than multiple array passes.
