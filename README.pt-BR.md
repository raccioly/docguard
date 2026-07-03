<!-- docguard:translation source=README.md lang=pt-BR reviewed=2026-07-03 -->
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
