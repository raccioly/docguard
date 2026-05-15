## 2024-05-12 - VS Code Status Bar Hover Experience
**Learning:** In the VS Code extension API, static text tooltips for status bar items do not provide clear context, and error states can inadvertently persist if background colors aren't explicitly reset.
**Action:** When updating status bar items, always bind dynamic properties like tooltips to the current state, and explicitly set `backgroundColor = undefined` when transitioning to an unknown state to prevent misleading error highlights.
