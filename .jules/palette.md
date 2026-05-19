## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.
## 2024-05-19 - VS Code Extension Status Bar State Management
**Learning:** In VS Code extensions, `statusBarItem` properties like `backgroundColor` and `tooltip` persist their state across updates. If an error state sets a warning or error background, a subsequent update that only sets `.text` will leave the stale background in place, confusing users. Furthermore, omitting tooltips in error states leaves users without context on how to resolve the issue.
**Action:** Always explicitly set or reset dynamic properties (`text`, `tooltip`, `backgroundColor`) during every state update cycle (success, warning, error) to provide accurate, context-aware feedback and prevent stale visual states.
