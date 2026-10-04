# La consola SQL es un reducer puro que el renderer orquesta sentencia a sentencia

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/consola/` (`estadoConsola`, `modeloConsola`, `reductor*`, `terminadaConsola`, `decisionLote`, `barraTx`, `lote`, `produccionConsola`, `parametrosConsola`, `vivoConsola`, `esquemaConsola`)

## Contexto

Una respuesta cambia a la vez marca, Salida, pestañas y lectores; con varios `useState`, un render
intermedio pinta una ✓ sin su pestaña. El main está en `transacciones-*.md` y `sesiones-*.md`.

## Decisión

- **Un reducer puro** (`reducirConsola`), partido en sub-reductores por grupo de acciones, que
  `useConsola` aplica con un `despachar` SÍNCRONO: el bucle del lote lee el estado justo después.
- **La sesión es del main**: modo, tx y «Tx pendiente (N)» salen del último `DbEstadoSesion` (el
  evento llega antes que la respuesta: contar aquí sumaría dos veces). Sin sesión, la barra pinta
  el modo de nacimiento. El esquema actual es uno solo (`esquemaEfectivo`): sesión, elegido, conexión.
- **Respuestas atadas al lote por id** (una tardía se ignora); el cliente es ⊘ y no para; Stop no
  toca la que corre. La decisión previa (`decidirLote`) y su única confirmación en producción
  incluyen los peligros, el COMMIT implícito de un DDL de Oracle con cambios pendientes y el COMMIT
  escrito en un bloque (solo en Manual); el resto del lote, en [ui-consola-lote-stop-y-cierre.md](ui-consola-lote-stop-y-cierre.md).
- **Pestañas**: las reglas de sustituir y activar son las de [ui-rejilla-modelo-resultados.md](ui-rejilla-modelo-resultados.md);
  varios conjuntos por sentencia son subpestañas «Resultado k.j», `noReleible`.
- **Avisos del main** (commit implícito de un DDL) no se duplican; los de sesión, una vez. Los
  parámetros los detecta `shared/sql/parametrosSql.ts`: un campo por clave, NULL es una casilla.
- **Forzar tiene alcance**: con un proceso por consola (SQLite) solo cierra esa sesión.

## Consecuencias

- Una acción nueva va a su sub-reductor y devuelve el MISMO estado si no cambia nada; una regla
  de «qué escribe» o «qué pide confirmación» se cambia en `shared/`, no aquí.

## Descartes

- Preguntar por sentencia en producción, o un segundo diálogo para peligros o DDL: se acepta sin leer.
- Parsear las filas en el hook: la página siguiente necesita lo ya cargado, que vive en el estado.
- Quedarse con el primer conjunto de resultados y avisar: un procedimiento devuelve siete.
