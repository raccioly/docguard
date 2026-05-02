## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.
## 2024-05-02 - VS Code Status Bar Screen Reader Accessibility
**Learning:** VS Code `StatusBarItem` elements without explicit `accessibilityInformation` are often read poorly by screen readers, particularly when they rely heavily on visual icons (like `$(shield)`) or shorthand text (like `CDD: 85/100 (B)`). Screen readers might read literal icon identifiers or omit contextual meaning.
**Action:** Always set `accessibilityInformation` (with descriptive `label` and appropriate `role`, e.g., 'button') when creating or dynamically updating a VS Code `StatusBarItem` to ensure robust screen reader support. This should be updated in sync with any visual text/tooltip changes.
