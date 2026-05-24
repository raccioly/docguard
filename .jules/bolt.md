## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.

## 2024-05-18 - [Regex Compilation in Nested Loops]
**Learning:** Instantiating `new RegExp()` inside a nested array iteration loop (`.filter` containing a `.some`) creates a severe O(N*M) algorithmic bottleneck.
**Action:** Pre-compile regular expressions and map any string operations outside of the nested loop by mapping the initial array into an array of objects containing the compiled RegExps, then strictly use those objects in the loop.
