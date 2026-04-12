## 2024-05-18 - [Optimizing Regex and split performance]
**Learning:** Calling `content.split("\n")` on large files heavily allocates memory and triggers garbage collection overhead. Pre-screening the full content buffer using `.includes()` or `.test()` creates a massive speed boost by avoiding unnecessary string splitting and iteration.
**Action:** Always prefer fast early returns in loops parsing files, deferring expensive operations until actual hits are found.
