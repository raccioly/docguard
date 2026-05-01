## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.
## 2024-05-01 - Add accessibility info to Status Bar Item
**Learning:** When using VS Code `StatusBarItem` with shorthand icons and text, it lacks context for screen readers. Explicitly setting `accessibilityInformation` (with `label` and `role`) is crucial for providing clear spoken context.
**Action:** Always set `accessibilityInformation` when creating or dynamically updating VS Code extension UI elements like `StatusBarItem`, especially when the item relies on icons or shorthand text. Update it synchronously alongside `text` and `tooltip` changes.
