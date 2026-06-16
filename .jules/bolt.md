## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [O(N*M) String Overhead]
**Learning:** To prevent N^2 performance bottlenecks in nested loops (such as comparing a list of items against multiple documents), precomputing expensive operations like `.toLowerCase()` during the initial file load or mapping phase avoids redundant $O(N \times M)$ overhead.
**Action:** Precompute expensive string operations and property lookups (like `.toLowerCase()` and `.substring()`) outside of inner loops and during file load mapping phases to improve scaling.
## 2024-05-24 - Pre-compile RegExp in nested loops
**Learning:** Instantiating `new RegExp()` inside nested array methods like `.filter` and `.some` creates a severe O(N*M) performance bottleneck, especially when matching two large lists (e.g., documented tests vs. actual test files).
**Action:** Always pre-compile regular expressions and derived strings into an array of "matcher" objects outside of the loop before iterating, which shifts the instantiation cost from O(N*M) to O(N).
## 2024-05-24 - Pre-compile RegExp array iterations
**Learning:** Using `array.filter(a => !otherArray.some(b => match(a,b)))` creates an O(N*M) algorithmic bottleneck even if RegExp is precompiled. It causes redundant checks over elements that could have been skipped or marked as matched in a single pass.
**Action:** Replace nested `filter/some` lookups across two arrays with a single nested loop that iterates through both and populates `Set`s containing the matches. Then use those `Set`s to do O(1) filtering at the end.
