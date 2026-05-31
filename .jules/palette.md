## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-05-18 - Yielding Event Loop for Loading States
**Learning:** When updating UI elements like VS Code extension `statusBarItem` to show a loading state (e.g., adding a spinner and changing tooltip) immediately prior to a synchronous, blocking operation (like `execSync`), the changes won't render unless you explicitly yield the event loop.
**Action:** Use `await new Promise(r => setTimeout(r, 0))` right after the UI update to allow the editor time to render the visual changes before the main thread blocks.
## 2024-05-31 - VS Code Synchronous Command Loading States
**Learning:** When executing blocking child processes (`execFileSync`) in a VS Code extension, UI updates like status bar spinners won't render unless you explicitly yield the event loop before the execution.
**Action:** Always add `await new Promise(r => setTimeout(r, 0))` after updating UI states and before blocking the thread.
