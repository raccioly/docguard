## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-05-04 - Map VS Code Status Bar Item Dynamic Properties to Tooltips
**Learning:** When creating or updating VS Code extension status bar items, relying solely on static text during error states or missing states hides valuable contextual information from developers.
**Action:** Always map dynamic properties like `icon`, `text`, and `backgroundColor` to corresponding informative `tooltip` properties so developers receive clear, context-aware feedback (e.g., specific error messages when CDD parsing fails).
