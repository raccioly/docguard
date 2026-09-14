# Research: Evidence-Scoped Verification

## Decision

DocGuard will add an opt-in `.docguard-evidence.json` manifest. Each declaration
binds one stable claim ID, one Markdown target, one file-based source adapter,
and one exact predicate. Evaluation is local, bounded, deterministic, and
read-only. The initial adapters are JSON Pointer, repository collection count,
saved oasdiff JSON, and saved Buf JSON Lines.

The command will report exactly one state per declaration:
`verified-within-scope`, `contradicted`, `stale`, `inconclusive`, or
`unsupported`. A clean result applies only to the declared document fragment,
source, predicate, and captured snapshot.

## Findings

### Standard addressing is safer than custom object paths

RFC 6901 defines JSON Pointer as a standards-track syntax for selecting a value
inside a JSON document. It also makes unresolved pointers explicit errors and
defines the required `~0` and `~1` decoding order. DocGuard should implement
that small contract directly instead of adding JSONPath semantics or a package.

Source: [RFC 6901 — JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901.html)

### Schema validation should constrain structure, not imply truth

JSON Schema describes document structure and assertion keywords such as `enum`
and `const`; it does not establish that an external source or prose assertion is
factually correct. DocGuard will publish a strict schema for editor support and
also enforce cardinality, path safety, and semantic combinations in its loader.

Source: [JSON Schema 2020-12 Core](https://json-schema.org/draft/2020-12/json-schema-core)

### oasdiff already owns OpenAPI change semantics

oasdiff's `breaking` and `changelog` commands provide JSON output, and `oasdiff
schema` publishes the schema for that output. oasdiff also distinguishes definite
errors from potential warnings. DocGuard should consume a saved report and link
its outcome to documentation; it should not recreate OpenAPI compatibility rules
or silently choose severity policy.

Source: [oasdiff breaking changes and output formats](https://github.com/oasdiff/oasdiff/blob/main/docs/BREAKING-CHANGES.md)

### Buf already owns Protobuf compatibility semantics

`buf breaking` compares current schema against an explicit baseline. Its JSON
error format emits one object per violation with path, source location, rule
type, and message. Rule categories and plugin policy remain Buf concerns.
DocGuard should parse saved JSON Lines, require declared input hashes, and link a
no-violation result to the exact prose that claims compatibility.

Source: [Buf breaking usage and JSON output](https://buf.build/docs/breaking/usage/)

### Saved reports need invalidation evidence

A report can be syntactically valid while describing older inputs. External
adapter declarations must therefore include the producer version, command mode,
and SHA-256 for every current repository input. Any digest mismatch is `stale`,
not a contradiction and never a pass. The report itself is hashed in output so a
later mutation changes the evidence identity.

## Rejected alternatives

| Alternative | Reason rejected |
|---|---|
| Let an LLM judge every claim | Useful for undeclared prose, but nondeterministic and unsuitable as a CI proof. |
| Execute oasdiff or Buf from DocGuard | Adds installation, network, command, and version-policy concerns; upstream tools already own those semantics. |
| Embed expected values in the manifest | Duplicates the source of truth. A document template captures the displayed value and compares it directly with the source. |
| Accept arbitrary regex or JSONPath | Expands ambiguity and denial-of-service risk. One literal Markdown template slot and RFC 6901 are sufficient for the first bounded claim types. |
| Exempt an entire document from freshness when one claim verifies | Would hide unrelated stale prose. Verification scope remains the selected statement inside the selected heading. |
| Treat missing evidence as clean | Creates false assurance. Missing or ambiguous targets are inconclusive; unknown report shapes are unsupported. |

## Security and operational limits

- Every path is repository-relative, rejects `.local`, `.env*`, traversal,
  backslashes, NUL, and symlinks, and uses bounded nonblocking reads.
- External report adapters never invoke a binary or fetch a baseline.
- Markdown matching ignores fenced code and requires one unique statement in
  the declared heading.
- `no-findings` verifies only that the saved upstream report has no findings
  under its declared command and input hashes. It does not prove runtime
  compatibility or deployment correctness.
- Manifest validation rejects duplicate IDs and unknown fields so typos cannot
  silently disable evidence.
