# Los motores de `tdb` son datos en `motores.cjs`, con paridad contra shared

- **Estado:** vigente
- **Ámbito:** `src/tdb/motores.cjs`, `tdb.cjs`, `sesion.cjs`, `src/shared/motores/`

## Contexto

Antes había un mapa de adaptadores en `tdb.cjs`, otro en `sesion.cjs` y una lista más en el main: sumar
un motor era acordarse de los tres, y lo que se olvidaba no lo decía nadie. La fuente de verdad es el
registro de descriptores de shared, pero `tdb` y el trabajador son CJS sin compilar y no pueden importarlo.

## Decisión

- `motores.cjs` lleva lo MÍNIMO duplicado (etiqueta, familia, adaptadores, forma en disco, credenciales,
  quién impone el solo lectura, opcionales, destino de `ls`) y `test-motores-tdb` lo cruza con shared:
  mismas claves en el mismo orden, mismos valores y que cada adaptador exista y resuelva desde `src/tdb/`.
- Las rutas `cli` y `sesion` son DATOS relativos a esa carpeta, y el `require` lo hace quien las usa
  (`tdb.cjs` y `sesion.cjs`), no una función de `motores.cjs`: el adaptador de Oracle carga su driver y no
  debe adelantarse. Por eso las piezas nuevas van planas en `src/tdb/`.
- Ningún `motor === …` suelto. `pideSecreto`, `guardiaPorPrefijo`, `guardiaDeTessera` y las funciones de
  familia son `switch` que cierran con `nunca`: un valor nuevo tiene que decidirse ahí y no caer en el «si no».
- `esMotor` usa `hasOwnProperty`: un motor escrito «constructor» o «__proto__» en el registro no lo es.
- `guardiaPorPrefijo` es `false` con autorizador (una base de archivo: el prefijo rechazaría un `PRAGMA` de
  lectura) y `true` en SQL Server, pero ahí solo dice «hay guardia delante»: la de verdad es la del adaptador,
  por lote y con los inicios de T-SQL, y nunca el `esSoloLectura` de `tdb.cjs`.
- La contraseña OPCIONAL (`secretoOpcional`: pide secreto y el usuario es opcional) se deduce de `opcionales`.

## Descartes

- Un valor nuevo de `credenciales` para la contraseña opcional: shared no lo tiene y la paridad de
  `pideSecreto` con `pideUsuarioYClave` se rompería.
