# SQL Server usa tedious fijado y parcheado para devolver los valores exactos

- **Estado:** vigente
- **Ámbito:** `src/tdb/sqlserverComun.cjs`, `exactosSqlserver.cjs`, `celdasSqlserver.cjs` y `sqlserver.cjs`

## Contexto

tedious 20 (medido contra SQL Server 2022 CU27) pierde precisión: `decimal(38,12)` sale como
`1.2345678901234568e+25`, el `money` máximo como `922337203685477.6`, `datetime2(7)` como un `Date`,
`datetimeoffset` en UTC sin desplazamiento. Su `requestTimeout` de fábrica (15 s) mata una consulta
larga, y con XACT_ABORT un Stop revierte la transacción entera.

## Decisión

- El driver es `tedious` (JavaScript puro, el mismo en Windows y macOS, sin binarios), FIJADO a una
  versión exacta en `package.json` porque aquí se parchea un interno. `instalarValoresExactos` envuelve
  `readValue` de `tedious/lib/value-parser` una vez por proceso para que decimal, numeric, money, date,
  time, datetime2 y datetimeoffset lleguen como texto exacto; si no engancha, no se instala, lo dice
  (`{activo:false, motivo}`) y las celdas caen a lo que da tedious. `instalarComandoDone` deja el `curCmd`
  de cada DONE en la petición: la asignación de una variable llega como un SELECT de 1 fila y no debe
  contarse como «1 fila afectada».
- Autenticación `sql` o `ntlm` (JavaScript puro, funciona igual desde un Mac); sin Kerberos ni Entra. Una
  instancia con nombre va sin puerto (SQL Browser, UDP 1434). Por defecto se cifra y se VERIFICA, con las
  CA del sistema además de las del paquete; con un certificado autofirmado el error dice qué casilla marcar.
- Idioma «Español» (el número del error viaja aparte) y `dateFormat: 'ymd'`. `requestTimeout: 0` salvo que se
  pida uno; `abortTransactionOnError: false`; `useColumnNames: false`.
- Las sesiones de árbol y de datos llevan `SET LOCK_TIMEOUT` (error 1222) y la de árbol además READ
  UNCOMMITTED: un CREATE TABLE sin confirmar en una consola colgaba la consulta de `sys.objects`. Las
  consolas no llevan tope (las detiene Stop) y `tdb` sí.

## Consecuencias

- Subir tedious exige volver a pasar `test-sqlserver-comun` contra el servidor de pruebas.

## Descartes

- `mssql` (añade un pool que estorba y esconde el `Connection`), `msnodesqlv8` (binarios por plataforma,
  pasa los decimales por double y su cancelación no funciona sin sondeo), `readOnlyIntent` como candado (en
  un servidor suelto el INSERT se acepta) y sustituir `@azure/identity` por un módulo vacío (frágil).
