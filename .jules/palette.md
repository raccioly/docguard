## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.
## 2026-04-18 - Dynamic Accessibility Labels on VS Code Status Bar
**Learning:** For VS Code extension UI elements like `StatusBarItem`, dynamic properties (icon, text, backgroundColor) are typically mapped to informative tooltips. However, standard tooltips are visual. For screen readers, it's critical to dynamically set `accessibilityInformation` (with `label` and `role`) rather than relying on static text, providing context-aware spoken text (like spelling out scores or statuses) whenever the visual state changes.
**Action:** When creating or dynamically updating VS Code extension UI elements, explicitly update `accessibilityInformation.label` alongside visual changes to ensure screen readers receive equivalent, contextual feedback.
