# Test Documentation & Enforcement — Research Notes

> **Date**: March 12, 2026  
> **Question**: Does anyone have a machine-enforceable test documentation standard?

---

## Existing Standards (Traditional)

### IEEE 829-2008 (Software Test Documentation)
- 8 document types: Test Plan, Test Design Spec, Test Case Spec, Test Procedure Spec, Test Item Transmittal, Test Log, Test Incident Report, Test Summary Report
- Superseded by ISO/IEC/IEEE 29119-3:2013
- **Problem**: These are WORD DOCUMENTS. Not machine-readable, not repo-native, not usable by AI agents.

### ISO/IEC/IEEE 29119-3:2013
- International standard for test documentation
- More detailed than IEEE 829
- **Same problem**: Designed for enterprise QA departments, not for repo-native AI-agent workflows.

---

## What Exists for AI Agent Testing

| Tool | What It Does | Test Doc Standard? |
|------|-------------|-------------------|
| Playwright | E2E browser testing | ❌ No doc standard |
| Cypress | E2E testing | ❌ No doc standard |
| Jest/Vitest | Unit testing | ❌ No doc standard |
| Pytest | Python testing | ❌ No doc standard |
| Evidently AI | ML model testing | ❌ No doc standard |
| Promptfoo | AI agent testing | ❌ No doc standard |

All testing frameworks define HOW to run tests. None define WHAT tests SHOULD EXIST.

---

## The Gap You Identified

**Nobody has a machine-readable, repo-native test specification standard that:**

1. **Declares what test categories should exist** (unit, integration, E2E, security, performance)
2. **Maps features to required tests** ("Feature X requires tests A, B, C")
3. **Enforces minimum coverage** ("All routes must have at least one E2E test")
4. **Validates test existence** ("Test file exists for every service file")
5. **Tracks test health** ("These 3 tests are flaky, these 2 are stale")

This is exactly what your `/tester` workflow already does — but as a human-readable audit, not a machine-enforceable standard.

---

## What a Test Spec Could Look Like (Brainstorm)

```markdown
# docs-canonical/TEST-SPEC.md

## Required Test Categories
- unit: Required for all service files
- integration: Required for all API routes  
- e2e: Required for all user-facing flows
- security: Required for auth and payment flows

## Coverage Rules
| Component | Minimum Coverage | Test Framework |
|-----------|-----------------|----------------|
| Services  | Unit tests for all exports | jest/vitest/pytest |
| Routes    | Integration test per endpoint | supertest/httpx |
| UI Flows  | E2E per user journey | playwright/cypress |

## Test-to-Feature Map
| Feature | Required Tests | Status |
|---------|---------------|--------|
| User login | auth.test.ts, login.e2e.ts | ✅ Both exist |
| Payment | payment.test.ts, checkout.e2e.ts | ❌ Missing e2e |
```

---

## Verdict

**This is a real gap.** Test frameworks tell you HOW to test. Test coverage tools tell you HOW MUCH is tested. **Nobody tells you WHAT SHOULD BE tested and validates that it is.**

Your project could define this as part of the canonical spec — a `TEST-SPEC.md` or similar that lives alongside `ARCHITECTURE.md` and `DATA-MODEL.md` in `docs-canonical/`.
