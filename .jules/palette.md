## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-05-18 - Yielding Event Loop for Loading States
**Learning:** When updating UI elements like VS Code extension `statusBarItem` to show a loading state (e.g., adding a spinner and changing tooltip) immediately prior to a synchronous, blocking operation (like `execSync`), the changes won't render unless you explicitly yield the event loop.
**Action:** Use `await new Promise(r => setTimeout(r, 0))` right after the UI update to allow the editor time to render the visual changes before the main thread blocks.
## 2026-05-30 - Context-Aware Loading States in VS Code Extensions
**Learning:** Converting synchronous VS Code extension commands to `async` and displaying a status bar loading spinner (`$(sync~spin)`) before executing blocking operations significantly improves user feedback. Crucially, explicitly yielding the event loop via `await new Promise(r => setTimeout(r, 0))` is required for the UI to render the spinner before the main thread blocks. Providing context-aware tooltips (e.g., 'Running Fix checks...') instead of generic ones clarifies what background work is occurring.
**Action:** Always wrap blocking operations in async functions with visual loading states, explicitly yield the event loop before execution, and ensure the state is reliably cleared afterwards (e.g., in finally blocks or before early returns).
