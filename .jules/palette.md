## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-05-06 - Status Bar Background Color Persistence
**Learning:** In the VS Code extension API, if a status bar item is assigned a background color (e.g., `statusBarItem.warningBackground` or `statusBarItem.errorBackground`) during an error/warning state, that color persists across state changes unless explicitly reset. When transitioning back to a default or unknown state, the background color must be explicitly set to `undefined`.
**Action:** Always set `statusBarItem.backgroundColor = undefined` when transitioning a status bar item to a normal or default state to avoid lingering warning/error colors from previous states.
