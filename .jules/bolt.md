## 2024-05-18 - [Optimization]
**Learning:** Found string.includes early return could speed up checkUntrackedTodos in cli/validators/todo-tracking.mjs.
**Action:** Implement fast early return with includes check before doing expensive splitting or matching.

## 2024-05-18 - [Optimization] Avoid statSync during directory traversal
**Learning:** Calling `statSync` in a loop over directory entries causes significant synchronous I/O overhead. Node's `readdirSync` has an option `{ withFileTypes: true }` which returns `fs.Dirent` objects that already include `isDirectory()` and `isFile()` methods. Combining this with checking `.docguardignore` paths at the directory level allows for massive performance improvements by avoiding disk I/O and ignoring entire branches early.
**Action:** Use `readdirSync(dir, { withFileTypes: true })` instead of `readdirSync(dir)` + `statSync` across recursive file scanners in Node.js.
