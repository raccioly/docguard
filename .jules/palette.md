## 2024-04-16 - Web UI Components Constraint
**Learning:** The docguard repository consists entirely of a Node.js CLI tool and a VS Code extension; it lacks web UI components (e.g., HTML, CSS, React, Vue), meaning traditional web-focused micro-UX enhancements do not apply.
**Action:** Do not attempt traditional web-based UX enhancements here. Focus on CLI paradigms or skip UX enhancement requests if web-centric.

## 2024-04-16 - Context-Aware Status Bar Tooltips
**Learning:** VS Code extension status bar items can display multiple forms of feedback, but static tooltips fail to explain state changes. Providing context-aware tooltip text (e.g., explaining why a threshold warning icon appears) greatly improves the usability for developers monitoring CLI outputs inline.
**Action:** Always map status bar dynamic properties (icon, text, backgroundColor) to corresponding informative tooltips that explain what the visual change means.

## 2024-04-16 - Reseting Visual State
**Learning:** When applying dynamic properties (like `backgroundColor`) to VS Code extension status bar items in an error state, those visual changes become sticky if the success path fails to explicitly reset them (e.g., to `undefined`). This can cause the interface to stay perpetually in a state that looks like an error even after it recovers.
**Action:** Always reset visual states explicitly in the success or initialization path of a state-updating UI function.
