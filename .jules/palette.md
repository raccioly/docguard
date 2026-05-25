## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.
## 2024-11-13 - Yielding the Event Loop for VS Code UI Updates

**Learning:** When building VS Code extensions, updating `statusBarItem` properties (like adding a loading spinner or changing the background color) right before a synchronous block of code (like `execSync`) won't actually render if you don't yield the event loop. The UI thread gets blocked immediately. Furthermore, previously set styles (like `errorBackground`) can persist and incorrectly style the loading state.

**Action:** Before running heavy synchronous operations, set the desired UI state, explicitly reset previous styling states (e.g., `backgroundColor = undefined`), and await an event loop yield (`await new Promise(r => setTimeout(r, 0));`) so that VS Code can flush UI updates to the renderer. And always provide informative tooltips alongside error states rather than ambiguous question marks.
