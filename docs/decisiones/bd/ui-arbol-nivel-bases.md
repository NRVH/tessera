# El nivel «Bases» comparte el popover del «N de M» y el selector de consola decide por el descriptor

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/nivelBasesBd.ts`

## Contexto

SQL Server tiene varias bases por servidor y en él no se cambia el esquema de una sesión, sino
la base (`USE`). El árbol pinta un nivel «Bases» cuando la conexión no fija una
(`tieneNivelBases`), y de ahí salen dos preguntas que se contestan una sola vez.

## Decisión

- **Un solo popover del «N de M»** para esquemas y bases: misma aritmética (`shared/dbEsquemas`),
  misma casilla tri-estado y mismo gesto; cambian la clave de caché, la carga, el canal que
  guarda y los textos. Los de esquemas son los de siempre al byte.
- **El selector de la consola** elige la BASE en un motor con nivel «Bases» (el main la aplica
  con `USE` por `CONSOLA_ESQUEMA` y relee `DB_NAME()`); con base fija no se pinta; en los demás,
  el esquema. Decide por `catalogo.nivelBases` del descriptor con `nunca`, no por el nombre del
  motor.

## Consecuencias

Oracle, PostgreSQL y SQLite no ven nada distinto: las pruebas fijan sus textos.

## Descartes

- Un popover aparte para las bases: unas 300 líneas copiadas que acabarían divergiendo.
