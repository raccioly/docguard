/**
 * GENERATED FILE — do not edit.
 * Regenerate with: npm run generate:precision-evidence
 * Source: benchmarks/baseline.json (reviewed precision benchmark).
 *
 * Every ratio here is benchmark precision on labelled, deliberately balanced
 * cases. It is not the probability that a finding in a user's repository is
 * real, and a code absent from `byCode` has no benchmark evidence at all.
 */

export const PRECISION_EVIDENCE = Object.freeze({
  "$schema": "https://raccioly.github.io/docguard/schemas/docguard-precision-evidence.schema.json",
  "schemaVersion": 1,
  "measures": "benchmark-precision",
  "caveat": "Benchmark precision on a deliberately balanced corpus of 12 defect and 12 clean-control cases across 12 repository groups and 12 causal families. This is DocGuard's precision on labelled cases, not the probability that a finding in your repository is real; quote every ratio with its n and Wilson 95% bound.",
  "minN": 5,
  "source": {
    "manifestDigest": "sha256:8290564a2b4a7217052393ccd932ee58d0847500190d1b5ba8275051237b9ed0",
    "toolVersion": "0.41.7",
    "toolRevision": "e5d192e5f396be06455814ac692df2f4f461859a",
    "reviewStatus": "reviewed",
    "reviewedAt": "2026-09-18",
    "reviewer": "DocGuard maintainers",
    "limitations": "Finite scoped cases do not establish exhaustive documentation or detector correctness. Seven of the tool’s finding codes are measured here; the rest carry no benchmark evidence."
  },
  "aggregate": {
    "cases": 24,
    "repositoryGroups": 12,
    "causalFamilies": 12,
    "truePositives": 12,
    "falsePositives": 0,
    "falseNegatives": 0,
    "cleanControls": 12,
    "cleanControlsWithFindings": 0,
    "precisionDenominator": 12,
    "precision": 1,
    "precisionInterval": [
      0.757499,
      1
    ],
    "recall": 1,
    "recallInterval": [
      0.757499,
      1
    ],
    "quotable": true,
    "notQuotableReason": null
  },
  "byValidator": {
    "security": {
      "cases": 20,
      "repositoryGroups": 10,
      "causalFamilies": 10,
      "truePositives": 10,
      "falsePositives": 0,
      "falseNegatives": 0,
      "cleanControls": 10,
      "cleanControlsWithFindings": 0,
      "precisionDenominator": 10,
      "precision": 1,
      "precisionInterval": [
        0.72246,
        1
      ],
      "recall": 1,
      "recallInterval": [
        0.72246,
        1
      ],
      "quotable": true,
      "notQuotableReason": null
    },
    "structure": {
      "cases": 2,
      "repositoryGroups": 1,
      "causalFamilies": 1,
      "truePositives": 1,
      "falsePositives": 0,
      "falseNegatives": 0,
      "cleanControls": 1,
      "cleanControlsWithFindings": 0,
      "precisionDenominator": 1,
      "precision": 1,
      "precisionInterval": [
        0.206543,
        1
      ],
      "recall": 1,
      "recallInterval": [
        0.206543,
        1
      ],
      "quotable": false,
      "notQuotableReason": "Only 1 labelled finding(s) behind this rate; DocGuard does not quote a point estimate below 5."
    },
    "todoTracking": {
      "cases": 2,
      "repositoryGroups": 1,
      "causalFamilies": 1,
      "truePositives": 1,
      "falsePositives": 0,
      "falseNegatives": 0,
      "cleanControls": 1,
      "cleanControlsWithFindings": 0,
      "precisionDenominator": 1,
      "precision": 1,
      "precisionInterval": [
        0.206543,
        1
      ],
      "recall": 1,
      "recallInterval": [
        0.206543,
        1
      ],
      "quotable": false,
      "notQuotableReason": "Only 1 labelled finding(s) behind this rate; DocGuard does not quote a point estimate below 5."
    }
  },
  "byCode": {
    "SEC001": {
      "status": "measured",
      "validators": [
        "security"
      ],
      "cases": 4,
      "repositoryGroups": 2,
      "causalFamilies": 2,
      "truePositives": 2,
      "falsePositives": 0,
      "falseNegatives": 0,
      "cleanControls": 2,
      "cleanControlsWithFindings": 0,
      "precisionDenominator": 2,
      "precision": 1,
      "precisionInterval": [
        0.342372,
        1
      ],
      "recall": 1,
      "recallInterval": [
        0.342372,
        1
      ],
      "quotable": false,
      "notQuotableReason": "Only 2 labelled finding(s) behind this rate; DocGuard does not quote a point estimate below 5.",
      "backoff": {
        "tier": "validator",
        "key": "security",
        "cases": 20,
        "repositoryGroups": 10,
        "causalFamilies": 10,
        "truePositives": 10,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 10,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 10,
        "precision": 1,
        "precisionInterval": [
          0.72246,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.72246,
          1
        ],
        "quotable": true,
        "notQuotableReason": null
      }
    },
    "SEC002": {
      "status": "measured",
      "validators": [
        "security"
      ],
      "cases": 4,
      "repositoryGroups": 2,
      "causalFamilies": 2,
      "truePositives": 2,
      "falsePositives": 0,
      "falseNegatives": 0,
      "cleanControls": 2,
      "cleanControlsWithFindings": 0,
      "precisionDenominator": 2,
      "precision": 1,
      "precisionInterval": [
        0.342372,
        1
      ],
      "recall": 1,
      "recallInterval": [
        0.342372,
        1
      ],
      "quotable": false,
      "notQuotableReason": "Only 2 labelled finding(s) behind this rate; DocGuard does not quote a point estimate below 5.",
      "backoff": {
        "tier": "validator",
        "key": "security",
        "cases": 20,
        "repositoryGroups": 10,
        "causalFamilies": 10,
        "truePositives": 10,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 10,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 10,
        "precision": 1,
        "precisionInterval": [
          0.72246,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.72246,
          1
        ],
        "quotable": true,
        "notQuotableReason": null
      }
    },
    "SEC003": {
      "status": "measured",
      "validators": [
        "security"
      ],
      "cases": 2,
      "repositoryGroups": 1,
      "causalFamilies": 1,
      "truePositives": 1,
      "falsePositives": 0,
      "falseNegatives": 0,
      "cleanControls": 1,
      "cleanControlsWithFindings": 0,
      "precisionDenominator": 1,
      "precision": 1,
      "precisionInterval": [
        0.206543,
        1
      ],
      "recall": 1,
      "recallInterval": [
        0.206543,
        1
      ],
      "quotable": false,
      "notQuotableReason": "Only 1 labelled finding(s) behind this rate; DocGuard does not quote a point estimate below 5.",
      "backoff": {
        "tier": "validator",
        "key": "security",
        "cases": 20,
        "repositoryGroups": 10,
        "causalFamilies": 10,
        "truePositives": 10,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 10,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 10,
        "precision": 1,
        "precisionInterval": [
          0.72246,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.72246,
          1
        ],
        "quotable": true,
        "notQuotableReason": null
      }
    },
    "SEC005": {
      "status": "measured",
      "validators": [
        "security"
      ],
      "cases": 10,
      "repositoryGroups": 5,
      "causalFamilies": 5,
      "truePositives": 5,
      "falsePositives": 0,
      "falseNegatives": 0,
      "cleanControls": 5,
      "cleanControlsWithFindings": 0,
      "precisionDenominator": 5,
      "precision": 1,
      "precisionInterval": [
        0.565509,
        1
      ],
      "recall": 1,
      "recallInterval": [
        0.565509,
        1
      ],
      "quotable": true,
      "notQuotableReason": null,
      "backoff": null
    },
    "STR001": {
      "status": "measured",
      "validators": [
        "structure"
      ],
      "cases": 2,
      "repositoryGroups": 1,
      "causalFamilies": 1,
      "truePositives": 1,
      "falsePositives": 0,
      "falseNegatives": 0,
      "cleanControls": 1,
      "cleanControlsWithFindings": 0,
      "precisionDenominator": 1,
      "precision": 1,
      "precisionInterval": [
        0.206543,
        1
      ],
      "recall": 1,
      "recallInterval": [
        0.206543,
        1
      ],
      "quotable": false,
      "notQuotableReason": "Only 1 labelled finding(s) behind this rate; DocGuard does not quote a point estimate below 5.",
      "backoff": {
        "tier": "aggregate",
        "key": "all-measured-codes",
        "cases": 24,
        "repositoryGroups": 12,
        "causalFamilies": 12,
        "truePositives": 12,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 12,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 12,
        "precision": 1,
        "precisionInterval": [
          0.757499,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.757499,
          1
        ],
        "quotable": true,
        "notQuotableReason": null
      }
    },
    "TDO002": {
      "status": "measured",
      "validators": [
        "todoTracking"
      ],
      "cases": 2,
      "repositoryGroups": 1,
      "causalFamilies": 1,
      "truePositives": 1,
      "falsePositives": 0,
      "falseNegatives": 0,
      "cleanControls": 1,
      "cleanControlsWithFindings": 0,
      "precisionDenominator": 1,
      "precision": 1,
      "precisionInterval": [
        0.206543,
        1
      ],
      "recall": 1,
      "recallInterval": [
        0.206543,
        1
      ],
      "quotable": false,
      "notQuotableReason": "Only 1 labelled finding(s) behind this rate; DocGuard does not quote a point estimate below 5.",
      "backoff": {
        "tier": "aggregate",
        "key": "all-measured-codes",
        "cases": 24,
        "repositoryGroups": 12,
        "causalFamilies": 12,
        "truePositives": 12,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 12,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 12,
        "precision": 1,
        "precisionInterval": [
          0.757499,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.757499,
          1
        ],
        "quotable": true,
        "notQuotableReason": null
      }
    }
  }
});
