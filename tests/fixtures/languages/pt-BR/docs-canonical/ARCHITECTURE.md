# Pedidos: arquitetura

## Visão geral do sistema

O sistema registra pedidos de uma loja pequena. Ele não depende de serviços externos e guarda tudo em arquivos locais. Cada pedido tem um nome e um valor. Quando a pessoa confirma o pedido, o módulo principal grava uma linha no arquivo e devolve o mesmo pedido marcado como registrado. A equipe revisa o arquivo uma vez por semana e arquiva os pedidos antigos. Todas essas etapas são simples de testar, porque cada uma depende apenas de dados locais e de funções pequenas.

## Mapa de componentes

O módulo principal fica em `src/index.js`. A camada de entrada não acessa o disco diretamente.

## Pilha tecnológica

O projeto usa Node.js 20 e o executor de testes embutido.
