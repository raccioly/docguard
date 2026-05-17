## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-05-17 - Error State Background Colors
**Learning:** Adding a red background color (`statusBarItem.errorBackground`) directly to a VS Code status bar item on error state (like failed parsing or CLI execution) dramatically improves the visibility of failures compared to just updating the icon and text.
**Action:** When a critical error prevents an extension from functioning, map `statusBarItem.backgroundColor` to `new vscode.ThemeColor('statusBarItem.errorBackground')` along with the context-aware tooltip to guide the user.
