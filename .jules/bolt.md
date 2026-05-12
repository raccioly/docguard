## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-06-25 - Trace Command Redundant Regex Evaluations

**Learning:** When generating traceability matrices across multiple documents or rules, repeatedly filtering a large array of files (`projectFiles`) against a set of regular expressions (e.g., `pattern.glob.test(f)`) introduces a significant O(D * P * F) performance bottleneck (where D is documents, P is patterns per doc, and F is total files).

**Action:** Implement a cache (using a `Map` keyed by the regex/glob pattern) to store the result of the regex filter so that if multiple documents share the same source pattern, the regex evaluation over the entire file list is performed only once. Additionally, pre-filter specific subsets of files (like test files) before performing secondary proximity matches.
