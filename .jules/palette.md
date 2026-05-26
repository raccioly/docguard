## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-05-26 - UI Updates Before Synchronous Blocking Operations

**Learning:** When using VS Code's extension API, synchronous operations like `execSync` can block the main thread and prevent the UI from updating. For instance, setting a loading state (e.g., `$(sync~spin)`) immediately before calling `execSync` will not render the loading spinner to the user because the event loop does not get a chance to process the UI update before the thread is blocked. Furthermore, dynamic UI elements like `statusBarItem.backgroundColor` must be explicitly reset to `undefined` before new operations to clear stale states (such as an error background persisting into a loading or successful state).

**Action:** Always yield the event loop (e.g., `await new Promise(r => setTimeout(r, 0));`) immediately after triggering a UI update and before starting any synchronous, thread-blocking operation. Ensure all dynamically styled UI element properties (like `backgroundColor` and `tooltip`) are explicitly cleared or set to appropriate defaults at the start of a new operation or within catch blocks.
