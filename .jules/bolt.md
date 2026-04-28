## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-19 - [Performance Optimization]
**Learning:** Calling `.toLowerCase()` repeatedly in a nested loop across a large list of documents inside `checkUntrackedTodos` created an O(N*M) performance bottleneck, causing large time spikes when `validateTodoTracking` evaluated many TODOs.
**Action:** Precompute expensive operations like `.toLowerCase()` during the initial document loading phase and store the result on the document object, reducing O(N*M) recomputations to O(1) attribute lookups per loop iteration.
