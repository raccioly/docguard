# Implementation Plan: SPK010 Directory Claims

**Branch**: `fix/spk010-directory-mentions` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

`detectUntouchedClaims` (`cli/scanners/speckit.mjs`) keeps its exact lookup for files. When the
claim resolves to an existing directory, it asks `touchedWithin(touched, dir)` instead: is any
touched path strictly under `dir/`? The touched set and the feature window are unchanged.

## Technical Context

**Language/Version**: JavaScript ES modules, Node.js ≥ 18
**Primary Dependencies**: none new
**Testing**: `node:test`; git fixtures with baseline → spec → implementation commits
**Project Type**: CLI

## Constitution Check

IX (honest assurance): this removes a false accusation without weakening the check. A
directory with no change inside is still reported. IV: the change stays inside the scanner.
Pass.

## Project Structure

```text
cli/scanners/speckit.mjs                 # touchedWithin, directory branch in detectUntouchedClaims
tests/spk010-directory-claims.test.mjs   # NEW
```
