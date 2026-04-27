## 2024-04-27 - Add accessibility context to VS Code status bar items
**Learning:** In the VS Code extension, `StatusBarItem` elements that rely primarily on icons or shorthand text (like "$(shield) CDD: ?") are completely opaque to screen readers unless explicit accessibility metadata is provided.
**Action:** When creating or updating a `StatusBarItem` dynamically, always set and update its `accessibilityInformation` (providing a clear `label` and `role`) to ensure screen reader users get the full, spoken context.
## 2024-04-27 - Add accessibility context to VS Code status bar items
**Learning:** In the VS Code extension, `StatusBarItem` elements that rely primarily on icons or shorthand text (like "$(shield) CDD: ?") are completely opaque to screen readers unless explicit accessibility metadata is provided.
**Action:** When creating or updating a `StatusBarItem` dynamically, always set and update its `accessibilityInformation` (providing a clear `label` and `role`) to ensure screen reader users get the full, spoken context.
