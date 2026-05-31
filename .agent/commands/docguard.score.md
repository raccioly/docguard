---
description: CDD maturity score with ROI-based improvement roadmap — shows category breakdown, grade progression, and highest-impact fixes
handoffs:
  - label: Fix Top Issues
    agent: docguard.fix
    prompt: Fix the highest-ROI documentation issues to improve score
  - label: Full Review
    agent: docguard.review
    prompt: Perform deep semantic analysis for accuracy verification
  - label: Run Guard
    agent: docguard.guard
    prompt: Verify current guard status after improvements
---

# DocGuard Score — CDD Maturity Assessment

Calculate and display the project's Canonical-Driven Development maturity score with ROI-based improvement roadmap.

## What to do

1. **Run the scoring engine**:
```bash
npx docguard-cli score
```

2. **For JSON output** (CI/CD integration):
```bash
npx docguard-cli score --format json
```

3. **Interpret the grade**:

   | Grade | Score | Meaning |
   |-------|:-----:|---------|
   | A+ | 95-100 | Exemplary — production-grade documentation |
   | A | 85-94 | Strong — minor improvements possible |
   | B | 70-84 | Good — some gaps to address |
   | C | 50-69 | Fair — significant documentation debt |
   | D | 30-49 | Poor — major gaps in documentation |
   | F | 0-29 | Critical — documentation infrastructure missing |

4. **Analyze category breakdown** (sorted by weight):

   | Category | Weight | What It Measures |
   |----------|:------:|-----------------|
   | Structure | 25% | Required CDD files exist |
   | Doc Quality | 20% | Readability, sections, IEEE 830 compliance |
   | Testing | 15% | Test documentation coverage |
   | Security | 10% | Security docs, secrets handling |
   | Environment | 10% | Environment and setup docs |
   | Drift | 10% | Code deviation tracking |
   | Changelog | 5% | Change log maintenance |
   | Architecture | 5% | Architecture documentation |

5. **Build an ROI-ranked improvement roadmap**:
   - Calculate `Potential Gain = weight - current points` for each category
   - Sort by `Potential Gain / Effort` ratio
   - Show: "If you fix [X], score will increase from [Y] to [Z]"
   - Show the **minimum set of fixes** to reach the next grade level

6. **Track progress**: Compare current score against previous runs to show improvement.
