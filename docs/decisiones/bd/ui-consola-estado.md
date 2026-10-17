# La consola SQL es un reducer puro que el renderer orquesta sentencia a sentencia

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/consola/` (`estadoConsola`, `modeloConsola`, `reductor*`, `terminadaConsola`, `decisionLote`, `barraTx`, `lote`, `produccionConsola`, `parametrosConsola`, `vivoConsola`, `esquemaConsola`), `consola/useConsola.ts` y sus piezas `useConsola*.ts`, `tiposConsola.ts`

## Contexto

Una respuesta cambia a la vez marca, Salida, pestañas y lectores; con varios `useState`, un render
intermedio pinta una ✓ sin su pestaña. El bucle del lote decide la siguiente sentencia leyendo el
estado que acaba de producir la acción anterior. El main está en `transacciones-*.md` y `sesiones-*.md`.

## Decisión

- **Un reducer puro** (`reducirConsola`), partido en sub-reductores por grupo de acciones, que
  `useConsola` aplica con un `despachar` SÍNCRONO: el resultado queda en `estadoRef` en el acto y
  en React al pintar, y el bucle del lote lee el estado justo después.
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
- **El motor es un hook dueño del modelo** (`useConsola` y sus piezas `useConsola*.ts`): la consola
  carga, guarda y ejecuta aunque su pestaña no se haya mirado nunca, y al cerrarse no puede perder el
  último tecleo. El MODELO de Monaco es del hook (se crea al montar, se dispone al desmontar); el
  EDITOR es del pane. Al desmontar se lee el texto pendiente ANTES de disponer el modelo. Un contador
  de usos por URI deja que un remontaje rápido reutilice el modelo y solo el último en irse lo
  disponga.
- Los refs viven en UNA bolsa estable por instancia (`RefsConsola`) que reciben todas las piezas;
  el cuerpo de cada callback es una función de módulo que recibe lo que usa.
- Las piezas se llaman en el orden de sus efectos: núcleo, modelo, disco, sesión, lote, resultados,
  atajos y cierre. Ese orden es también el de las limpiezas al desmontar.
- Guardado: debounce de 300 ms, al perder el foco y al ocultarse. Un conflicto con el disco
  CONGELA el guardado hasta que el usuario elige; la relectura nunca corre durante un lote (sus
  offsets son del texto anterior).
- El protocolo y la política son del main: [explorador-consolas-persistencia.md](explorador-consolas-persistencia.md),
  [sesiones-esquema-de-consola.md](sesiones-esquema-de-consola.md),
  [transacciones-produccion-y-manual.md](transacciones-produccion-y-manual.md).

## Consecuencias

- Una acción nueva va a su sub-reductor y devuelve el MISMO estado si no cambia nada; una regla
  de «qué escribe» o «qué pide confirmación» se cambia en `shared/`, no aquí.
- Mover una pieza de sitio, o un efecto a un hijo, cambia el orden de los efectos y de las
  limpiezas; `useReducer` o un store harían que el bucle leyera un estado viejo.

## Descartes

- El modelo en el pane: su limpieza correría antes que la del hook y el último tecleo se perdería.
- Seguir guardando con un conflicto abierto: pisaría el texto del agente sin preguntar.
- Preguntar por sentencia en producción, o un segundo diálogo para peligros o DDL: se acepta sin leer.
- Parsear las filas en el hook: la página siguiente necesita lo ya cargado, que vive en el estado.
- Quedarse con el primer conjunto de resultados y avisar: un procedimiento devuelve siete.
