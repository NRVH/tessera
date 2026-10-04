# La consola de MongoDB pregunta por cada sentencia rechazada, reenvía la confirmación tal cual y comparte con la de Redis solo lo idéntico

- **Estado:** vigente
- **Ámbito:** `documentos/DbConsolaDocsPane.tsx`, `useEstadoConsolaDocs.ts`, `useArchivoConsolaDocs.ts`,
  `useEjecucionDocs.ts`, `loteDocs.ts`, `useCierreConsolaDocs.ts`, `consolaComun.ts`, `cierreConsola.ts`,
  `consola/archivoConsola.ts`, `consola/useArchivoConsola.ts`, `consola/reemplazoModelo.ts`

## Contexto

La política de las escrituras la decide el main (ver [documentos-controlador.md](documentos-controlador.md));
el renderer es la primera barrera y solo reenvía. La consola de Redis nació como copia de esta, y
`useConsola` (el motor de la SQL) no sirve: cada rama habría tenido que preguntar la familia.

## Decisión

- **Interpretar, nunca evaluar.** Cada sentencia viaja TAL CUAL (`consolaDocs.ts` solo la parte). Si el
  main devuelve `produccion`, se pregunta con la misma confirmación de la consola SQL y se reenvía
  con `confirmado: true`, solo tras ese diálogo. Se pregunta POR sentencia rechazada, no por lote:
  sin clasificar aquí no se sabe de antemano cuáles escriben, y dar por confirmadas las siguientes
  sería aceptar lo que el usuario no ha leído. El bucle es secuencial y para en el primer fallo.
- **Los hooks del pane se llaman en el orden de sus efectos** (estado, archivo, editor, ejecución,
  acordes, cierre, reparto). Mover un efecto a un hijo o reordenar cambia ese orden.
- **Dueños:** el MODELO de Monaco es del hook de archivo (se crea al montar y se dispone al
  desmontar) y el EDITOR es del pane. Al desmontar se lee el texto pendiente ANTES de disponer el
  modelo: una limpieza en otro orden pierde el último tecleo.
- **La recarga del disco es un paso propio del deshacer** (`reemplazarConservandoDeshacer`, el de la
  consola SQL). Sin paradas se fundía con la última racha de tecleo, que no había llegado al disco:
  Ctrl+Z deshacía las dos y a los 300 ms el texto viejo se guardaba encima del del agente.
- **La base es de la consola**, en memoria por (perfil, consola), y viaja en cada petición; `use x`
  y el selector la cambian. Con la base fijada en la conexión no hay selector.
- **Portal:** el diálogo y el selector van a `document.body`; uno dentro de un `display:none` deja su
  promesa colgada cuando la carcasa pide cerrar una consola oculta.
- **Con Redis se comparte lo idéntico** (`consolaComun`, `cierreConsola`, `piezasBarra`…), y el
  **protocolo de archivo es uno para las tres consolas** (`consola/archivoConsola.ts`): cada una pone
  adónde avisa, qué cuenta como «ejecutando» y, la SQL, su validador. Copiado, un arreglo no llegaba.

## Consecuencias

Cuándo se lee, se guarda o se abre un conflicto lo fija `consola/test-archivo-consola.mts` para las tres.
