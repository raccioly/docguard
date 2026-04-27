## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-19 - [Optimization Anti-Pattern]
**Learning:** Replacing a combined regex `.test()` check with multiple hardcoded `String.prototype.includes()` checks as an early return was rejected because it breaks case-insensitivity and dynamic keywords, and doesn't actually offer performance gains over V8's native regex evaluation. Manual `.split('\n')` replacements using `while` loops that push substrings into an array fail to provide memory savings and sacrifice readability.
**Action:** Optimize string allocations by using `indexOf('\n')` to iterate without array allocation. Precompute expensive operations like `.toLowerCase()` outside of nested loops to solve N^2 bottlenecks. Combine arrays of regular expressions into a single regex with alternation `(?:a|b)` to minimize matching overhead.
