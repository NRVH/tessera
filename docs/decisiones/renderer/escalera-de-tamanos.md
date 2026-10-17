# Los tamaños de letra del chrome son cuatro peldaños relativos a `--ui-font`, nunca píxeles fijos

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/styles.css` y las hojas de las features que usan `--ui-font`

## Contexto

La densidad de la interfaz se ajusta con un solo número (`densidad-de-interfaz.md`). Con tamaños
literales en las hojas, al bajarlo el texto principal encogía y los acentos (autor, fecha, chips) no:
la jerarquía se invertía.

## Decisión

- Un acento es acento por ser MENOR que su cuerpo, no por medir 11 px. Cuatro peldaños, todos
  relativos, y ninguno más:
  - título: `calc(var(--ui-font) + 1px)`;
  - contenido: `var(--ui-font)`;
  - meta (autor, fecha, ruta en gris): `calc(var(--ui-font) - 1px)`;
  - micro (chips, insignias, conteos, cabeceras): `max(9px, calc(var(--ui-font) - 2px))`.
- El `max()` es un suelo: con la interfaz en su mínimo, restar dos daría letra ilegible.
- Un ancho fijo en px con letra variable recorta: las columnas que dependen del texto van en `auto`
  o se derivan de `--ui-row-h` (un chip cuyo límite es caber en la fila).

## Consecuencias

Un `font-size` nuevo en el chrome elige uno de los cuatro peldaños. El editor y las terminales no
entran: tienen su propia apariencia.

## Descartes

- Dejar los acentos en píxeles «porque son relativos al cuerpo»: no lo eran, y al cambiar la
  densidad se veía.
