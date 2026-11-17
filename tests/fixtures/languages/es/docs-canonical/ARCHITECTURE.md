# Pedidos: arquitetura

## Visión general del sistema

El sistema registra los pedidos de una tienda pequeña. No depende de servicios externos y guarda todo en archivos locales. Cada pedido tiene un nombre y un importe. Cuando la persona confirma el pedido, el módulo principal escribe una línea en el archivo y devuelve el mismo pedido marcado como registrado. El equipo revisa el archivo una vez por semana y archiva los pedidos antiguos. Todas estas etapas son fáciles de probar, porque cada una depende solo de datos locales y de funciones pequeñas.

## Mapa de componentes

El módulo principal está en `src/index.js`. La capa de entrada no accede al disco directamente.

## Stack tecnológico

El proyecto usa Node.js 20 y el ejecutor de pruebas incluido.
