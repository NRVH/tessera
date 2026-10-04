# El contrato del explorador SQL: respuestas sin excepciones, una sentencia por invoke y filas opacas

- **Estado:** vigente
- **Ámbito:** `src/shared/db-explorador-ipc.ts` y sus secciones `dbExplorador*.ts`, `src/main/db/explorador/`, `src/preload/index.ts`

## Contexto

`db-ipc.ts` es el contrato del registro de conexiones (estable y pequeño); el explorador —sesiones
vivas, transacciones, catálogo, rejillas, consolas— es otro dominio que crece rápido. Mezclarlos
ataría las pruebas del uno a las del otro. Este archivo solo importa tipos de `db-ipc.ts`.

## Decisión

- Toda respuesta esperable es `DbRespuesta<T>`, nunca un `throw`: el `invoke` de Electron pierde las
  propiedades del error (`requiereDriver`, `posicion`). `ok: false` significa que la petición no llegó
  al servidor (ocupada, solo lectura, sin secreto, driver, límite, interno); lo que el servidor
  respondió —error, cancelación, sesión perdida— viaja como `DbResultadoSentencia` dentro de un `ok: true`.
- Orquesta el renderer, una sentencia por `invoke`: hay ✓/✗ por sentencia, cronómetro vivo y Stop entre
  sentencias sin eventos (un `webContents.send` dentro de un handler llega antes que la respuesta). El
  main vuelve a partir el texto con `shared/sql` y rechaza si no sale exactamente una sentencia: la
  autoridad nunca se fía de lo que clasificó el renderer.
- Las filas viajan como `filasJson: string` opaco: con objetos, una página de 500 x 100 celdas se
  clonaba tres veces en profundidad, la primera en el hilo principal del main.
- `DbErrorSql.posicion` llega en UTF-16, relativa al texto enviado y convertida solo en el main
  ([sql-posicion-error.md](sql-posicion-error.md)). La salida del servidor y los errores de
  compilación viajan dentro del resultado de su sentencia. Exportar lo escribe el main
  ([contratos-formatos-de-filas.md](contratos-formatos-de-filas.md)).
- Los tipos van por secciones (`dbExplorador<Sección>.ts`) que `db-explorador-ipc.ts` reexporta: se
  importa siempre de él. Las secciones que se citan entre sí van juntas, sin importarse en círculo.

## Descartes

- El lote entero en el main con eventos `EV_SENTENCIA`: más superficie, un planificador duplicado y la
  carrera evento/respuesta.

## Consecuencias

Semántica del envío: [transacciones-enviar-todo-o-nada.md](transacciones-enviar-todo-o-nada.md),
[transacciones-perdidas-y-commit-en-camino.md](transacciones-perdidas-y-commit-en-camino.md) y
[rejilla-envio-bloqueos.md](rejilla-envio-bloqueos.md).
