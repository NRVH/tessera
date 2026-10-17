# La consola de MongoDB pregunta por cada sentencia rechazada, reenvía la confirmación tal cual y comparte con la de Redis solo lo idéntico

- **Estado:** vigente
- **Ámbito:** `documentos/DbConsolaDocsPane.tsx`, `useEstadoConsolaDocs.ts`, `useArchivoConsolaDocs.ts`,
  `useEjecucionDocs.ts`, `loteDocs.ts`, `useCierreConsolaDocs.ts`, `consolaComun.ts`, `cierreConsola.ts`,
  `consola/archivoConsola.ts`, `consola/useArchivoConsola.ts`, `consola/reemplazoModelo.ts`,
  `resultadosConsolaDocs.ts`, `ResultadosDocs.tsx`, `resultados/TiraResultados.tsx`,
  `useHistorialConsolaDocs.ts`, `autocompletadoDocs.ts`, `proveedorDocsMonaco.ts`

## Contexto

La política de las escrituras la decide el main (ver [documentos-controlador.md](documentos-controlador.md));
el renderer es la primera barrera y solo reenvía. La consola de Redis comparte con esta la mayor parte
de su pane, y `useConsola` (el motor de la SQL) no sirve para ninguna de las dos: cada rama habría
tenido que preguntar la familia.

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
  consola SQL). Sin paradas se fundiría con la última racha de tecleo, que no ha llegado al disco:
  Ctrl+Z deshacería las dos y a los 300 ms el texto viejo se guardaría encima del del agente.
- **La base es de la consola**, en memoria por (perfil, consola), y viaja en cada petición; `use x`
  y el selector la cambian. Con la base fijada en la conexión no hay selector.
- **Portal:** el diálogo y el selector van a `document.body`; uno dentro de un `display:none` deja su
  promesa colgada cuando la carcasa pide cerrar una consola oculta.
- **Con Redis se comparte lo idéntico** (`consolaComun`, `cierreConsola`, `piezasBarra`…), y el
  **protocolo de archivo es uno para las tres consolas** (`consola/archivoConsola.ts`): cada una pone
  adónde avisa, qué cuenta como «ejecutando» y, la SQL, su validador. Copiado, un arreglo no llegaría
  a las demás.
- **Una pestaña por resultado, con el modelo de la consola SQL** (`pestanasResultado.ts` y su tira,
  `TiraResultados`): cada orden que devuelve documentos o un valor abre la suya, titulada con su
  colección o `Resultado k`; las de un lote se suman, y la primera de un lote nuevo sustituye las
  no fijadas y cierra sus cursores. Se fijan y se cierran igual que en SQL. Un lote que no llegó a
  enviar nada (producción rechazada, Stop antes de la primera respuesta) no toca las pestañas: lo
  que se miraba no desaparece por una orden que no se ejecutó. «Cargar más» es de la pestaña activa,
  y un cursor que vuelve para una pestaña ya cerrada se cierra.
- **El historial es el de la consola SQL** ([ui-consola-historial.md](ui-consola-historial.md)): el
  controlador de documentos anota lo que llegó al servidor (no las barreras de Tessera, `TESSERA-…`)
  como entradas `mongosh`, y el popover de cada consola lista solo las de su lenguaje.
- **El autocompletado ofrece solo lo que el intérprete admite**: los métodos de `db`, de una
  colección y de la cadena de `find`/`aggregate` son las listas de `sentenciaMongodb.cjs` (su test
  las compara), más las colecciones de la base, los campos de muestra de la colección del objeto
  que se escribe y los operadores `$`. Los datos llegan del main con una caché de 30 s y sin esperar
  más de 1,5 s: una sugerencia no se queda colgada de un servidor lento.

## Consecuencias

Cuándo se lee, se guarda o se abre un conflicto lo fija `consola/test-archivo-consola.mts` para las tres.
