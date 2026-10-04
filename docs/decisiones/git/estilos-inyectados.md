# El CSS de git es una sola hoja acotada por clase raíz, inyectada desde trozos en orden fijo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/git/estilosGit.ts` y `features/git/estilos/`

## Contexto

Las dos superficies de git (la barra lateral de Cambios y la franja inferior de Log) comparten
piezas: la fila del árbol de archivos, el badge de estado, los estados de carga, el chip de rama.
Una hoja por superficie duplicaría esas reglas y acabarían separándose; meterlas en `styles.css`
perdería el acotamiento que impide que este CSS afecte a nada más.

## Decisión

- Una sola hoja, inyectada una vez en `<style id="git-styles">` (`asegurarEstilosGit`), con tres
  raíces: `.git-ui` (lo compartido; las dos superficies llevan la clase), `.git-panel` (Cambios)
  y `.git-log-panel` (Log).
- La hoja se escribe en trozos por sección (`estilos/*.ts`) y `estilosGit.ts` los concatena en
  un orden FIJO: ese orden es la cascada. Reordenar trozos o reglas cambia cómo se ve la app.
- Tamaños de letra por jerarquía, en cuatro peldaños relativos a `--ui-font`
  (`estilos/escalera.ts`): TITULO, normal, META y MICRO. MICRO lleva un SUELO de 9 px
  (`max(9px, …)`): con la interfaz al mínimo, restar 2 dejaría chips ilegibles.
- Las alturas de fila no se interpolan aquí: llegan como `--ui-row-h`/`--ui-head-h` desde
  `theme/densidad.ts`, que cambian en caliente y que `VirtualList` usa como número.
- El CSS vive en literales de plantilla: un acento grave dentro va escapado o cierra la hoja.

## Consecuencias

- Un selector nuevo cuelga de su raíz; lo que usen las dos superficies va en `compartido.ts`.
- Al partir o mover trozos, el texto concatenado tiene que salir idéntico byte a byte.

## Descartes

- Tamaños clavados en px: al mover el ajuste de letra, el asunto encogía y el autor y la fecha
  no; la hoja no tenía escala.
