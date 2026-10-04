# Monaco se configura en un solo sitio, con validadores apagados, tema solo hex y sin estados de Monarch que queden abiertos

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/monacoSetup.ts`, `monacoTema.ts` y `monacoLenguajes.ts`

## Contexto

Tessera lee y edita, no compila: quien escribe la mayor parte del código son los agentes. Monaco trae
encendidos validadores que aquí no pueden acertar: el worker de TypeScript ve un archivo suelto (sin
`tsconfig` ni `node_modules`) y marca como error cualquier import de una dependencia real; el de JSON no
conoce JSONC. Además, Monaco parsea los `colors` de un tema con `Color.fromHex`, que ante cualquier otra
notación devuelve rojo, y Monarch no hace pop al final de línea.

## Decisión

- `OPCIONES_BASE_MONACO` es el único sitio de las opciones comunes (copiadas a medias en cada pane, una
  clase descompilada salía con la fuente por defecto). Con `automaticLayout: false`, cada editor registra su
  `ResizeObserver` y llama a `layout()`; sin esa pata mide 0×0 y el pane sale en negro.
- El editor de DIFF llama a `layout({ width, height })` con dimensiones explícitas: no propaga el alto sin
  ellas (lee su propio `style.height` y concluye que no cambió). Un editor de código vale sin argumentos.
- Los diagnósticos de TS/JS, JSON y CSS se apagan (`apagarDiagnosticos`); el resaltado y el resto del
  servicio de lenguaje no se tocan, y `enableSchemaRequest` queda en `false`.
- El tema solo usa hex vía `toMonacoHex`: nada de `rgba()` ni `var(--*)`. La paleta sigue siendo la única
  fuente y el color de los brackets se neutraliza en el tema, porque la colorización la lee el modelo.
- `properties` y `mermaid` no usan estados de Monarch: cada línea o pareja se resuelve con una regla que no
  cruza de línea y con el cierre opcional. La regla `$` de un estado no se evalúa al final de línea, así que
  un estado abierto tiñe lo que sigue. `groovy` sí usa estados, solo para lo que tiene cierre explícito
  (comentarios de bloque y strings); sin estado de interpolación `${…}` ni strings con barras.
- El refuerzo de Java se registra como factory (`registerTokensProviderFactory`): el último registro gana y
  corre después del import de las basic-languages. Un `onLanguage` con `import().then()` perdía la carrera.

## Consecuencias

- Encender la validación o pasar un `rgba()` al tema reabre el rojo espurio sin ningún error visible.
- Un editor nuevo debe registrar su `ResizeObserver` y llamar a `layout`; si es un diff, con dimensiones.
