# La sesión Oracle fija formato por execute, lee con cursor vivo y pone el candado sentencia a sentencia

- **Estado:** vigente
- **Ámbito:** `src/tdb/sesionOracle.cjs` y `erroresSesionOracle`, `cursorSesionOracle`, `bindsSesionOracle`, `salidaSesionOracle`

## Contexto

El proceso tiene varias sesiones de Oracle y `tdb` usa el mismo adaptador (`oracle.cjs`, ver
`adaptador-oracle-escalada-y-stop.md`): nada puede tocar los globales de `oracledb`.

## Decisión

- `outFormat: ARRAY` y `fetchTypeHandler` en CADA `execute`, nunca en los globales: con filas en array,
  dos columnas `ID` (a.id, b.id) no se pisan.
- Al abrir, los 4 NLS que Tessera fija (el main rechaza cambiarlos): fechas y números salen igual en thin
  y en thick, y un literal `'2024-01-15'` en un WHERE se interpreta igual.
- Cursor vivo para las consultas de usuario (`resultSet` + `getRows(n+1)`), con la fila de más en
  `pendiente`: una sola lectura consistente, sin re-escanear ni reordenar por página. Tope de 8 lectores
  por sesión en LRU: cuentan contra OPEN_CURSORS (300 por defecto en 11g).
- Solo lectura sentencia a sentencia: `BEGIN ROLLBACK; SET TRANSACTION READ ONLY; END;` en UN viaje y
  autoCommit apagado. Sin eso, un COMMIT o un DDL (que confirma implícitamente) escaparían al candado
  puesto al abrir. Esa tx no tiene cambios que perder: el estado se informa como `ninguna`.
- Estado de la tx: `connection.transactionInProgress` (sin viaje) y, si no existe, `LOCAL_TRANSACTION_ID`.
- Stop = `connection.break()` -> ORA-01013, solo con una sentencia de USUARIO en curso. Durante una ESPERA
  (un UPDATE bloqueado por otra sesión) la 11.2 lo atiende a los ~3 s y la 21c solo cuando la espera acaba:
  no hay remedio sin DBA, queda Forzar y la consola no se da por libre hasta que el servidor contesta.
- Posición del error: `err.offset` viene en BYTES UTF-8 y aquí se pasa a puntos de código; un offset 0
  no se informa (Oracle lo pone en todo error que no es de análisis).
- DPI-1047/1072 citan la RUTA del cliente del equipo: se sustituye por `<cliente>`.
- DBMS_OUTPUT: `ENABLE(NULL)` al abrir SOLO en las consolas y `GET_LINES` con un bind de array tras las
  sentencias que el main marca `salidaServidor`, también si fallan. Lo que pasa del tope se purga sin leerlo.

## Descartes

- `SERVEROUTPUT` como comando del cliente: es de SQL*Plus y aquí la salida está siempre encendida.
- ROWNUM para paginar: queda de respaldo en el main para un cursor expulsado.
