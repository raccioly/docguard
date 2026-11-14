/**
 * GENERATED FILE — do not edit.
 * Regenerate with: npm run generate:precision-evidence
 * Source: benchmarks/baseline.json (reviewed precision benchmark).
 *
 * Every ratio here is benchmark precision on labelled, deliberately balanced
 * cases. It is not the probability that a finding in a user's repository is
 * real, and a code absent from `byCode` has no benchmark evidence at all.
 *
 * @implements docguard.precision-evidence-loop#FR-019
 */

export const PRECISION_EVIDENCE = Object.freeze({
  "$schema": "https://raccioly.github.io/docguard/schemas/docguard-precision-evidence.schema.json",
  "schemaVersion": 1,
  "measures": "benchmark-precision",
  "caveat": "Benchmark precision on a deliberately balanced corpus of 19 defect and 19 clean-control cases across 19 repository groups and 19 causal families. This is DocGuard's precision on labelled cases, not the probability that a finding in your repository is real; quote every ratio with its n and Wilson 95% bound.",
  "minN": 5,
  "source": {
    "manifestDigest": "sha256:cbb3d005df07e3cf0803abdf475f7cde73b99d9b1c31dcd5304bdf3fb2aa6482",
    "toolVersion": "0.48.0",
    "toolRevision": "bc64786045b2111c8c4d73f90ecf66c78dde13c2",
    "detectorsDigest": "sha256:6fd91bd30e92f517dcf141520d1d0d96a9cd756fb75be21e8fe1765ef0351580",
    "reviewStatus": "reviewed",
    "reviewedAt": "2026-11-13",
    "reviewer": "DocGuard maintainers",
    "limitations": "Finite scoped cases do not establish exhaustive documentation or detector correctness. Thirteen of the tool’s finding codes are measured here; the rest carry no benchmark evidence. ARC001, PSR006, PSR007, PSR008, STR004 and STR008 are each measured by a single defect/control pair in one repository group, so each point estimate is below the reporting floor and backs off to the whole-corpus tier. PSR008 has no positive example in the 21 real repositories surveyed (no two root instruction files share more than 13% of their lines), so its pair measures the detector, not its rate on real files."
  },
  "aggregate": {
    "cases": 38,
    "repositoryGroups": 19,
    "causalFamilies": 19,
    "truePositives": 20,
    "falsePositives": 0,
    "falseNegatives": 0,
    "cleanControls": 19,
    "cleanControlsWithFindings": 0,
    "precisionDenominator": 20,
    "precision": 1,
    "precisionInterval": [
      0.83887,
      1
    ],
    "recall": 1,
    "recallInterval": [
      0.83887,
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
      "cases": 8,
      "repositoryGroups": 4,
      "causalFamilies": 4,
      "truePositives": 5,
      "falsePositives": 0,
      "falseNegatives": 0,
      "cleanControls": 4,
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
      "notQuotableReason": null
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
      "cases": 6,
      "repositoryGroups": 3,
      "causalFamilies": 3,
      "truePositives": 3,
      "falsePositives": 0,
      "falseNegatives": 0,
      "cleanControls": 3,
      "cleanControlsWithFindings": 0,
      "precisionDenominator": 3,
      "precision": 1,
      "precisionInterval": [
        0.438494,
        1
      ],
      "recall": 1,
      "recallInterval": [
        0.438494,
        1
      ],
      "quotable": false,
      "notQuotableReason": "Only 3 labelled finding(s) behind this rate; DocGuard does not quote a point estimate below 5."
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
        "cases": 38,
        "repositoryGroups": 19,
        "causalFamilies": 19,
        "truePositives": 20,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 19,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 20,
        "precision": 1,
        "precisionInterval": [
          0.83887,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.83887,
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
        "tier": "validator",
        "key": "pathScopedRules",
        "cases": 8,
        "repositoryGroups": 4,
        "causalFamilies": 4,
        "truePositives": 5,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 4,
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
        "notQuotableReason": null
      },
      "adjudicated": {
        "policyDisagreements": 0,
        "ambiguous": 0
      }
    },
    "PSR006": {
      "status": "measured",
      "validators": [
        "pathScopedRules"
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
        "key": "pathScopedRules",
        "cases": 8,
        "repositoryGroups": 4,
        "causalFamilies": 4,
        "truePositives": 5,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 4,
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
        "notQuotableReason": null
      },
      "adjudicated": {
        "policyDisagreements": 0,
        "ambiguous": 0
      }
    },
    "PSR007": {
      "status": "measured",
      "validators": [
        "pathScopedRules"
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
        "key": "pathScopedRules",
        "cases": 8,
        "repositoryGroups": 4,
        "causalFamilies": 4,
        "truePositives": 5,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 4,
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
        "notQuotableReason": null
      },
      "adjudicated": {
        "policyDisagreements": 0,
        "ambiguous": 0
      }
    },
    "PSR008": {
      "status": "measured",
      "validators": [
        "pathScopedRules"
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
        "key": "pathScopedRules",
        "cases": 8,
        "repositoryGroups": 4,
        "causalFamilies": 4,
        "truePositives": 5,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 4,
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
        "cases": 38,
        "repositoryGroups": 19,
        "causalFamilies": 19,
        "truePositives": 20,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 19,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 20,
        "precision": 1,
        "precisionInterval": [
          0.83887,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.83887,
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
    "STR004": {
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
        "cases": 38,
        "repositoryGroups": 19,
        "causalFamilies": 19,
        "truePositives": 20,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 19,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 20,
        "precision": 1,
        "precisionInterval": [
          0.83887,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.83887,
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
    "STR008": {
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
        "cases": 38,
        "repositoryGroups": 19,
        "causalFamilies": 19,
        "truePositives": 20,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 19,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 20,
        "precision": 1,
        "precisionInterval": [
          0.83887,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.83887,
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
        "cases": 38,
        "repositoryGroups": 19,
        "causalFamilies": 19,
        "truePositives": 20,
        "falsePositives": 0,
        "falseNegatives": 0,
        "cleanControls": 19,
        "cleanControlsWithFindings": 0,
        "precisionDenominator": 20,
        "precision": 1,
        "precisionInterval": [
          0.83887,
          1
        ],
        "recall": 1,
        "recallInterval": [
          0.83887,
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
