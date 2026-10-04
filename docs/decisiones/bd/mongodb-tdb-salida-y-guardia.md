# `tdb` con MongoDB: una sentencia por comando, guardia antes de conectar y un documento por bloque

- **Estado:** vigente
- **Ámbito:** `src/tdb/mongodb.cjs`, `src/tdb/tdb.cjs`

## Contexto

Un agente consulta MongoDB desde su terminal con `tdb query <alias> "<sentencia del shell>"`, `schema`,
`describe`, `test` y `sessions`. El adaptador tiene la forma de exports de los demás (`abrir`, `consultar`,
`banner`, `tablas`, `columnas`, `foraneas`, `sesiones`, `guardiaSoloLectura`, `mensajeGuardia`; y `indices` y
`bases`, que `tdb.cjs` usa si existen). Todo lo de MongoDB va en `mongoComun.cjs`: aquí solo lo que es de
`tdb`.

## Decisión

- Una sentencia por comando: el proceso es corto (abre, consulta y cierra), así que un `use otra` solo no
  tendría efecto. `use <base>` sí se admite como primera línea delante de la sentencia (`partir`): es lo que
  un agente escribe para mirar otra base, y sin él una conexión sin base fija no llegaría a ninguna.
- Solo lectura por lista blanca (`candadoSoloLectura: 'listaBlanca'`): MongoDB no tiene transacción de solo
  lectura de servidor y la impone Tessera, como en SQL Server. `guardiaSoloLectura` interpreta y clasifica
  antes de conectar (`tdb.cjs` la llama en `cmdQuery` con `guardiaDeTessera`): un `insertOne`, un `aggregate`
  con `$out` o `$merge`, o una sentencia que no se entiende no abren ni la conexión. `consultar` la repite
  (defensa en profundidad). El JavaScript de servidor pasa con aviso. La garantía real es un usuario con rol
  `read`, y los mensajes lo dicen. Con `readonly: false` se escribe, como en SQL; `tdb ls` ya avisa de
  producción.
- Salida de documentos: un documento por bloque en notación del shell, numerados y con el tope dicho. El
  `--json` lleva `documentos` (el texto de cada uno, sin pérdida) y `columnas`/`filas` (los campos de primer
  nivel: tal cual si JSON los representa sin pérdida y, si no, en notación del shell), para que un script que
  lee `filas` de un SQL lea también esto.
- `foraneas` devuelve `[]`: MongoDB no tiene claves foráneas, y `tdb schema` lo dice en vez de enseñar una
  lista vacía que parecería un fallo. `sesiones` son las operaciones propias en curso (`$currentOp` con
  `allUsers: false`, lo que ve un usuario sin privilegios de administración).

## Descartes

- La tabla de campos de primer nivel como salida de texto: un documento con subdocumentos se queda en
  `{"calle":"Mayor 1","ciu…` al cortar la celda a 40 caracteres, y lo que el agente necesita ver es justo lo
  que hay dentro.
