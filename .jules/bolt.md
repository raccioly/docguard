## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.
## 2024-05-24 - Pre-compile RegExp in nested loops
**Learning:** Instantiating `new RegExp()` inside nested array methods like `.filter` and `.some` creates a severe O(N*M) performance bottleneck, especially when matching two large lists (e.g., documented tests vs. actual test files).
**Action:** Always pre-compile regular expressions and derived strings into an array of "matcher" objects outside of the loop before iterating, which shifts the instantiation cost from O(N*M) to O(N).
## 2024-05-24 - [Avoid Regex Instantiation in Loops]
**Learning:** Instantiating `new RegExp()` inside file traversal loops creates redundant memory allocations and compilation overhead. Attempting to reuse an existing regex object by simply setting `lastIndex = 0` on the original source object can unintentionally drop explicitly added flags (like `g` or `i`), causing infinite loops or incorrect matches.
**Action:** When reusing global regexes in loops to avoid O(N*M) bottlenecks, hoist the `new RegExp()` instantiation *outside* the loop explicitly, retaining all necessary flags, and then reset `.lastIndex = 0` on that new instance inside the loop before each `exec()` call.
