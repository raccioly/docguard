## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-05-27 - Status Bar Error Visualization and Loading States
**Learning:** When using VS Code's status bar to display process status (e.g., executing `execSpecguard`), omitting a clear loading state or failing to yield the event loop prevents the UI from updating before the main thread blocks. Furthermore, error states must explicitly set tooltips and `errorBackground` colors to convey context, and these must be cleared before the next check to avoid stale error visuals.
**Action:** When adding or updating VS Code status bar items during blocking synchronous tasks, always explicitly show a loading spinner and yield the event loop (`await new Promise(r => setTimeout(r, 0))`). Ensure dynamic properties like `backgroundColor` and `tooltip` are both cleared at the beginning of an update cycle and explicitly set during error states to provide accessible, context-aware feedback.
