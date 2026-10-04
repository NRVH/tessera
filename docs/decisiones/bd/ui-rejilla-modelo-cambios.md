# Los cambios de la rejilla se nombran por su posición en lo cargado y viajan en un orden fijo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/rejilla/cambiosRejilla*.ts`

## Contexto

Lo pendiente de una tabla lo aplica el main todo o nada ([transacciones-enviar-todo-o-nada.md](transacciones-enviar-todo-o-nada.md)):
lo que el usuario aprueba tiene que ser lo que corre, y ninguna edición puede acabar en otra fila.

## Decisión

- Una fila del servidor se nombra por su índice en lo cargado (anexar solo añade al final): por
  eso releer pregunta antes «Descartar N cambios», no se edita mientras llega otro resultado
  (`sePuedeEditar`) y una pestaña con cambios no suelta memoria.
- Una fila editada guarda solo las celdas cambiadas; volver al original QUITA el cambio y una
  fila vacía desaparece («Enviar (N)» no miente). Borrar una del servidor la marca y conserva sus
  celdas; borrar una nueva la quita. Las nuevas van ARRIBA: abajo, cada página las empujaría.
- Inmutable, y un no-op devuelve el MISMO objeto (la rejilla memoriza por identidad). En bloque
  los mapas se copian UNA vez: encadenar la operación de una fila era cuadrático (borrar 20 000
  filas congelaba 9,8 s; «Poner NULL» en 5 000×10 celdas, 4,6 s).
- Orden de envío: borrados, actualizaciones, inserciones; en cada grupo, el de la rejilla
  (borrar primero libera la clave que otra fila reutiliza). El cliente no reordena, no filtra ni
  funde; la vista previa sale del constructor del main (`sentenciaDeCambio`).
- El `<textarea>` del editor devuelve LF donde se le dio CRLF: se compara con los saltos
  normalizados y se devuelven los CRLF (sin eso, F2 + Intro sin tocar nada cambiaba la celda).
- Originales (identidad `rowid`): solo las columnas que manda el main (`comparables`), con la
  regla de `shared/sql/originalesSql.ts` del dialecto; fuera la celda recortada, la del ROWID y
  un nombre repetido. Ver [rejilla-edicion-identidad.md](rejilla-edicion-identidad.md).
- COMMIT incierto (una pérdida, no un error del servidor): los cambios se quedan, la marca dura
  mientras quede algo que reenviar y el foco va a «Cancelar» y, al cerrar, a la rejilla.

## Consecuencias

`cambiosRejilla.ts` es contrato de las pruebas del main: ni ruta ni exports cambian.

## Descartes

- Enviar en el orden de la pantalla: un DELETE detrás del INSERT que reusa su clave fallaría.
- Leer las no editables del catálogo del árbol: una consulta más por pestaña y no cubría Oracle.
