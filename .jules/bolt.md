## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-12-05 - Optimize Service to Test Matching

**Learning:** The nested array `.find()` inside `generateTestSpec` to match services and tests causes an O(N*M) bottleneck, with redundant string replacements and array lookups across hundreds of potential files. Pre-calculating keys and applying a shrinking-array iteration technique dramatically speeds up matching without algorithmic overhead.
**Action:** When scanning lists of strings against other strings for substring matches, cache the search keys up-front, iterate through the targets once, and match backwards against a remaining set of sources to allow safe, early removals, reducing constant overhead.
