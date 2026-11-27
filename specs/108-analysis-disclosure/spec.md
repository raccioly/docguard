# Feature Specification: Config Secrets and Analysis Disclosure

**Feature Branch**: `fix/language-registry`

**Created**: 2026-11-27

**Status**: Active

**Spec ID**: `docguard.analysis-disclosure`

**Lineage**: Builds on `docguard.language-registry` (spec 107) and `docguard.field-report-fixes` (spec 106 FR-009, the value shapes). Closes issues 718 and 719, from the same field report as 711 to 717. The report's projects are not named here.

**Input**: "The secret scan never reads YAML, .properties or XML config (719). Each validator had its own extension list, and no output names the files that no check reads: SEC011 fires only when nothing was scanned, and `generate` writes confident zeros for a stack it has no analyzer for (718)."

## Problem

1. Spring, MuleSoft and .NET projects keep credentials in `application.yml`, `.properties`, `config/*.yaml`, `appsettings*.json`, Mule connector attributes and Salesforce Flow variables. The secret scan read none of them, and a project with one `.java` file got no SEC011 either.
2. Spec 107 put every language in one registry, but nothing tells a reader which recognized files no check reads: DataWeave, LWC templates, and the parts of Mule flow XML DocGuard does not analyze.
3. `generate` on a Mule API prints "0 components, 0 env vars, 0 tests" as if measured. Naming the MuleSoft framework would make API-Surface apply and examine nothing (the same trap as Salesforce DX in spec 107).

## User Scenarios & Testing

### User Story 1 - A committed credential in a config file is found (Priority: P1)

**Independent Test**: the Spring tree of issue 719: SEC001 at `application.yml:5` and `application.properties:1`, SEC003 at `application.yml:7` and `config/dev.yaml:2`; nothing for `${PARTNER_API_KEY}` or `${secure::partner.token}`.

**Acceptance Scenarios**:

1. **Given** a placeholder (`${VAR}`, `${VAR:}`, `${secure::k}`, `p('secure::k')`, `${{ secrets.X }}`, `{{ .Values.x }}`, `%env(X)%`, `<%= %>`, `{cipher}…`, `ENC(…)`, `vault:`, `!vault`, `$VAR`, empty, `null`, `~`), **Then** nothing is reported. A literal default in `${VAR:default}` is judged as a value.
2. **Given** a well-known default (`POSTGRES_PASSWORD: postgres`), a value shape from spec 106 (route, URL, name, label) or prose, **Then** a low-confidence warning names why.
3. **Given** a lockfile, a `*.example` file or `src/test/resources/`, **Then** no error: lockfiles and examples are not read, test resources are `context: test-path`.
4. **Given** `appsettings*.json`, Mule flow XML under `src/main/mule/` and a Salesforce Flow `<variables>` block, **Then** a credential key with a literal value is reported; `package.json` and `pom.xml` are not read by key.

### User Story 2 - What DocGuard did not read is said (Priority: P1)

**Independent Test**: the mixed Salesforce and Mule tree of issue 718: `unanalyzed` names DataWeave (`secrets`, `traceability` missing) and Mule flow XML (`traceability` missing); SEC012 counts the files the secret scan left out; the text output prints one line.

### User Story 3 - An unsupported stack is named, not measured (Priority: P2)

**Independent Test**: a pom with `mule-application` packaging: `generate` says MuleSoft has no DocGuard analyzer; API-Surface does not apply.

## Requirements

### Functional Requirements

- **FR-001**: The secret scan reads YAML, `.properties`/`.conf`, `appsettings*.json`, Mule flow XML and Salesforce Flow metadata by key, and shell scripts by the code pattern. A key is a credential when its last segment's words end in password, passwd, pwd, token, secret, or `key` after api, secret, private, signing, encryption or access. Placeholders are dropped; a literal default is judged; the value rules of `isSyntheticValue`, spec 106 FR-009 and `looksLikeProse` apply, plus a closed list of well-known defaults. Password keys need 8 characters, the others 16.
- **FR-002**: `guard --format json` carries `unanalyzed`: one entry per recognized language with files some check does not read: `{ language, name, files, missing, example }`. `missing` comes from each consumer's own predicate (the secret scan's `scansForSecrets`, the requirement scan's `readsRequirementTags`), so it cannot drift from the code. The compact form keeps `{ language, files }`. The text output prints one line. It is skipped on the lite path, never changes a finding or the exit code, and is not part of `checkCoverage.limitations`.
- **FR-003**: SEC012 (informational, `defaultLevel: info`) fires when the secret scan scanned at least one file and left out files in a recognized language; it counts them by language. SEC011 keeps its meaning (nothing scanned).
- **FR-004**: The registry recognizes DataWeave (`.dwl`), YAML and properties config, and, by path rule, Mule flow XML (`src/main/mule/**/*.xml`), Salesforce Flow (`*.flow-meta.xml`), LWC templates (`lwc/**/*.html`) and `appsettings*.json`. None of them joins `CODE_EXTENSIONS` or `LANGUAGE_NAMES`.
- **FR-005**: The project profile names MuleSoft (a pom with `mule-application` packaging). An ecosystem whose framework DocGuard reads no route of (`NO_ROUTE_READER`: Salesforce DX, MuleSoft) does not make API-Surface apply; `generate` says the stack has no DocGuard analyzer.
- **FR-006**: `schemas/docguard-guard-result.schema.json` describes `unanalyzed`.
- **FR-007**: Docs: `docs/configuration.md`, README, CHANGELOG with every changed code and the exit-code effect.
- **FR-008**: The `@req` tests cover each tree of issues 718 and 719.

## Success Criteria

- **SC-001**: The full suite passes by exit code.
- **SC-002**: A hermetic A/B against main on DocGuard and the local projects: every new SEC finding is reviewed by location (no value is printed), and every exit-code change is reported.

## Verification Notes

- **SC-001**: `npm test` by exit code on the final commit.
- **SC-002**: recorded after the A/B.
