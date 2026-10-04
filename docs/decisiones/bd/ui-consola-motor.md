# El motor de la consola SQL es un hook dueño del modelo, con un reducer síncrono y piezas en orden fijo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/consola/useConsola.ts` y sus piezas `useConsola*.ts`, `tiposConsola.ts`

## Contexto

La consola carga, guarda y ejecuta aunque su pestaña no se haya mirado nunca, y al cerrarse no
puede perder el último tecleo. El bucle del lote decide la siguiente sentencia leyendo el estado
que acaba de producir la acción anterior.

## Decisión

- El MODELO de Monaco es del hook (se crea al montar, se dispone al desmontar); el EDITOR es del
  pane. Al desmontar se lee el texto pendiente ANTES de disponer el modelo. Un contador de usos por
  URI deja que un remontaje rápido reutilice el modelo y solo el último en irse lo disponga.
- El estado se aplica con `despachar`, SÍNCRONO: el resultado queda en `estadoRef` en el acto y en
  React al pintar. El reducer es el mismo, puro y probado.
- Los refs viven en UNA bolsa estable por instancia (`RefsConsola`) que reciben todas las piezas;
  el cuerpo de cada callback es una función de módulo que recibe lo que usa.
- Las piezas se llaman en el orden de sus efectos: núcleo, modelo, disco, sesión, lote, resultados,
  atajos y cierre. Ese orden es también el de las limpiezas al desmontar.
- Guardado: debounce de 300 ms, al perder el foco y al ocultarse. Un conflicto con el disco
  CONGELA el guardado hasta que el usuario elige; la relectura nunca corre durante un lote (sus
  offsets son del texto anterior).
- Esquema actual: uno solo (`esquemaEfectivo`, de [ui-consola-estado.md](ui-consola-estado.md)) para
  la barra, el eco y el autocompletado.

## Consecuencias

- Mover una pieza de sitio, o un efecto a un hijo, cambia el orden de los efectos y de las
  limpiezas; `useReducer` o un store harían que el bucle leyera un estado viejo.
- El protocolo y la política son del main: `explorador-consolas-persistencia.md`,
  `sesiones-esquema-de-consola.md`, `transacciones-produccion-y-manual.md`.
- El lote, Stop y el cierre: `ui-consola-lote-stop-y-cierre.md`.

## Descartes

- El modelo en el pane: su limpieza corría antes que la del hook y el último tecleo se perdía.
- Seguir guardando con un conflicto abierto: pisaba el texto del agente sin preguntar.
