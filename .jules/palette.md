## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-04-16 - Synchronous Tasks and Error States in VS Code Extensions
**Learning:** When executing synchronous tasks (like `execSync`) in VS Code extensions, the event loop blocks, preventing UI updates like loading spinners (`$(sync~spin)`) from rendering if fired immediately prior. Furthermore, using generic `$(shield)` icons for error states fails to communicate to users that something went wrong.
**Action:** Always yield the event loop (e.g., `await new Promise(r => setTimeout(r, 0))`) after setting a loading state before a synchronous blocking call. Also, explicitly update the status bar with the `$(error)` icon, `errorBackground` color, and a context-aware error tooltip on exceptions.
