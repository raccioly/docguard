<!-- docguard:translation source=README.md lang=pt-BR reviewed=2026-10-10 -->
<!-- O README em inglês é a fonte canônica. Esta é uma versão curada — números
     e listas voláteis ficam apenas no original para nunca divergirem do código. -->

# 🛡️ DocGuard

[English](README.md) · **Português (BR)** · [Español](README.es.md)

> **A camada de enforcement para Spec-Driven Development.**
> Valide. Pontue. Garanta. Entregue documentação que agentes de IA conseguem realmente usar.

[![CI](https://github.com/raccioly/docguard/actions/workflows/ci.yml/badge.svg)](https://github.com/raccioly/docguard/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/docguard-cli)](https://www.npmjs.com/package/docguard-cli)
[![PyPI](https://img.shields.io/pypi/v/docguard-cli)](https://pypi.org/project/docguard-cli/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

> **✨ Veja o que o DocGuard detecta em 30 segundos — sem instalar nada:**
> ```bash
> npx docguard-cli demo
> ```

## O que é o DocGuard?

O DocGuard é a ferramenta de enforcement do **Canonical-Driven Development (CDD)** —
uma metodologia em que a documentação é a fonte da verdade e a ferramenta **verifica,
deterministicamente, que ela continua verdadeira em relação ao código**.

A diferença para outras ferramentas de documentação: um resultado verde do DocGuard
significa *"os documentos correspondem ao código, de forma verificável"* — não apenas
"os arquivos existem". Ele extrai rotas, schemas, variáveis de ambiente, contagens e
afirmações documentadas, e compara tudo com o código real. Núcleo com zero chamadas a
LLM: determinístico, offline, auditável.

## Início rápido

```bash
# no diretório do seu projeto
npx docguard-cli init       # cria os documentos canônicos (detecta seu stack)
npx docguard-cli guard      # valida — verde significa "docs corretos"
npx docguard-cli score      # nota de maturidade da documentação (0-100)
```

> **O modo estrito é o padrão.** O `docguard guard` termina com código 4 quando uma verificação que se aplica ao seu projeto não examinou nada (por exemplo, não há referência de API embora existam rotas) e mostra o que adicionar. Uma verificação que não se aplica é ignorada, e um layout que o DocGuard não lê é apenas informado, sem falhar a execução. Atualizou e viu o build ficar vermelho? Leia [Atualizando para o modo estrito](https://raccioly.github.io/docguard/upgrading-to-strict) (em inglês). Para manter o comportamento anterior, defina `"enforcement": "standard"` no `.docguard.json`.

Para um projeto existente, o caminho inverso funciona melhor:

```bash
npx docguard-cli generate --plan --write   # engenharia reversa: docs a partir do código
```

## Os 5 comandos do dia a dia

| Comando | O que faz |
|:--------|:----------|
| `init`  | Inicializa o projeto (detecta o stack automaticamente) |
| `guard` | Valida os documentos contra o código — o portão de CI |
| `diff`  | Mostra a diferença entre docs e código (`--since <ref>` para impacto de PR) |
| `sync`  | Regenera as seções de "verdade do código" nos documentos |
| `score` | Nota de maturidade CDD, com detalhamento por categoria |

A lista completa de comandos, validadores e flags está no
[README em inglês](README.md#usage) — mantida sincronizada com o código pelo
próprio DocGuard.

## Integração com IA (nativo, não improvisado)

O DocGuard foi desenhado para ser usado **por** agentes de IA, não só por humanos:

- **Servidor MCP** — `claude mcp add docguard -- npx docguard-cli mcp` expõe
  guard/score/explain/verify/diagnose como ferramentas nativas para Claude,
  Cursor e qualquer cliente MCP.
- **Contrato JSON estável** — `guard --format json` com códigos de finding
  estáveis, explicáveis (`docguard explain <CÓDIGO>`) e supressíveis na linha.
- **SARIF** — `guard --format sarif` integra com o GitHub Code Scanning.
- **llms.txt / llms-full.txt / context pack** — superfícies de contexto para
  LLMs que leem o repositório.
- **GitHub Action** — anotações inline no diff do PR + comentário fixo com o
  impacto nos documentos canônicos.
- **`agents --sync`** — o AGENTS.md vira fonte canônica para CLAUDE.md, regras
  do Cursor, instruções do Copilot e afins — sem duplicação manual, sem drift.

Guia completo: [docs/ai-integration.md](docs/ai-integration.md) (em inglês).

## Documentação em outro idioma

O DocGuard lê documentação escrita em qualquer idioma, mas alguns rótulos que ele procura só são reconhecidos em inglês. O suporte a outros idiomas é acompanhado na [issue #644](https://github.com/raccioly/docguard/issues/644).

**Funciona hoje.** Texto corrido em qualquer idioma, com acentos, e ids de requisito como `FR-001` dentro de frases em qualquer idioma.

**Precisa ficar em inglês por enquanto.** Escreva estes rótulos exatamente como aparecem e mantenha todo o resto no seu idioma:

- **Títulos dos documentos canônicos** (sem diferenciar maiúsculas de minúsculas; numeração de seção no início é aceita): `ARCHITECTURE.md` exige `## System Overview`, `## Component Map` e `## Tech Stack`; `DATA-MODEL.md` exige `## Entities`; `SECURITY.md` exige `## Authentication` e `## Secrets Management`; `TEST-SPEC.md` exige `## Test Categories` e `## Coverage Rules`; `ENVIRONMENT.md` exige `## Environment Variables` e `## Setup Steps`. Um perfil de projeto pode acrescentar outros títulos obrigatórios.
- **Nomes das seções do Spec Kit**: o `spec.md` precisa de títulos que contenham `User Scenarios`, `Requirements` e `Success Criteria`, além de ids como `FR-001` e `SC-001`; o `plan.md` precisa de `Summary`, `Technical Context` e `Project Structure`; o `tasks.md` precisa de um título no estilo `Phase 1` e de ids como `T001`.
- **Marcador do changelog**: o `CHANGELOG.md` precisa conter `[Unreleased]`.
- **Status do registro de decisão**: a primeira palavra de `**Status:**` deve ser `Proposed`, `Accepted`, `Rejected`, `Deprecated` ou `Superseded` (também valem `Approved`, `Draft`, `Proposal`, `Obsolete` e `Replaced`).

Uma seção obrigatória que não se aplica ao seu projeto pode ser marcada com `<!-- docguard:section <slug> n/a — motivo -->`, em que `<slug>` é o título em inglês, em minúsculas e com hífens (por exemplo `system-overview`). O motivo deve começar com uma letra ou dígito de `A-Z`, `a-z` ou `0-9`.

**Ignore os números de qualidade do texto.** Voz passiva, negação, carga condicional e as demais métricas parecidas usam listas de palavras em inglês; em documentos de outro idioma, os valores não significam nada até que o próprio DocGuard passe a avisar isso.

## Documentação

Os guias completos estão em inglês, em
**[raccioly.github.io/docguard](https://raccioly.github.io/docguard/)**:

| Se você quer | Guia |
|:-------------|:-----|
| Instalar com npm, PyPI, Homebrew, Docker, GitHub Action ou Spec Kit | [Installation](https://raccioly.github.io/docguard/installation.html) |
| Adotar o DocGuard em um repositório que já tem código | [Existing Projects](https://raccioly.github.io/docguard/guides/existing-projects.html) |
| Usá-lo com o GitHub Spec Kit | [Spec Kit](https://raccioly.github.io/docguard/guides/spec-kit.html) |
| Bloquear pull requests no CI | [Continuous Integration](https://raccioly.github.io/docguard/guides/ci.html) |
| Saber quais linguagens e frameworks ele lê | [Languages and Frameworks](https://raccioly.github.io/docguard/reference/languages.html) |
| Conectar seu agente de código | [Coding Agents](https://raccioly.github.io/docguard/reference/agents.html) |
| Entender um código de achado | [Finding Codes](https://raccioly.github.io/docguard/reference/findings.html) |
| Resolver um problema | [Troubleshooting](https://raccioly.github.io/docguard/guides/troubleshooting.html) |

## Instalação permanente

```bash
npm install -g docguard-cli    # Node.js 18+
# ou via Python:
pip install docguard-cli       # wrapper PyPI (requer Node.js 18+)
```

## Comunidade

- [Discussões](https://github.com/raccioly/docguard/discussions) — perguntas e ideias
- [Issues](https://github.com/raccioly/docguard/issues) — bugs e pedidos de feature
- [CHANGELOG](CHANGELOG.md) — histórico completo de versões
- [Como contribuir](CONTRIBUTING.md)

---

**Licença MIT** · Feito para times que tratam documentação como contrato, não como enfeite.
