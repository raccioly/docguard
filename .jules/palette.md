## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-04-16 - Context-Aware Screen Reader Support for Status Bar
**Learning:** When creating or dynamically updating VS Code extension UI elements like `StatusBarItem`, explicitly set `accessibilityInformation` (with `label` and `role`) to provide clear, up-to-date spoken context for screen readers, especially when the item relies on icons or shorthand text like "$(shield) CDD: ?".
**Action:** Always provide explicit `accessibilityInformation` on status bar items and ensure it dynamically updates alongside visual states like tooltips and text.
