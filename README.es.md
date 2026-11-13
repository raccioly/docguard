<!-- docguard:translation source=README.md lang=es reviewed=2026-10-10 -->
<!-- El README en inglés es la fuente canónica. Esta es una versión curada — los
     números y listas volátiles viven solo en el original para que nunca diverjan del código. -->

# 🛡️ DocGuard

[English](README.md) · [Português (BR)](README.pt-BR.md) · **Español**

> **La capa de enforcement para Spec-Driven Development.**
> Valida. Puntúa. Garantiza. Entrega documentación que los agentes de IA realmente pueden usar.

[![CI](https://github.com/raccioly/docguard/actions/workflows/ci.yml/badge.svg)](https://github.com/raccioly/docguard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/docguard-cli)](https://www.npmjs.com/package/docguard-cli)
[![PyPI](https://img.shields.io/pypi/v/docguard-cli)](https://pypi.org/project/docguard-cli/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

> **✨ Mira lo que DocGuard detecta en 30 segundos — sin instalar nada:**
> ```bash
> npx docguard-cli demo
> ```

## ¿Qué es DocGuard?

DocGuard es la herramienta de enforcement del **Canonical-Driven Development (CDD)**:
una metodología donde la documentación es la fuente de la verdad y la herramienta
**verifica, de forma determinista, que siga siendo verdad respecto al código**.

La diferencia frente a otras herramientas de documentación: un resultado verde de
DocGuard significa *"los documentos coinciden con el código, de forma verificable"* —
no solo "los archivos existen". Extrae rutas, esquemas, variables de entorno, conteos
y afirmaciones documentadas, y los compara contra el código real. Núcleo sin llamadas
a LLM: determinista, offline, auditable.

## Inicio rápido

```bash
# en el directorio de tu proyecto
npx docguard-cli init       # crea los documentos canónicos (detecta tu stack)
npx docguard-cli guard      # valida — verde significa "docs correctos"
npx docguard-cli score      # nota de madurez de la documentación (0-100)
```

> **El modo estricto es el predeterminado.** `docguard guard` termina con código 4 cuando una verificación que aplica a tu proyecto no examinó nada (por ejemplo, no hay referencia de API aunque existan rutas) y muestra qué añadir. Una verificación que no aplica se omite, y un formato que DocGuard no lee solo se informa, sin hacer fallar la ejecución. ¿Actualizaste y el build se puso rojo? Lee [Actualizar al modo estricto](https://raccioly.github.io/docguard/upgrading-to-strict) (en inglés). Para mantener el comportamiento anterior, define `"enforcement": "standard"` en `.docguard.json`.

Para un proyecto existente, el camino inverso funciona mejor:

```bash
npx docguard-cli generate --plan --write   # ingeniería inversa: docs desde el código
```

## Los 5 comandos del día a día

| Comando | Qué hace |
|:--------|:---------|
| `init`  | Inicializa el proyecto (detecta el stack automáticamente) |
| `guard` | Valida los documentos contra el código — la puerta de CI |
| `diff`  | Muestra las brechas entre docs y código (`--since <ref>` para impacto de PR) |
| `sync`  | Regenera las secciones de "verdad del código" en los documentos |
| `score` | Nota de madurez CDD, con desglose por categoría |

La lista completa de comandos, validadores y flags está en el
[README en inglés](README.md#usage) — el propio DocGuard la mantiene
sincronizada con el código.

## Integración con IA (nativa, no improvisada)

DocGuard está diseñado para ser usado **por** agentes de IA, no solo por humanos:

- **Servidor MCP** — `claude mcp add docguard -- npx docguard-cli mcp` expone
  guard/score/explain/verify/diagnose como herramientas nativas para Claude,
  Cursor y cualquier cliente MCP.
- **Contrato JSON estable** — `guard --format json` con códigos de hallazgo
  estables, explicables (`docguard explain <CÓDIGO>`) y suprimibles en línea.
- **SARIF** — `guard --format sarif` se integra con GitHub Code Scanning.
- **llms.txt / llms-full.txt / context pack** — superficies de contexto para
  LLMs que leen el repositorio.
- **GitHub Action** — anotaciones inline en el diff del PR + comentario fijo
  con el impacto en los documentos canónicos.
- **`agents --sync`** — AGENTS.md se convierte en la fuente canónica de
  CLAUDE.md, las reglas de Cursor, las instrucciones de Copilot y demás — sin
  duplicación manual, sin drift.

Guía completa: [docs/ai-integration.md](docs/ai-integration.md) (en inglés).

## Documentación en otro idioma

DocGuard lee documentación escrita en cualquier idioma, pero algunas etiquetas que busca solo se reconocen en inglés. El soporte para otros idiomas se sigue en la [issue #644](https://github.com/raccioly/docguard/issues/644).

**Funciona hoy.** Texto en cualquier idioma, con tildes y acentos, e ids de requisito como `FR-001` dentro de frases en cualquier idioma.

**Por ahora debe quedar en inglés.** Escribe estas etiquetas exactamente como aparecen y deja todo lo demás en tu idioma:

- **Títulos de los documentos canónicos** (sin distinguir mayúsculas de minúsculas; se acepta una numeración de sección al principio): `ARCHITECTURE.md` exige `## System Overview`, `## Component Map` y `## Tech Stack`; `DATA-MODEL.md` exige `## Entities`; `SECURITY.md` exige `## Authentication` y `## Secrets Management`; `TEST-SPEC.md` exige `## Test Categories` y `## Coverage Rules`; `ENVIRONMENT.md` exige `## Environment Variables` y `## Setup Steps`. Un perfil de proyecto puede añadir más títulos obligatorios.
- **Nombres de las secciones de Spec Kit**: el `spec.md` necesita títulos que contengan `User Scenarios`, `Requirements` y `Success Criteria`, además de ids como `FR-001` y `SC-001`; el `plan.md` necesita `Summary`, `Technical Context` y `Project Structure`; el `tasks.md` necesita un título del estilo `Phase 1` e ids como `T001`.
- **Marcador del changelog**: el `CHANGELOG.md` debe contener `[Unreleased]`.
- **Estado del registro de decisión**: la primera palabra de `**Status:**` debe ser `Proposed`, `Accepted`, `Rejected`, `Deprecated` o `Superseded` (también valen `Approved`, `Draft`, `Proposal`, `Obsolete` y `Replaced`).

Una sección obligatoria que no aplica a tu proyecto puede marcarse con `<!-- docguard:section <slug> n/a — motivo -->`, donde `<slug>` es el título en inglés, en minúsculas y con guiones (por ejemplo `system-overview`). El motivo debe empezar con una letra o un dígito de `A-Z`, `a-z` o `0-9`.

**Ignora los números de calidad del texto.** La voz pasiva, la negación, la carga condicional y el resto de métricas parecidas usan listas de palabras en inglés; en documentos de otro idioma sus valores no significan nada hasta que DocGuard pueda avisarlo por sí mismo.

## Documentación

Las guías completas están en inglés, en
**[raccioly.github.io/docguard](https://raccioly.github.io/docguard/)**:

| Si quieres | Guía |
|:-----------|:-----|
| Instalar con npm, PyPI, Homebrew, Docker, GitHub Action o Spec Kit | [Installation](https://raccioly.github.io/docguard/installation.html) |
| Adoptar DocGuard en un repositorio que ya tiene código | [Existing Projects](https://raccioly.github.io/docguard/guides/existing-projects.html) |
| Usarlo con GitHub Spec Kit | [Spec Kit](https://raccioly.github.io/docguard/guides/spec-kit.html) |
| Bloquear pull requests en CI | [Continuous Integration](https://raccioly.github.io/docguard/guides/ci.html) |
| Saber qué lenguajes y frameworks lee | [Languages and Frameworks](https://raccioly.github.io/docguard/reference/languages.html) |
| Conectar tu agente de código | [Coding Agents](https://raccioly.github.io/docguard/reference/agents.html) |
| Entender un código de hallazgo | [Finding Codes](https://raccioly.github.io/docguard/reference/findings.html) |
| Resolver un problema | [Troubleshooting](https://raccioly.github.io/docguard/guides/troubleshooting.html) |

## Instalación permanente

```bash
npm install -g docguard-cli    # Node.js 18+
# o vía Python:
pip install docguard-cli       # wrapper de PyPI (requiere Node.js 18+)
```

## Comunidad

- [Discusiones](https://github.com/raccioly/docguard/discussions) — preguntas e ideas
- [Issues](https://github.com/raccioly/docguard/issues) — bugs y peticiones de features
- [CHANGELOG](CHANGELOG.md) — historial completo de versiones
- [Cómo contribuir](CONTRIBUTING.md)

---

**Licencia MIT** · Hecho para equipos que tratan la documentación como un contrato, no como un adorno.
