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
  "caveat": "Benchmark precision on a deliberately balanced corpus of 15 defect and 15 clean-control cases across 15 repository groups and 15 causal families. This is DocGuard's precision on labelled cases, not the probability that a finding in your repository is real; quote every ratio with its n and Wilson 95% bound.",
  "minN": 5,
  "source": {
    "manifestDigest": "sha256:3476ca6ca0e23373aa4c4697dbae1ffa8516271073655944774b62435e323f5f",
    "toolVersion": "0.47.0",
    "toolRevision": "354e3d63421ed79eae8d761400bfbb3946945bfa",
    "detectorsDigest": "sha256:02ad4b5f158ddaa46370071b0b2e044a9986aa03515955563ddc5a348b5380b0",
    "reviewStatus": "reviewed",
    "reviewedAt": "2026-11-12",
    "reviewer": "DocGuard maintainers",
    "limitations": "Finite scoped cases do not establish exhaustive documentation or detector correctness. Seven of the tool’s finding codes are measured here; the rest carry no benchmark evidence. ARC001 is measured by a single defect/control pair in one repository group, so its point estimate is below the reporting floor and it backs off to the whole-corpus tier."
  },
  "aggregate": {
    "cases": 30,
    "repositoryGroups": 15,
    "causalFamilies": 15,
    "truePositives": 15,
    "falsePositives": 0,
    "falseNegatives": 0,
    "cleanControls": 15,
    "cleanControlsWithFindings": 0,
    "precisionDenominator": 15,
    "precision": 1,
    "precisionInterval": [
      0.796111,
      1
    ],
    "recall": 1,
    "recallInterval": [
      0.796111,
      1
    ],
    "quotable": true,
    "notQuotableReason": null
  },
  "adjudicated": {
    "policyDisagreements": 0,
    "ambiguous": 0
  },
  "byValidator": {
    "architecture": {
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
    "pathScopedRules": {
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
      "notQuotableReason": "Only 2 labelled finding(s) behind this rate; DocGuard does not quote a point estimate below 5."
    },
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
    "ARC001": {
      "status": "measured",
      "validators": [
        "architecture"
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
        "cases": 30,
        "repositoryGroups": 15,
        "causalFamilies": 15,
        "truePositives": 15,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 15,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 15,
        "precision": 1,
        "precisionInterval": [
          0.796111,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.796111,
          1
        ],
        "quotable": true,
        "notQuotableReason": null
      },
      "adjudicated": {
        "policyDisagreements": 0,
        "ambiguous": 0
      }
    },
    "PSR005": {
      "status": "measured",
      "validators": [
        "pathScopedRules"
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
        "tier": "aggregate",
        "key": "all-measured-codes",
        "cases": 30,
        "repositoryGroups": 15,
        "causalFamilies": 15,
        "truePositives": 15,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 15,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 15,
        "precision": 1,
        "precisionInterval": [
          0.796111,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.796111,
          1
        ],
        "quotable": true,
        "notQuotableReason": null
      },
      "adjudicated": {
        "policyDisagreements": 0,
        "ambiguous": 0
      }
    },
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
      },
      "adjudicated": {
        "policyDisagreements": 0,
        "ambiguous": 0
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
      },
      "adjudicated": {
        "policyDisagreements": 0,
        "ambiguous": 0
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
      },
      "adjudicated": {
        "policyDisagreements": 0,
        "ambiguous": 0
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
      "backoff": null,
      "adjudicated": {
        "policyDisagreements": 0,
        "ambiguous": 0
      }
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
        "cases": 30,
        "repositoryGroups": 15,
        "causalFamilies": 15,
        "truePositives": 15,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 15,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 15,
        "precision": 1,
        "precisionInterval": [
          0.796111,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.796111,
          1
        ],
        "quotable": true,
        "notQuotableReason": null
      },
      "adjudicated": {
        "policyDisagreements": 0,
        "ambiguous": 0
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
        "cases": 30,
        "repositoryGroups": 15,
        "causalFamilies": 15,
        "truePositives": 15,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 15,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 15,
        "precision": 1,
        "precisionInterval": [
          0.796111,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.796111,
          1
        ],
        "quotable": true,
        "notQuotableReason": null
      },
      "adjudicated": {
        "policyDisagreements": 0,
        "ambiguous": 0
      }
    }
  }
});
