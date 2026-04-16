## 2026-04-16 - Defer String Splitting

**Learning:** When scanning large files in pure Node.js without streams, unconditionally splitting file contents via `content.split('\n')` introduces significant memory allocation and garbage collection overhead, especially when the target strings or regex patterns (e.g., secrets, TODOs) are rarely found.
**Action:** Use `String.prototype.includes()` or `RegExp.prototype.test()` as a fast, low-memory pre-flight check on the full file string. Only execute `content.split('\n')` if a match is found, thereby avoiding unnecessary array allocations on the happy path.
