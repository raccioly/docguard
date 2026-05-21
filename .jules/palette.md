## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-05-21 - Status Bar Error State Persistence
**Learning:** When updating VS Code extension `statusBarItem` properties like `backgroundColor` to indicate an error or warning, they must be explicitly reset to `undefined` on success, otherwise stale visual states (like red/orange backgrounds) can persist even after the error is resolved. Furthermore, error states should use context-aware icons (like `$(error)` or `$(question)`) and map the error message into the `tooltip` so users understand why the status bar is angry.
**Action:** Always map dynamic visual properties (icons, tooltips, backgrounds) to appropriate context (error messages) and explicitly clear them during successful update cycles.
