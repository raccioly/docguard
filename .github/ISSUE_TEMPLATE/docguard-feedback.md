---
name: DocGuard feedback (false positive / detection gap)
about: Report a finding DocGuard got wrong, or a check it should make. Usually opened pre-filled by `docguard feedback`.
title: "[feedback] <CODE> (<validator>): <short message>"
labels: docguard-feedback
---

<!--
Most of this is filled in automatically when you run `docguard feedback`.
No source code or secret values are included — only a finding code, a basename,
a line number, and DocGuard's own redacted context.
-->

- **DocGuard version:**
- **Finding code:** <!-- e.g. SEC001 -->
- **Validator:**
- **Location (basename:line):**
- **Confidence:** <!-- high | low -->

**What DocGuard flagged**

<!-- The redacted context from `docguard feedback`. -->

**Why it's wrong (or what it missed)**

<!-- One or two lines: this is UI copy, a runner var, a dynamic-import cycle break, etc. -->
