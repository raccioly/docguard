# Contract: Trace Matrix Export

## CSV (`docguard trace --matrix --format csv`)

The header row, in this exact order:

```text
requirement,requirement_fp,spec_state,file,anchor,scope,tier,confidence,link_state,suspect_side,code_fp,reviewed_revision,reviewed_date,test_file,test_line,test_status
```

- **Rows.** There is one row per (link, test reference). A link with no test
  reference has one row with empty test columns. A requirement with no link
  has `link_state` set to `missing` and empty anchor columns: one row per
  test that cites it, or a single row with empty test columns. Lost links (a
  reviewed link whose tag is gone) are rows with `link_state: lost`.
- **`test_status`.** `linked`, or, for a link whose code changed, the test
  chain's `needs-reverification`, `re-verified` or `inconclusive`.
- **`anchor`.** Empty for a file-scope link.
- **Order.** Rows sort by requirement, then file, anchor and test file, using
  byte order on UTF-8.
- **Quoting.** RFC 4180. A cell that starts with `=`, `+`, `-`, `@`, a tab or
  a carriage return gets a `'` prefix to defuse spreadsheet formula injection.
- **Line endings.** `\n`, with a trailing newline.

## ReqIF 1.2 (`--format reqif`)

- **Root.** `REQ-IF` in the namespace `http://www.omg.org/spec/ReqIF/20110401/reqif.xsd`,
  with a `THE-HEADER` that carries `CREATION-TIME` and `TITLE` "DocGuard
  trace matrix". The creation time and every `LAST-CHANGE` are the epoch,
  always, so the file changes only when the matrix does.
- **Datatypes.** `DATATYPE-DEFINITION-STRING`, with `MAX-LENGTH=10000`.
- **Spec object types.** `Requirement` (attributes: ID, fingerprint, spec
  state), `Anchor` (file, anchor, scope, tier, state, fingerprint) and `Test`
  (file, line, status).
- **Spec relation types.** `implements` (Anchor → Requirement) and `verifies`
  (Test → Requirement).
- **Identifiers.** `_` followed by the first 16 hex digits of sha1(key). They
  are stable across runs.
- **Ordering and escaping.** Objects and relations appear in the same sort
  order as the CSV. XML special characters are escaped, and characters XML
  1.0 cannot carry are dropped. A test cited by several links of one
  requirement is one object, with its most cautious status.
- **Sections.** `REQ-IF-CONTENT` holds `DATATYPES`, `SPEC-TYPES`,
  `SPEC-OBJECTS`, `SPEC-RELATIONS` and `SPECIFICATIONS`, in that order. A
  relation lists `TARGET`, `SOURCE`, `TYPE`, and the specification's
  hierarchy lists every requirement.

`--out <path>` (or `--output`, the same flag `report` uses) writes through
`safeWrite`, which backs up an existing file. Without it, the export is the
whole of stdout, with no banner. `--format json` gives `{ columns, rows }`;
`--spec <id>` keeps one spec's requirements.
