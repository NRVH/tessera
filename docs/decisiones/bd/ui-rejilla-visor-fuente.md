# La fuente y el DDL se leen en un mismo pane con un Monaco de modelo propio, y Refrescar salta la caché

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/DbFuentePane.tsx`

## Contexto

La fuente de un paquete, rutina, disparador o tipo, la definición de una vista y «Ver DDL» son
texto de solo lectura que el main devuelve (y guarda sin caducidad: en Oracle `DBMS_METADATA`
cuesta segundos por tabla, y por VPN más).

## Decisión

- Monaco de solo lectura que nace en el primer `visible` y con caja de verdad, nunca a 0 px, y
  cuyo host no se oculta nunca (el error y el vacío son una capa opaca encima): el mismo motivo
  que en [ui-rejilla-visor-valor.md](ui-rejilla-visor-valor.md).
- El modelo es propio, `tessera-db://fuente/<paneKey codificada>`: no pasa por el registro de
  buffers de los archivos (no hay guardado ni deshacer que conservar) y queda fuera del
  enrutador del autocompletado, que solo sirve a `tessera-db://consola/…`. Se desecha al
  desmontar: un modelo huérfano ocupa memoria y bloquea la URI si la pestaña se reabre.
- Lenguaje `sql` para Oracle (Monaco no trae `plsql`) y `pgsql` para PG.
- Varias partes (Especificación / Cuerpo): conmutador de texto a la izquierda (es identidad) y
  solo iconos a la derecha; al cambiar de parte se guarda y restaura la vista de cada una.
- «Ver DDL» es este mismo pane con `modo: 'ddl'`: cambia el canal y los textos. Cuando el main
  reconstruye el DDL desde el catálogo lo dice en el aviso, porque ese texto no es el del
  servidor.
- Abrir sale de la caché del main; Refrescar pide con `refrescar`, que salta lo guardado de ESE
  objeto: un ALTER o un CREATE OR REPLACE hecho desde fuera no pasa por la invalidación por DDL
  de las consolas de Tessera.

## Descartes

- Que Refrescar invalide el esquema entero (`dbExplorador.refrescar`): repinta el árbol y vuelve
  a pedir todo por la VPN para refrescar un solo objeto.
