# El lote de la consola se confirma una vez antes de enviar nada, y Stop y el cierre alcanzan todo lo que está en vuelo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/consola/useConsolaLote.ts`, `useConsolaStop.ts`,
  `useConsolaCierre.ts`, `useConsolaResultados.ts`

## Contexto

El renderer es la primera barrera de lo que el usuario manda a una base de producción, y el main
la segunda. Una lectura en vuelo sin id apuntado no la alcanzaba ■ y dejaba la sesión ocupada.

## Decisión

- Lote: partir -> prevuelo de solo lectura (todo o nada) -> peligros -> producción en una decisión
  pura (`decidirLote`); UNA confirmación por lote ANTES de enviar nada, y `confirmado` viaja con
  cada sentencia. Parámetros después de confirmar y antes de crear el lote: cancelar no deja ni
  marcas ni eco. Bucle SECUENCIAL, una sentencia por invoke, que para en el primer error; el SQL es
  el texto del modelo tal como se leyó al pulsar.
- Qué confirma lo dicen `requiereConfirmacionProduccion` y `modoTxInicial`, compartidos con el
  main. El COMMIT de la barra confirma en producción; ROLLBACK, pasar a Auto y cerrar no.
- ■ cancela la sentencia por su `ejecucionId` y, por sus `peticionId` GUARDADOS, las páginas de
  «más», los «Contar» y los «Traer todas». Sin respuesta a tiempo, «Forzar» confirma listando las
  transacciones que se pierden, con su alcance (`alcanceForzar`).
- Cerrar: «¿Detener y cerrar?» (esperando lo mismo que ■) -> conflicto -> transacción pendiente
  -> cancelar lecturas en vuelo -> cerrar la sesión -> vaciar -> borrar el archivo si está vacío.
  Si el main rechaza por `ocupada`, la pestaña NO se cierra (`cierreFallidoRetiene`).
- Cada pestaña de resultado es un dueño del presupuesto global de celdas; soltar memoria cancela
  antes lo que siga leyendo de su lector.

## Consecuencias

- Un id de petición que no se guarde en su mapa es una lectura que ■ no para.
- Del lado del main: `explorador-stop-en-preparacion.md`, `transacciones-maquina-de-estados.md`,
  `transacciones-produccion-y-manual.md`.

## Descartes

- Rendirse antes de `ESPERA_STOP_MS` al cerrar: pedía cerrar una sesión que seguía `ocupada`.
- Cerrar sin cancelar antes «más» y «Contar»: el cierre se encolaba detrás de un COUNT(*) largo.
