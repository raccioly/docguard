## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.

## 2024-05-18 - [O(N*M) Array Spreading Bottleneck]
**Learning:** In \`cli/commands/diff.mjs\`, using the spread syntax \`[...mySet]\` inside an iterative \`filter()\` callback that itself contains a nested \`.some()\` loop causes severe O(N*M) array allocation overhead, drastically reducing execution speed (from ~3ms to ~18ms or more depending on scale).
**Action:** Precompute \`Set\`s into arrays immediately before the loop, and use the precomputed arrays in nested iterations instead of repeatedly spreading the \`Set\`.
