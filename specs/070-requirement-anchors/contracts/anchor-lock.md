# Contract: `.docguard-anchor-lock.jsonl`

## Layout

```text
{"kind":"docguard-anchor-lock","schemaVersion":1}
{"anchor":"applyDiscount","bulk":false,"code":"dg1:sha256:…","date":"2026-10-12","file":"src/pricing.mjs","floor":"dg1:sha256:…","key":"acme.billing#FR-003|src/pricing.mjs|applyDiscount|symbol","prev":{"code":"dg1:sha256:…","floor":"dg1:sha256:…","req":"dg1:sha256:…"},"reason":"rounding fix keeps FR-003","req":"dg1:sha256:…","requirement":"acme.billing#FR-003","revision":"1a2b…","scope":"symbol","state":"reviewed","tier":"babel@7"}
{"bulk":true,"date":"2026-10-11","file":"cli/x.mjs","key":"disposition|cli/x.mjs|helper","kind":"infrastructure","reason":"logging helper, no requirement","revision":"…"}
```

## Rules

1. **Header.** Line 1 is exactly the header object. Any other `kind`, or an
   unsupported `schemaVersion`, produces ANC005 (error), and nothing reads as
   current.
2. **Entries.** Each other non-empty line is one JSON object with sorted keys.
   Blank lines are ignored, and so are lines that are exactly the header,
   because a union merge can duplicate it.
3. **Writing.** The writer emits the header, then entries sorted by `key`, then
   a trailing newline.
4. **Reading.** The reader accepts any order.
5. **Duplicate keys.**
   - Identical duplicates collapse into one.
   - Differing duplicates produce ANC009. The link is then compared as if it
     had no entry, and is reported as suspect.
   - The next accept rewrites the key, which resolves the conflict.
6. **Validation.** Every entry is checked against
   `schemas/docguard-anchor-lock.schema.json`. A malformed line produces
   ANC005 with the line number.
7. **Git attributes.** The lock merges correctly only when `.gitattributes`
   declares `.docguard-anchor-lock.jsonl merge=union`.
   - When the line is missing, `anchors` shows it.
   - `anchors accept --gitattributes` adds it. DocGuard never edits
     `.gitattributes` without that flag.
   - CODEOWNERS should list the lock (FR-025).
8. **Keys.** Parts are joined by `|`. Any `|` or `%` inside a part is
   percent-encoded (`%7C`, `%25`).
9. **Retention.** The lock records only the latest accept per key. Earlier
   accepts live in git history: `git log -p -- .docguard-anchor-lock.jsonl`.
   This gives an uncapped audit trail without growing the file.
