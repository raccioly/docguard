## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.

## 2024-05-18 - [O(N*M) Array Spread Bottleneck]
**Learning:** Found that `[...set]` array spreading inside loops, such as `onlyInDocs: [...docRoutes].filter(r => ![...codeRoutes].some(cr => ...))`, scales poorly because it triggers a full O(N) copy allocation on every inner loop iteration. This causes O(N^2) memory allocations.
**Action:** Extract the spread logic into precomputed arrays above the loop mapping (e.g. `const codeRoutesArr = [...codeRoutes]`) to only instantiate the array once and significantly lower memory overhead during iterations.
