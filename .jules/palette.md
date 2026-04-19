## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2026-04-19 - Add accessibilityInformation to VS Code StatusBarItem
**Learning:** VS Code StatusBarItems using shorthand text or icons need explicit `accessibilityInformation` to provide clear spoken context for screen readers.
**Action:** Always set `accessibilityInformation` with a descriptive `label` and `role` when creating UI elements in VS Code extensions, and update it dynamically if the content changes.
