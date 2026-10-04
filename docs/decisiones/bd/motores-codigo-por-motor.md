# El código por motor del explorador vive en un archivo por motor y dominio, con hojas para romper ciclos

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/motores/`, `catalogoSql.ts`

## Contexto

El descriptor compartido (`src/shared/motores/`) guarda lo que un motor ES. Lo que HACE en el
main (el SQL de su catálogo, de su DDL y de su sesión) solo lo necesita el main. Antes eran 26
ramas `if (motor === 'oracle')`, y un motor nuevo caía EN SILENCIO en la de PostgreSQL.

## Decisión

- Dos interfaces, `CatalogoExplorador` y `SesionExplorador`, un archivo por motor y por interfaz
  y el registro `MOTORES_EXPLORADOR`, un `Record<DbMotorSql, …>` exhaustivo: un motor nuevo no
  compila hasta tener su catálogo y su sesión enteros. `catalogoSql.ts` es la FACHADA: delega en
  `motorExplorador(motor).catalogo` siempre dentro de la función.
- Lo que un motor no tiene (sinónimos en PG, bases en Oracle) se implementa LANZANDO
  (`noDisponible`), no como método opcional: el compilador no señala un opcional que falta. Un
  motor a medias lanza `ErrorPendiente` (`pendiente`), nunca el SQL de otro servidor.
- Siempre binds. Las filas llegan como arrays y se leen por POSICIÓN (con objetos, dos columnas
  del mismo nombre se pisaban); las de objetos por tipo tienen siempre las mismas seis columnas.
- Las lecturas de varias consultas (`leerFks`, `leerDdl`) reciben un `LectorCatalogo` con
  `construir`: un fallo de construcción sale con su motivo y no como «Error interno».
- La BASE del nivel «Bases» va en el dialecto (`DialectoCatalogo.base`), no con un `USE` en la
  sesión (un viaje más que la deja en otra base).

## Consecuencias

- Regla de los ciclos: los archivos por motor NO importan `index.ts` ni `catalogoSql.ts`, y nadie
  usa a nivel superior algo importado de ellos; si no, `catalogoSql → index → catalogoOracle →
  catalogoSql` deja una variable a medio inicializar (TDZ), que no falla al compilar sino al cargar
  los tests. Lo común vive en hojas (`filasCatalogo.ts`, `nombresSqlserver.ts`, `planSql*.ts`).
- El orden de columnas de cada SELECT es parte del contrato con su mapeador.

## Descartes

- Un `Record<DbMotor, string>` por consulta: el SQL de un motor son funciones con troceado y
  hints por versión. Una forma de fila por tipo de objeto: once mapeadores casi iguales, y un
  error de posición pasaba los tests de los demás.
