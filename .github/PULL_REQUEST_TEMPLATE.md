# Pull Request

## What & why

<!-- One or two sentences: what changes, and what problem it solves. -->

## CDD checklist (this repo guards itself)

- [ ] `npx docguard-cli guard` passes locally (`--changed-only` for quick runs)
- [ ] `npm test` passes (`node --test tests/*.test.mjs`)
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`
- [ ] Canonical docs updated if behavior changed (`docs-canonical/` — or a
      `// DRIFT: reason` comment + `DRIFT-LOG.md` entry if the deviation is intentional)
- [ ] New validator findings carry a stable code registered in `cli/findings.mjs`
      (see CONTRIBUTING — findings rule)
- [ ] Counts in prose (commands, validators) untouched or re-verified — guard's
      `canonical-sync` will catch drift, but fixing it before CI is kinder

## Screenshots / output

<!-- For CLI-visible changes: paste the relevant before/after terminal output. -->
