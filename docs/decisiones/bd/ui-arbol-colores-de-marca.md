# El color de cada motor lleva el del tema oscuro en el SVG y el del claro en `arbol.css`, con contraste de gráfico

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/arbol.css` (tokens `--db-marca-*`)

## Contexto

Cada motor trae su glifo y su color ([ui-area-iconos](ui-area-iconos.md)). El icono sale en el
árbol, el diálogo, la tira de pestañas, los menús y el popover de montaje, en los dos temas, y un
glifo es un elemento gráfico: pide al menos 3:1 contra su fondo.

## Decisión

- El SVG lleva de respaldo el color del tema OSCURO y `arbol.css` da el del CLARO en
  `:root[data-theme='light']`, global y no bajo `.db-arbol` (el icono sale fuera del árbol).
- Valores (oscuro sobre el fondo / claro sobre #fafafa):
  - Oracle, rojo: #f26b57 (5:1) / #c0392b (5:1).
  - SQLite, azul: #5aa9e6 / #1f6fb2 (5:1).
  - SQL Server, ámbar: #e0a33a (7,5:1) / #9a6100 (4,9:1). Ámbar porque el azul y el rojo ya son
    de SQLite y de Oracle, que van juntos en el selector de motor.
  - MongoDB, verde: #00ed64 (10:1) / #00684a (6,5:1).
  - Redis, rojo: #ff4438 (4,9:1) / #dc382d (4,3:1). Mismo tono que Oracle: los separa la forma.
- PostgreSQL no tiene token: su elefante va en sus colores oficiales en los dos temas.

## Consecuencias

Un motor nuevo trae su par de colores y su contraste medido en los dos temas.

## Descartes

- El verde #13aa52 para MongoDB en el tema claro: 2,9:1, bajo el 3:1 de un gráfico.
