# Glossary

<!-- One row per concept. Use is the term to write. Avoid lists other names for
the same concept, separated by commas; DocGuard reports them in prose (GLS001).
Code, links, quotes and the headings DocGuard requires are not checked. -->

| Use | Avoid | Meaning |
|---|---|---|
| guard | | The command that runs every validator and sets the exit code. |
| validator | | One check that reads the project and reports findings, for example Doc-Quality. |
| finding | | One result of a validator, with a stable code such as `GLS001`. |
| canonical document | | A document under `docs-canonical/`, or one that `docs.roles` maps, that states the design. |
| strict | | The default enforcement mode: a validator that applies and examined nothing fails the run. |
| Spec Kit | | GitHub's spec-driven workflow; DocGuard is one of its extensions. |
| glossary | | This file: one term for each concept, read by the Glossary validator. |
