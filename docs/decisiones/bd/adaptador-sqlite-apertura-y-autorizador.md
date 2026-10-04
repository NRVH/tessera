# SQLite se abre solo con su guardia puesta, decidida antes de abrir y con mensajes sin rutas

- **Estado:** vigente
- **Ámbito:** `src/tdb/sqliteComun.cjs` y sus piezas `archivoSqlite.cjs`, `autorizadorSqlite.cjs`,
  `celdasSqlite.cjs`; los usan `tdb` y el trabajador del explorador

## Contexto

La librería es `node:sqlite`, la de Electron: sin binarios y la misma en Windows y macOS. El
constructor no falla con basura y acepta opciones inventadas sin avisar. Una apertura de solo
lectura sobre una WAL sin `-wal` CREA `-wal` y `-shm` en la carpeta del usuario. Con Docker un
enlace simbólico creado en el contenedor lo es de verdad en el anfitrión. Los mensajes de
apertura llegan al renderer, que no ve rutas del anfitrión.

## Decisión

- Se lee la cabecera ANTES de abrir (`decidirApertura`, pura): vacío, cifrado o no SQLite, un
  `-wal`/`-journal` elegido por error y un journal caliente en solo lectura son errores claros;
  solo lectura sobre una WAL sin su `-wal` abre `immutable=1`.
- `setAuthorizer` y `limits.attach = 0` van SIEMPRE, en toda conexión; sin ellos NO se abre
  (falla cerrado). El perfil cambia por operación: `base` (cierra ATTACH, funciones peligrosas y
  PRAGMA que escriben fuera), `lectura` (lista blanca y que la sentencia devuelva columnas),
  `explain` (solo EXPLAIN, sin PRAGMA con valor) y `vacuum` (solo el ATTACH interno).
- VACUUM no llama al autorizador al preparar: en lectura lo cierra no devolver columnas, y
  VACUUM INTO se detecta en el programa (`EXPLAIN`, instrucción `Vacuum` con destino), no en el
  texto.
- Se rechaza un enlace simbólico en el `.db` y sus hermanos y una ruta que ya no lleva al mismo
  sitio. Los mensajes nombran el archivo, no la ruta; un disco desenchufado
  (`TESSERA-SQLITE-DESCONECTADO`) se distingue del archivo borrado por la raíz del volumen.
- Un solo recorrido del relleno entre sentencias (`saltarRelleno`), de izquierda a derecha como
  el tokenizador de SQLite; la plataforma entra por parámetro.

## Consecuencias

- `PRAGMAS_LECTURA` y `MENSAJE_VACUUM_INTO` son copias de las del main que cruza `test-sqlite-comun`.

## Descartes

- `PRAGMA query_only` (no impide ATTACH ni VACUUM INTO, y el propio SQL lo revierte), cerrar VACUUM
  INTO mirando el texto y decidir la escritura con `access(W_OK)` (en Windows no mira la carpeta).
