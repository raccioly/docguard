# Contract: Trace Matrix Export

## CSV (`docguard trace --matrix --format csv`)

The header row, in this exact order:

```text
requirement,requirement_fp,spec_state,file,anchor,scope,tier,confidence,link_state,suspect_side,code_fp,reviewed_revision,reviewed_date,test_file,test_line,test_status
```

- **Rows.** There is one row per (link, test reference). A link with no test
  reference has one row with empty test columns. A requirement with no link
  has one row with empty anchor columns and `link_state` set to `missing`.
- **Order.** Rows sort by requirement, then file, anchor and test file, using
  byte order on UTF-8.
- **Quoting.** RFC 4180. A cell that starts with `=`, `+`, `-` or `@` gets a
  `'` prefix to defuse spreadsheet formula injection.
- **Line endings.** `\n`, with a trailing newline.

## ReqIF 1.2 (`--format reqif`)

- **Root.** `REQ-IF` in the namespace `http://www.omg.org/spec/ReqIF/20110401/reqif.xsd`,
  with a `THE-HEADER` that carries `CREATION-TIME` (a fixed epoch unless
  `--timestamp` is passed, for determinism) and `TITLE` "DocGuard trace
  matrix".
- **Datatypes.** `DATATYPE-DEFINITION-STRING`, with `MAX-LENGTH=10000`.
- **Spec object types.** `Requirement` (attributes: ID, fingerprint, spec
  state), `Anchor` (file, anchor, scope, tier, state, fingerprint) and `Test`
  (file, line, status).
- **Spec relation types.** `implements` (Anchor → Requirement) and `verifies`
  (Test → Requirement).
- **Identifiers.** `_` followed by the first 16 hex digits of sha1(key). They
  are stable across runs.
- **Ordering and escaping.** Objects and relations appear in the same sort
  order as the CSV. XML special characters are escaped.

A `--output <path>` write goes through `safeWrite`. Without it, the export
goes to stdout.
