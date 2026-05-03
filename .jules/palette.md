## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-05-03 - Status Bar Accessibility Details
**Learning:** Screen readers won't automatically read status bar items clearly if they rely heavily on icons or shorthand text like `$(verified) CDD: 95/100 (A)`. Without explicit `accessibilityInformation`, visually impaired developers miss important context about the extension's status and interactive capability.
**Action:** When creating or dynamically updating VS Code extension UI elements like `StatusBarItem`, explicitly set `accessibilityInformation` (with `label` and `role`) to provide clear, up-to-date spoken context, especially when the item relies on icons or shorthand text.
