## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.

## 2024-05-18 - [Array Splitting in Loops Anti-Pattern]
**Learning:** Found array spread syntax (`[...collection]`) being repeatedly called inside `.filter` and `.some` loops (e.g. `cli/commands/diff.mjs`). This triggers excessive garbage collection and an O(N*M) allocation overhead during large diff operations.
**Action:** Avoid re-spreading Sets or Arrays inside loops. Precompute the arrays or Sets before the loop, or use `Set.prototype.has()` directly where possible to keep complexity to O(N).
