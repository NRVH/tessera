# El descriptor de SQL Server: árbol híbrido, solo lectura impuesta por Tessera y sin cursores vivos

- **Estado:** vigente
- **Ámbito:** `src/shared/motores/sqlserver.ts`, `src/tdb/sqlserverComun.cjs`

## Contexto

Driver `tedious` (JS puro) contra SQL Server 2012 o superior (`versionMinima: 11`: `OFFSET`/`FETCH`,
`THROW`, TDS 7.4). Usuario del servidor o cuenta de dominio (NTLM), con `credenciales: 'usuarioClave'`.

## Decisión

- **Árbol híbrido** (`nivelBases: 'sinBaseFija'`): la base es opcional; con base fija el árbol es el de
  PostgreSQL y sin ella hay un nivel «Bases».
- **Solo lectura impuesto por Tessera** (`candadoSoloLectura: 'clasificadorYEnvoltorio'`): el servidor
  no tiene candado y ningún `EXEC` pasa en solo lectura, porque un procedimiento puede hacer `COMMIT`
  de la transacción de fuera (`rutinasConfirmanPorDentro: true`). El DDL es transaccional.
- Cifrado verificado por defecto (`TLS_POR_DEFECTO`), con la casilla «Confiar en el certificado del servidor».
- `obligatorios` lleva host y puerto aunque haya instancia: la forma en disco de una conexión de red es
  host + puerto y el puerto se guarda (1433) aunque no se use, porque lo resuelve SQL Browser.
  `descartarAlGuardar: ['sid']` quita el SID que dejó Oracle.
- Paginado `offsetFetch`. Sin cursores vivos (`lectorPorId` y `mantenerCursor` a `false`): una petición
  pausada de tedious deja 3 bloqueos puestos y un `ALTER` de otra sesión espera (medido). «Más» en una
  consola re-ejecuta y salta filas.
- Cancelar corta la petición con el attention de TDS y la conexión sigue usable: `procesoPorSesion: false`.
- Carpetas: Tablas, Vistas, Rutinas, Sinónimos, Secuencias y Tipos. `esquemaImplicito: 'dbo'`;
  `esquemaDelSistema` por nombre exacto: `sys`, `INFORMATION_SCHEMA`, `guest` y los roles fijos.
- `esquemaTransaccional: false`: lo que cambia es la base (`USE`), que un `ROLLBACK` no deshace;
  `fijarEsquemaValida: true` (un `USE` inválido falla en el acto). `explainPideValores: false`:
  `SHOWPLAN_XML` compila sin ejecutar. `identidadSinPk: 'unicaNoNula'`; formateador `transactsql`.

## Descartes

- Puerto e instancia como grupo excluyente: `GrupoExcluyenteDestino` es de campos de texto y cambiar la
  forma en disco dejaría ajenas las conexiones de red de hoy en `tdb` viejos.
- Kerberos/SSPI y Entra ID: `DbAutenticacion` los prevé como valores futuros.

Ver también [motores-sesion-sqlserver.md](motores-sesion-sqlserver.md).
