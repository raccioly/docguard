## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.

## 2025-02-12 - Nested RegExp Instantiation in Test File Matching
**Learning:** In the `diffTests` functions (`cli/commands/diff.mjs` and `cli/validators/docs-diff.mjs`), test files from documentation are treated as glob patterns and compared against actual test files from disk. The naive implementation instantiated a `new RegExp(...)` directly inside the comparator callback `matches(docEntry, codeRel)`, which was executed O(N * M) times inside nested `.filter` and `.some` array loops, causing extreme CPU overhead when diffing hundreds of documented test specs against thousands of codebase tests.
**Action:** When performing nested loops over collections that involve regex comparisons based on collection elements, precompile the regexes into an intermediary array (or Map) keyed by the outer collection elements before entering the O(N * M) comparison bottleneck.
