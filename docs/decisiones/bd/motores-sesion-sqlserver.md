# En SQL Server el «esquema» de la consola es la base, y «Enviar» espera 10 s a un bloqueo

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/motores/sesionSqlserver.ts`

## Contexto

En SQL Server el esquema por defecto es del usuario, no de la sesión; lo que se cambia con
`USE` es la base. Tampoco queda un objeto «creado con errores»: un CREATE PROC que no compila
falla en el acto con su línea (medido).

## Decisión

- El selector de la consola hace `USE [base]` (una que no existe da 911 y una sin acceso 916; las
  dos son «ya no vale» al reabrir). Se lee con `DB_NAME()` y el trabajador la sigue por el
  ENVCHANGE de un `USE` escrito a mano. Volver «al de la conexión» es volver a la base con la que
  abrió la sesión.
- Edición: identidad por la PK o, sin ella, por el primer índice ÚNICO (sin filtro, habilitado)
  con todas sus columnas NOT NULL (`unicaNoNula`); con una que admita NULL, dos filas pueden
  compartir el valor. `%%physloc%%` se descartó: cambia con un rebuild y no está documentado.
  No se editan IDENTITY, calculadas, rowversion, columnas de periodo de una temporal, binarias,
  tipos CLR (`is_assembly_type`: su tipo base no existe en `sys.types`) ni `sql_variant` (un
  texto lo guardaría como nvarchar). La historia de una temporal la escribe el motor.
- Clave binaria: no hay conversión implícita de nvarchar a varbinary. En «Enviar» viaja como
  binario (`BindValorSqlite` 'blob', enlazado como VarBinary) y en el valor completo como
  `CONVERT(varbinary(max), @pN, 2)`.
- «Enviar» espera como mucho 10 s con `SET LOCK_TIMEOUT` (de la sesión, en ms; la de «Enviar»
  es efímera); vence con 1222. Una lectura que vence su tope en la sesión de datos es
  `motivo: 'bloqueo'` (`esBloqueoAlLeer`), con «Leer sin esperar» en la interfaz.
- Explain: `SET SHOWPLAN_XML ON` / la sentencia / `OFF`, tres viajes.

## Consecuencias

Los valores que también lee el renderer (paginado `offsetFetch`, candado `clasificadorYEnvoltorio`,
versión mínima 11) son del descriptor `shared/motores/sqlserver.ts`.
